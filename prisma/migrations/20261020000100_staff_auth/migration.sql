BEGIN;

-- Infrastructure is private and excluded from the provider's exposed schemas.
CREATE TABLE portal_private.auth_attempts (
    id uuid PRIMARY KEY,
    scope text NOT NULL CHECK (scope IN ('ip','account')),
    window_start timestamptz NOT NULL,
    attempts integer NOT NULL CHECK (attempts > 0)
);
CREATE INDEX auth_attempts_expiry_idx ON portal_private.auth_attempts(window_start);
CREATE TABLE portal_private.staff_session_cutoffs (
    profile_id uuid PRIMARY KEY REFERENCES portal.staff_profiles(id) ON DELETE RESTRICT,
    revoked_before timestamptz NOT NULL
);
CREATE TABLE portal_private.password_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash)=32),
    subject_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id uuid NOT NULL,
    expires_at timestamptz NOT NULL,
    used_at timestamptz
);
CREATE INDEX password_grants_expiry_idx ON portal_private.password_grants(expires_at);
CREATE TABLE portal_private.staff_provider_operations (
    id uuid PRIMARY KEY,
    profile_id uuid NOT NULL REFERENCES portal.staff_profiles(id) ON DELETE RESTRICT,
    operation text NOT NULL CHECK (operation IN ('ban','unban')),
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE portal_private.staff_invitation_requests (
    id uuid PRIMARY KEY,
    actor_id uuid NOT NULL REFERENCES portal.staff_profiles(id) ON DELETE RESTRICT,
    email_hash bytea NOT NULL CHECK(octet_length(email_hash)=32),
    profile_id uuid REFERENCES portal.staff_profiles(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE portal_private.auth_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_private.staff_session_cutoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_private.password_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_private.staff_provider_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_private.staff_invitation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA portal_private FROM PUBLIC, anon, authenticated, service_role, portal_runtime;

-- This reveals only whether the caller's verified subject/session is live.
-- No runtime role receives general access to managed Auth session rows.
CREATE FUNCTION portal_private.staff_session_is_live(session_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (
        SELECT 1 FROM auth.sessions s
        JOIN auth.users u ON u.id=s.user_id
        LEFT JOIN portal_private.staff_session_cutoffs c ON c.profile_id=s.user_id
        WHERE s.id=session_id AND s.user_id=auth.uid()
          AND (s.not_after IS NULL OR s.not_after > statement_timestamp())
          AND (u.banned_until IS NULL OR u.banned_until <= statement_timestamp())
          AND (c.revoked_before IS NULL OR s.created_at > c.revoked_before)
          AND NOT EXISTS (SELECT 1 FROM portal_private.staff_provider_operations o
            WHERE o.profile_id=s.user_id AND o.completed_at IS NULL)
    )
$$;

CREATE FUNCTION portal_private.require_staff_admin() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF portal_private.current_staff_role() IS DISTINCT FROM 'ADMIN'
       OR NOT portal_private.staff_session_is_live(
         (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid) THEN
        RAISE EXCEPTION 'Staff access denied' USING ERRCODE='42501';
    END IF;
END;
$$;

CREATE FUNCTION portal_private.consume_auth_attempt(key_id uuid, attempt_scope text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE count_now integer; limit_now integer;
BEGIN
    IF attempt_scope NOT IN ('ip','account') THEN RAISE EXCEPTION 'Invalid scope'; END IF;
    limit_now := CASE WHEN attempt_scope='ip' THEN 20 ELSE 5 END;
    DELETE FROM portal_private.auth_attempts WHERE id IN (
      SELECT id FROM portal_private.auth_attempts
      WHERE window_start < statement_timestamp()-interval '15 minutes'
      ORDER BY window_start LIMIT 100
    );
    INSERT INTO portal_private.auth_attempts(id,scope,window_start,attempts)
    VALUES (key_id,attempt_scope,statement_timestamp(),1)
    ON CONFLICT (id) DO UPDATE SET
      window_start=CASE WHEN portal_private.auth_attempts.window_start<statement_timestamp()-interval '15 minutes' THEN EXCLUDED.window_start ELSE portal_private.auth_attempts.window_start END,
      attempts=CASE WHEN portal_private.auth_attempts.window_start<statement_timestamp()-interval '15 minutes' THEN 1 ELSE least(portal_private.auth_attempts.attempts+1,1000000) END
    RETURNING attempts INTO count_now;
    RETURN count_now <= limit_now;
END;
$$;

CREATE FUNCTION portal_private.create_password_grant(session_id uuid, token_hash bytea)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT portal_private.staff_session_is_live(session_id) OR octet_length(token_hash)<>32 THEN
        RAISE EXCEPTION 'Staff access denied' USING ERRCODE='42501';
    END IF;
    DELETE FROM portal_private.password_grants WHERE expires_at < statement_timestamp();
    INSERT INTO portal_private.password_grants(token_hash,subject_id,session_id,expires_at)
      VALUES (token_hash,auth.uid(),session_id,statement_timestamp()+interval '10 minutes');
END;
$$;
CREATE FUNCTION portal_private.consume_password_grant(session_id uuid, token_hash bytea)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT portal_private.staff_session_is_live(session_id) THEN RETURN false; END IF;
    UPDATE portal_private.password_grants g SET used_at=statement_timestamp()
      WHERE g.token_hash=consume_password_grant.token_hash AND g.subject_id=auth.uid()
        AND g.session_id=consume_password_grant.session_id AND g.used_at IS NULL
        AND g.expires_at>statement_timestamp();
    RETURN FOUND;
END;
$$;

-- Link only a provider-verified UUID, initially inactive and READ_ONLY.
CREATE FUNCTION portal_private.link_staff(target_id uuid, display_name text, request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(710201);
    PERFORM portal_private.require_staff_admin();
    IF length(btrim(display_name)) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid name'; END IF;
    INSERT INTO portal.staff_profiles(id,display_name) VALUES(target_id,btrim(display_name))
      ON CONFLICT(id) DO NOTHING;
    IF FOUND THEN
      INSERT INTO portal.audit_logs(actor_id,object_type,object_id,action,safe_changes,request_id)
        VALUES(auth.uid(),'STAFF_PROFILE',target_id,'STAFF_LINKED','{"role":"READ_ONLY","active":false}',request_id);
    END IF;
END;
$$;

CREATE FUNCTION portal_private.change_staff(target_id uuid, target_role text, target_active boolean, request_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old_profile portal.staff_profiles; operation_id uuid;
BEGIN
    PERFORM pg_advisory_xact_lock(710201);
    PERFORM portal_private.require_staff_admin();
    IF target_role NOT IN ('ADMIN','HR','READ_ONLY') OR target_active IS NULL THEN RAISE EXCEPTION 'Invalid role'; END IF;
    SELECT * INTO old_profile FROM portal.staff_profiles WHERE id=target_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown profile'; END IF;
    IF target_id=auth.uid() AND (NOT target_active OR target_role<>'ADMIN') THEN
      RAISE EXCEPTION 'Cannot lock out own account' USING ERRCODE='42501';
    END IF;
    IF old_profile.active AND old_profile.role='ADMIN' AND (NOT target_active OR target_role<>'ADMIN')
       AND (SELECT count(*) FROM portal.staff_profiles WHERE active AND role='ADMIN') <= 1 THEN
      RAISE EXCEPTION 'Last administrator' USING ERRCODE='42501';
    END IF;
    -- An unfinished provider operation must be reconciled before another change.
    IF EXISTS(SELECT 1 FROM portal_private.staff_provider_operations WHERE profile_id=target_id AND completed_at IS NULL) THEN
      RAISE EXCEPTION 'Provider reconciliation pending' USING ERRCODE='55000';
    END IF;
    UPDATE portal.staff_profiles SET role=target_role,active=target_active WHERE id=target_id;
    IF NOT target_active OR old_profile.role<>target_role THEN
      INSERT INTO portal_private.staff_session_cutoffs VALUES(target_id,clock_timestamp())
        ON CONFLICT(profile_id) DO UPDATE SET revoked_before=EXCLUDED.revoked_before;
    END IF;
    IF old_profile.active IS DISTINCT FROM target_active THEN
      operation_id := gen_random_uuid();
      INSERT INTO portal_private.staff_provider_operations(id,profile_id,operation)
        VALUES(operation_id,target_id,CASE WHEN target_active THEN 'unban' ELSE 'ban' END);
    END IF;
    INSERT INTO portal.audit_logs(actor_id,object_type,object_id,action,safe_changes,request_id)
      VALUES(auth.uid(),'STAFF_PROFILE',target_id,'STAFF_CHANGED',
        jsonb_build_object('oldRole',old_profile.role,'role',target_role,'oldActive',old_profile.active,'active',target_active),request_id);
    RETURN operation_id;
END;
$$;

CREATE FUNCTION portal_private.reserve_staff_invitation(request_id uuid, email_hash bytea)
RETURNS TABLE(reserved boolean,profile_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE existing portal_private.staff_invitation_requests; inserted_id uuid;
BEGIN
    PERFORM portal_private.require_staff_admin();
    INSERT INTO portal_private.staff_invitation_requests(id,actor_id,email_hash)
      VALUES(request_id,auth.uid(),email_hash) ON CONFLICT(id) DO NOTHING RETURNING id INTO inserted_id;
    SELECT * INTO existing FROM portal_private.staff_invitation_requests WHERE id=request_id;
    IF existing.actor_id<>auth.uid() OR existing.email_hash<>reserve_staff_invitation.email_hash THEN
      RAISE EXCEPTION 'Invitation conflict' USING ERRCODE='42501';
    END IF;
    RETURN QUERY SELECT inserted_id IS NOT NULL,existing.profile_id;
END;
$$;
CREATE FUNCTION portal_private.complete_staff_invitation(request_id uuid,target_id uuid,display_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(710201);
    PERFORM portal_private.require_staff_admin();
    IF NOT EXISTS(SELECT 1 FROM portal_private.staff_invitation_requests r
      WHERE r.id=request_id AND r.actor_id=auth.uid() AND (r.profile_id IS NULL OR r.profile_id=target_id)) THEN
      RAISE EXCEPTION 'Invitation conflict' USING ERRCODE='42501';
    END IF;
    PERFORM portal_private.link_staff(target_id,display_name,request_id);
    UPDATE portal_private.staff_invitation_requests SET profile_id=target_id WHERE id=request_id;
END;
$$;

CREATE FUNCTION portal_private.pending_staff_provider_operation(operation_id uuid)
RETURNS TABLE(profile_id uuid,operation text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM portal_private.require_staff_admin();
    RETURN QUERY SELECT o.profile_id,o.operation FROM portal_private.staff_provider_operations o
      WHERE o.id=operation_id AND o.completed_at IS NULL;
END;
$$;
CREATE FUNCTION portal_private.complete_staff_provider_operation(operation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM portal_private.require_staff_admin();
    UPDATE portal_private.staff_provider_operations SET completed_at=statement_timestamp()
      WHERE id=operation_id AND completed_at IS NULL;
END;
$$;

-- Operator-only bootstrap: no runtime EXECUTE grant; shares the lifecycle lock.
CREATE FUNCTION portal_private.bootstrap_staff_admin(target_id uuid, display_name text, request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(710201);
    IF EXISTS(SELECT 1 FROM portal.staff_profiles WHERE active AND role='ADMIN') THEN
      RAISE EXCEPTION 'Administrator already exists';
    END IF;
    INSERT INTO portal.staff_profiles(id,display_name,role,active) VALUES(target_id,display_name,'ADMIN',true)
      ON CONFLICT(id) DO UPDATE SET role='ADMIN',active=true;
    INSERT INTO portal.audit_logs(actor_id,object_type,object_id,action,safe_changes,request_id)
      VALUES(NULL,'STAFF_PROFILE',target_id,'STAFF_BOOTSTRAPPED','{"role":"ADMIN","active":true}',request_id);
END;
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA portal_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION portal_private.require_staff_admin(), portal_private.bootstrap_staff_admin(uuid,text,uuid) FROM portal_runtime;
GRANT EXECUTE ON FUNCTION portal_private.staff_session_is_live(uuid), portal_private.consume_auth_attempt(uuid,text),
    portal_private.create_password_grant(uuid,bytea), portal_private.consume_password_grant(uuid,bytea),
    portal_private.link_staff(uuid,text,uuid), portal_private.change_staff(uuid,text,boolean,uuid),
    portal_private.reserve_staff_invitation(uuid,bytea), portal_private.complete_staff_invitation(uuid,uuid,text),
    portal_private.pending_staff_provider_operation(uuid), portal_private.complete_staff_provider_operation(uuid) TO portal_runtime;

-- Repeat the advisor fixes without assuming the optional provider helper exists.
DO $$ BEGIN
    IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
      REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
    END IF;
    IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
      REVOKE ALL ON TABLE public._prisma_migrations FROM PUBLIC, anon, authenticated;
    END IF;
END; $$;
COMMIT;
