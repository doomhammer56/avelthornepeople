BEGIN;

-- Opaque HMAC identifiers only. Nonzero failures are not aged out by housekeeping.
CREATE TABLE portal_private.login_states (
  id uuid PRIMARY KEY,
  failures smallint NOT NULL DEFAULT 0 CHECK (failures BETWEEN 0 AND 5),
  locked_at timestamptz,
  locked_until timestamptz,
  lease_id uuid,
  lease_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((locked_at IS NULL) = (locked_until IS NULL)),
  CHECK ((lease_id IS NULL) = (lease_until IS NULL)),
  CHECK ((failures = 5) = (locked_until IS NOT NULL)),
  CHECK (locked_until IS NULL OR locked_until = locked_at + interval '15 minutes')
);
CREATE INDEX login_states_idle_idx ON portal_private.login_states(updated_at) WHERE failures=0;
CREATE TABLE portal_private.staff_session_admissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL UNIQUE REFERENCES auth.sessions(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  admitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX staff_session_admissions_expiry_idx ON portal_private.staff_session_admissions(expires_at);
ALTER TABLE portal_private.login_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_private.staff_session_admissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal_private.login_states, portal_private.staff_session_admissions
  FROM PUBLIC, anon, authenticated, service_role, portal_runtime;

CREATE FUNCTION portal_private.staff_session_is_admitted(session_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT portal_private.staff_session_is_live(session_id) AND EXISTS (
    SELECT 1 FROM portal_private.staff_session_admissions a
    WHERE a.session_id=staff_session_is_admitted.session_id AND a.subject_id=auth.uid()
      AND a.expires_at>statement_timestamp()
  )
$$;

CREATE OR REPLACE FUNCTION portal_private.require_staff_admin() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF portal_private.current_staff_role() IS DISTINCT FROM 'ADMIN'
     OR NOT portal_private.staff_session_is_admitted(
       (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid) THEN
    RAISE EXCEPTION 'Staff access denied' USING ERRCODE='42501';
  END IF;
END;
$$;

-- No transaction is held over the provider call. Each reservation is fenced.
CREATE FUNCTION portal_private.begin_staff_login(key_id uuid)
RETURNS TABLE(outcome text, reservation_id uuid, retry_after_seconds integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s portal_private.login_states; instant timestamptz; ticket uuid;
BEGIN
  IF key_id IS NULL THEN RAISE EXCEPTION 'Invalid identifier'; END IF;
  DELETE FROM portal_private.login_states WHERE id IN (
    SELECT id FROM portal_private.login_states
    WHERE failures=0 AND updated_at<statement_timestamp()-interval '1 day'
      AND (lease_until IS NULL OR lease_until<=statement_timestamp())
    ORDER BY updated_at LIMIT 100 FOR UPDATE SKIP LOCKED
  );
  DELETE FROM portal_private.staff_session_admissions WHERE id IN (
    SELECT id FROM portal_private.staff_session_admissions WHERE expires_at<=statement_timestamp()
    ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED
  );
  INSERT INTO portal_private.login_states(id) VALUES(key_id) ON CONFLICT(id) DO NOTHING;
  SELECT * INTO s FROM portal_private.login_states WHERE id=key_id FOR UPDATE;
  instant := clock_timestamp();
  IF s.locked_until>instant THEN
    RETURN QUERY SELECT 'locked',NULL::uuid,ceil(extract(epoch FROM s.locked_until-instant))::integer;
    RETURN;
  END IF;
  IF s.lease_until>instant THEN
    RETURN QUERY SELECT 'busy',NULL::uuid,ceil(extract(epoch FROM s.lease_until-instant))::integer;
    RETURN;
  END IF;
  ticket := gen_random_uuid();
  UPDATE portal_private.login_states SET
    failures=CASE WHEN locked_until IS NOT NULL THEN 0 ELSE failures END,
    locked_at=NULL,locked_until=NULL,lease_id=ticket,lease_until=instant+interval '60 seconds',updated_at=instant
    WHERE id=key_id;
  RETURN QUERY SELECT 'ready',ticket,0;
END;
$$;

CREATE FUNCTION portal_private.finish_staff_login(key_id uuid, ticket uuid, result text, session_id uuid)
RETURNS TABLE(outcome text, retry_after_seconds integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s portal_private.login_states; instant timestamptz; deadline timestamptz;
BEGIN
  IF result IS NULL OR result NOT IN ('invalid','abort','success') THEN RAISE EXCEPTION 'Invalid result'; END IF;
  -- Serialize successful profile/session checks with staff lifecycle commands.
  IF result='success' THEN PERFORM pg_advisory_xact_lock(710201); END IF;
  SELECT * INTO s FROM portal_private.login_states WHERE id=key_id FOR UPDATE;
  instant := clock_timestamp();
  IF NOT FOUND OR ticket IS NULL OR s.lease_id IS DISTINCT FROM ticket OR s.lease_until<=instant THEN
    RETURN QUERY SELECT 'stale',0; RETURN;
  END IF;
  IF result='success' THEN
    IF NOT portal_private.staff_session_is_live(session_id)
       OR portal_private.current_staff_role() IS NULL
       OR session_id IS DISTINCT FROM
         (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid THEN
      UPDATE portal_private.login_states SET lease_id=NULL,lease_until=NULL,updated_at=instant WHERE id=key_id;
      RETURN QUERY SELECT 'denied',0; RETURN;
    END IF;
    SELECT least(coalesce(not_after,instant+interval '30 days'),instant+interval '30 days') INTO deadline
      FROM auth.sessions WHERE id=session_id AND user_id=auth.uid();
    INSERT INTO portal_private.staff_session_admissions(session_id,subject_id,admitted_at,expires_at)
      VALUES(session_id,auth.uid(),instant,deadline) ON CONFLICT ON CONSTRAINT staff_session_admissions_session_id_key DO NOTHING;
    UPDATE portal_private.login_states SET failures=0,lease_id=NULL,lease_until=NULL,updated_at=instant WHERE id=key_id;
    RETURN QUERY SELECT 'admitted',0; RETURN;
  END IF;
  IF result='invalid' AND s.failures=4 THEN
    UPDATE portal_private.login_states SET failures=5,locked_at=instant,locked_until=instant+interval '15 minutes',
      lease_id=NULL,lease_until=NULL,updated_at=instant WHERE id=key_id;
    RETURN QUERY SELECT 'locked',900; RETURN;
  END IF;
  UPDATE portal_private.login_states SET failures=failures+CASE WHEN result='invalid' THEN 1 ELSE 0 END,
    lease_id=NULL,lease_until=NULL,updated_at=instant WHERE id=key_id;
  RETURN QUERY SELECT CASE WHEN result='invalid' THEN 'invalid' ELSE 'aborted' END,0;
END;
$$;

-- Independent IP/recovery traffic windows; return actual remaining duration.
CREATE FUNCTION portal_private.consume_login_traffic(key_id uuid, attempt_scope text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s portal_private.auth_attempts; instant timestamptz := clock_timestamp(); budget integer;
BEGIN
  IF attempt_scope IS NULL OR attempt_scope NOT IN ('ip','account') THEN RAISE EXCEPTION 'Invalid scope'; END IF;
  budget := CASE WHEN attempt_scope='ip' THEN 20 ELSE 5 END;
  DELETE FROM portal_private.auth_attempts WHERE id IN (
    SELECT id FROM portal_private.auth_attempts WHERE window_start<instant-interval '15 minutes'
    ORDER BY window_start LIMIT 100 FOR UPDATE SKIP LOCKED
  );
  INSERT INTO portal_private.auth_attempts(id,scope,window_start,attempts) VALUES(key_id,attempt_scope,instant,1)
  ON CONFLICT(id) DO UPDATE SET
    window_start=CASE WHEN portal_private.auth_attempts.window_start<=instant-interval '15 minutes' THEN instant ELSE portal_private.auth_attempts.window_start END,
    attempts=CASE WHEN portal_private.auth_attempts.window_start<=instant-interval '15 minutes' THEN 1 ELSE least(portal_private.auth_attempts.attempts+1,1000000) END
  RETURNING * INTO s;
  RETURN CASE WHEN s.attempts<=budget THEN 0 ELSE greatest(1,ceil(extract(epoch FROM s.window_start+interval '15 minutes'-clock_timestamp()))::integer) END;
END;
$$;

REVOKE ALL ON FUNCTION portal_private.staff_session_is_admitted(uuid),
  portal_private.begin_staff_login(uuid),portal_private.finish_staff_login(uuid,uuid,text,uuid),
  portal_private.consume_login_traffic(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION portal_private.staff_session_is_admitted(uuid),
  portal_private.begin_staff_login(uuid),portal_private.finish_staff_login(uuid,uuid,text,uuid),
  portal_private.consume_login_traffic(uuid,text) TO portal_runtime;
COMMIT;
