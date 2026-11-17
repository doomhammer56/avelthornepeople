BEGIN;

-- A password update is a provider write: an uncertain operation is never retried
-- with the same grant. Only a confirmed, non-mutating rejection can release it.
ALTER TABLE portal_private.password_grants
  ADD COLUMN operation_id uuid,
  ADD COLUMN completed_at timestamptz,
  ADD CONSTRAINT password_grants_completion_check CHECK (completed_at IS NULL OR used_at IS NOT NULL);

CREATE OR REPLACE FUNCTION portal_private.create_password_grant(session_id uuid, token_hash bytea)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT portal_private.staff_session_is_live(session_id) OR octet_length(token_hash)<>32 THEN
    RAISE EXCEPTION 'Staff access denied' USING ERRCODE='42501';
  END IF;
  DELETE FROM portal_private.password_grants WHERE id IN (
    SELECT id FROM portal_private.password_grants
    WHERE expires_at<statement_timestamp() AND
      (operation_id IS NULL OR completed_at IS NOT NULL OR used_at<statement_timestamp()-interval '1 hour')
    ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED
  );
  INSERT INTO portal_private.password_grants(token_hash,subject_id,session_id,expires_at)
    VALUES(token_hash,auth.uid(),session_id,statement_timestamp()+interval '10 minutes');
END;
$$;

CREATE FUNCTION portal_private.password_grant_is_valid(session_id uuid, token_hash bytea)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT portal_private.staff_session_is_live(session_id) AND EXISTS (
    SELECT 1 FROM portal_private.password_grants g
    WHERE g.subject_id=auth.uid() AND g.session_id=password_grant_is_valid.session_id
      AND g.token_hash=password_grant_is_valid.token_hash AND g.used_at IS NULL
      AND g.expires_at>statement_timestamp()
  )
$$;

CREATE FUNCTION portal_private.begin_password_change(session_id uuid, token_hash bytea)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ticket uuid := gen_random_uuid(); claimed uuid;
BEGIN
  IF NOT portal_private.staff_session_is_live(session_id) THEN RETURN NULL; END IF;
  UPDATE portal_private.password_grants g SET used_at=clock_timestamp(),operation_id=ticket
    WHERE g.subject_id=auth.uid() AND g.session_id=begin_password_change.session_id
      AND g.token_hash=begin_password_change.token_hash AND g.used_at IS NULL
      AND g.expires_at>clock_timestamp()
    RETURNING g.id INTO claimed;
  RETURN CASE WHEN claimed IS NOT NULL THEN ticket ELSE NULL END;
END;
$$;

CREATE FUNCTION portal_private.finish_password_change(session_id uuid, token_hash bytea, ticket uuid, result text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g portal_private.password_grants; instant timestamptz;
BEGIN
  IF result IS NULL OR result NOT IN ('retry','complete','uncertain') THEN RAISE EXCEPTION 'Invalid result'; END IF;
  IF result<>'retry' THEN PERFORM pg_advisory_xact_lock(710201); END IF;
  SELECT * INTO g FROM portal_private.password_grants p
    WHERE p.subject_id=auth.uid() AND p.session_id=finish_password_change.session_id
      AND p.token_hash=finish_password_change.token_hash FOR UPDATE;
  IF NOT FOUND OR ticket IS NULL OR g.operation_id IS DISTINCT FROM ticket THEN RETURN false; END IF;
  IF g.completed_at IS NOT NULL THEN RETURN result<>'retry'; END IF;
  instant := clock_timestamp();
  IF result='retry' THEN
    IF g.expires_at<=instant OR NOT portal_private.staff_session_is_live(session_id) THEN RETURN false; END IF;
    UPDATE portal_private.password_grants SET used_at=NULL,operation_id=NULL WHERE id=g.id;
    RETURN true;
  END IF;
  UPDATE portal_private.password_grants SET completed_at=instant WHERE id=g.id;
  -- Revoke old app sessions even if the provider's later global sign-out fails.
  INSERT INTO portal_private.staff_session_cutoffs(profile_id,revoked_before)
    SELECT id,instant FROM portal.staff_profiles WHERE id=auth.uid()
    ON CONFLICT(profile_id) DO UPDATE SET revoked_before=greatest(
      portal_private.staff_session_cutoffs.revoked_before,EXCLUDED.revoked_before);
  INSERT INTO portal.audit_logs(actor_id,object_type,object_id,action,safe_changes,request_id)
    VALUES(NULL,'AUTH_ACCOUNT',auth.uid(),CASE WHEN result='complete' THEN 'PASSWORD_CHANGED' ELSE 'PASSWORD_CHANGE_UNCERTAIN' END,'{}',ticket);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION portal_private.password_grant_is_valid(uuid,bytea),
  portal_private.begin_password_change(uuid,bytea),portal_private.finish_password_change(uuid,bytea,uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION portal_private.password_grant_is_valid(uuid,bytea),
  portal_private.begin_password_change(uuid,bytea),portal_private.finish_password_change(uuid,bytea,uuid,text)
  TO portal_runtime;
COMMIT;
