BEGIN;

ALTER TABLE portal.candidates ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0),
  ADD COLUMN merged_into_id uuid REFERENCES portal.candidates(id) ON DELETE RESTRICT,
  ADD CONSTRAINT candidate_not_self_merged CHECK(merged_into_id IS NULL OR merged_into_id<>id);
CREATE INDEX candidates_merged_into_idx ON portal.candidates(merged_into_id);

CREATE ROLE portal_recruitment_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
DO $$ BEGIN EXECUTE format('GRANT portal_recruitment_owner TO %I',current_user); END $$;
GRANT CREATE ON SCHEMA portal_private TO portal_recruitment_owner;
GRANT USAGE ON SCHEMA portal,portal_private TO portal_recruitment_owner;
GRANT EXECUTE ON FUNCTION portal_private.staff_session_is_admitted(uuid) TO portal_recruitment_owner;
GRANT SELECT ON portal.staff_profiles,portal.candidates,portal.applications,portal.deletion_requests TO portal_recruitment_owner;
GRANT UPDATE(id) ON portal.staff_profiles TO portal_recruitment_owner;
GRANT UPDATE(merged_into_id,version) ON portal.candidates TO portal_recruitment_owner;
GRANT UPDATE(candidate_id,status,version,duplicate_candidate_match) ON portal.applications TO portal_recruitment_owner;
GRANT INSERT ON portal.audit_logs,portal.outbox_events TO portal_recruitment_owner;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['staff_profiles','candidates','applications','deletion_requests','audit_logs','outbox_events'] LOOP
    EXECUTE format('CREATE POLICY recruitment_owner ON portal.%I TO portal_recruitment_owner USING(true) WITH CHECK(true)',t);
  END LOOP;
END $$;
REVOKE UPDATE(status,version) ON portal.applications FROM portal_runtime;

CREATE TABLE portal_private.recruitment_commands (
  request_id uuid PRIMARY KEY,actor_id uuid NOT NULL,command jsonb NOT NULL,result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE portal_private.recruitment_commands ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON portal_private.recruitment_commands TO portal_recruitment_owner;
CREATE POLICY recruitment_command_owner ON portal_private.recruitment_commands TO portal_recruitment_owner USING(true) WITH CHECK(true);

-- A short transaction lock serializes rare identity changes, attachments and
-- deletion requests before any row locks, including writes by future intake.
CREATE FUNCTION portal_private.lock_candidate_identity() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN PERFORM pg_advisory_xact_lock(72705,1); RETURN NULL; END $$;
CREATE TRIGGER candidate_identity_lock BEFORE INSERT OR UPDATE OR DELETE ON portal.candidates FOR EACH STATEMENT EXECUTE FUNCTION portal_private.lock_candidate_identity();
CREATE TRIGGER application_identity_lock BEFORE INSERT OR UPDATE OF candidate_id OR DELETE ON portal.applications FOR EACH STATEMENT EXECUTE FUNCTION portal_private.lock_candidate_identity();
CREATE TRIGGER deletion_identity_lock BEFORE INSERT OR UPDATE OR DELETE ON portal.deletion_requests FOR EACH STATEMENT EXECUTE FUNCTION portal_private.lock_candidate_identity();

CREATE FUNCTION portal_private.candidate_group_blocked(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT EXISTS(SELECT 1 FROM portal.candidates WHERE id=p_id)
 OR EXISTS(SELECT 1 FROM portal.candidates c
   WHERE coalesce(c.merged_into_id,c.id)=(SELECT coalesce(merged_into_id,id) FROM portal.candidates WHERE id=p_id)
   AND (c.deletion_requested_at IS NOT NULL OR EXISTS(SELECT 1 FROM portal.deletion_requests d WHERE d.candidate_id=c.id AND d.state<>'REJECTED')))
$$;

CREATE FUNCTION portal_private.candidate_version_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  NEW.version:=OLD.version+1;
  IF NEW.merged_into_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM portal.candidates WHERE id=NEW.merged_into_id AND merged_into_id IS NULL) THEN
    RAISE EXCEPTION 'Invalid candidate alias' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER candidate_version_guard BEFORE UPDATE ON portal.candidates FOR EACH ROW EXECUTE FUNCTION portal_private.candidate_version_guard();

CREATE FUNCTION portal_private.canonical_application_candidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.candidate_id IS NOT NULL THEN
    IF portal_private.candidate_group_blocked(NEW.candidate_id) THEN RAISE EXCEPTION 'Candidate unavailable' USING ERRCODE='55000'; END IF;
    SELECT coalesce(merged_into_id,id) INTO NEW.candidate_id FROM portal.candidates WHERE id=NEW.candidate_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER canonical_application_candidate BEFORE INSERT OR UPDATE OF candidate_id ON portal.applications FOR EACH ROW EXECUTE FUNCTION portal_private.canonical_application_candidate();

CREATE FUNCTION portal_private.manage_recruitment(p_kind text,p_id uuid,p_expected integer,p_request uuid,p_status text DEFAULT NULL,p_source uuid DEFAULT NULL,p_source_version integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; role_name text; command jsonb; previous portal_private.recruitment_commands%ROWTYPE;
  a portal.applications%ROWTYPE; target portal.candidates%ROWTYPE; source portal.candidates%ROWTYPE; result jsonb; affected integer:=0; event_name text;
BEGIN
  IF p_id IS NULL OR p_request IS NULL OR p_expected IS NULL OR p_expected<1 OR p_kind IS NULL OR p_kind NOT IN('stage','merge') THEN RAISE EXCEPTION 'Invalid command' USING ERRCODE='22023'; END IF;
  IF portal_private.staff_session_is_admitted((nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid) IS NOT TRUE THEN RAISE EXCEPTION 'Session not admitted' USING ERRCODE='42501'; END IF;
  SELECT role INTO role_name FROM portal.staff_profiles WHERE id=actor AND active FOR SHARE;
  IF role_name IS NULL OR role_name NOT IN('HR','ADMIN') THEN RAISE EXCEPTION 'Denied' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(72705,1);
  command:=jsonb_build_object('kind',p_kind,'id',p_id,'expectedVersion',p_expected,'status',p_status,'sourceId',p_source,'sourceVersion',p_source_version);
  SELECT * INTO previous FROM portal_private.recruitment_commands WHERE request_id=p_request;
  IF FOUND THEN
    IF previous.actor_id<>actor OR previous.command<>command THEN RAISE EXCEPTION 'Request conflict' USING ERRCODE='40001'; END IF;
    RETURN previous.result;
  END IF;
  IF p_kind='stage' THEN
    IF p_status IS NULL OR p_status NOT IN('NEW','SCREENING','INTERVIEW','OFFER','REJECTED') OR p_source IS NOT NULL OR p_source_version IS NOT NULL THEN RAISE EXCEPTION 'Invalid stage' USING ERRCODE='22023'; END IF;
    SELECT * INTO a FROM portal.applications WHERE id=p_id AND intake_state='CONFIRMED' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Missing application' USING ERRCODE='P0002'; END IF;
    IF a.version<>p_expected THEN RAISE EXCEPTION 'Stale application' USING ERRCODE='40001'; END IF;
    IF portal_private.candidate_group_blocked(a.candidate_id) THEN RAISE EXCEPTION 'Candidate unavailable' USING ERRCODE='55000'; END IF;
    UPDATE portal.applications SET status=p_status,version=version+1 WHERE id=p_id;
    result:=jsonb_build_object('id',p_id,'version',a.version+1,'status',p_status);
    event_name:='APPLICATION_STAGE_CHANGED';
  ELSE
    IF p_source IS NULL OR p_source=p_id OR p_source_version IS NULL OR p_source_version<1 OR p_status IS NOT NULL THEN RAISE EXCEPTION 'Invalid merge' USING ERRCODE='22023'; END IF;
    PERFORM id FROM portal.candidates WHERE id IN(p_id,p_source) OR merged_into_id IN(p_id,p_source) ORDER BY id FOR UPDATE;
    SELECT * INTO target FROM portal.candidates WHERE id=p_id;
    SELECT * INTO source FROM portal.candidates WHERE id=p_source;
    IF target.id IS NULL OR source.id IS NULL THEN RAISE EXCEPTION 'Missing candidate' USING ERRCODE='P0002'; END IF;
    IF target.version<>p_expected OR source.version<>p_source_version OR target.merged_into_id IS NOT NULL OR source.merged_into_id IS NOT NULL
      OR portal_private.candidate_group_blocked(p_id) OR portal_private.candidate_group_blocked(p_source) THEN RAISE EXCEPTION 'Merge conflict' USING ERRCODE='40001'; END IF;
    UPDATE portal.applications SET candidate_id=p_id,version=version+1 WHERE candidate_id=p_source OR candidate_id IN(SELECT id FROM portal.candidates WHERE merged_into_id=p_source);
    GET DIAGNOSTICS affected=ROW_COUNT;
    UPDATE portal.candidates SET merged_into_id=p_id WHERE merged_into_id=p_source;
    UPDATE portal.candidates SET merged_into_id=p_id WHERE id=p_source;
    UPDATE portal.candidates SET version=version+1 WHERE id=p_id;
    result:=jsonb_build_object('id',p_id,'sourceId',p_source,'version',p_expected+1,'applicationsMoved',affected);
    event_name:='CANDIDATES_MERGED';
  END IF;
  INSERT INTO portal.audit_logs(actor_id,object_type,object_id,action,safe_changes,request_id)
    VALUES(actor,CASE WHEN p_kind='stage' THEN 'APPLICATION' ELSE 'CANDIDATE' END,p_id,event_name,result,p_request);
  INSERT INTO portal.outbox_events(event_type,aggregate_id,delivery_key,safe_references)
    VALUES(event_name,p_id,'recruitment:'||p_request::text,result);
  INSERT INTO portal_private.recruitment_commands(request_id,actor_id,command,result) VALUES(p_request,actor,command,result);
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION portal_private.lock_candidate_identity(),portal_private.candidate_group_blocked(uuid),portal_private.candidate_version_guard(),portal_private.canonical_application_candidate(),portal_private.manage_recruitment(text,uuid,integer,uuid,text,uuid,integer) FROM PUBLIC;
ALTER FUNCTION portal_private.candidate_group_blocked(uuid) OWNER TO portal_recruitment_owner;
ALTER FUNCTION portal_private.manage_recruitment(text,uuid,integer,uuid,text,uuid,integer) OWNER TO portal_recruitment_owner;
GRANT EXECUTE ON FUNCTION portal_private.candidate_group_blocked(uuid),portal_private.manage_recruitment(text,uuid,integer,uuid,text,uuid,integer) TO portal_runtime;

CREATE OR REPLACE FUNCTION portal_private.record_cv_access(application_id uuid, request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target_upload uuid;
BEGIN
  IF portal_private.current_staff_role() IS NULL OR portal_private.current_staff_role() NOT IN('ADMIN','HR') THEN RAISE EXCEPTION 'CV access denied' USING ERRCODE='42501'; END IF;
  SELECT u.id INTO target_upload FROM portal.applications a JOIN portal.uploads u ON u.id=a.cv_upload_id
    WHERE a.id=application_id AND a.intake_state='CONFIRMED' AND u.scan_state='CLEAN' AND u.access_revoked_at IS NULL
      AND u.storage_provider='SUPABASE' AND u.bucket='cv-clean' AND NOT portal_private.candidate_group_blocked(a.candidate_id);
  IF target_upload IS NULL THEN RAISE EXCEPTION 'CV access denied' USING ERRCODE='42501'; END IF;
  INSERT INTO portal.audit_logs(actor_id,object_type,object_id,action,safe_changes,request_id)
    VALUES(auth.uid(),'APPLICATION',application_id,'CV_URL_ISSUED',jsonb_build_object('uploadId',target_upload),request_id);
END $$;

REVOKE CREATE ON SCHEMA portal_private FROM portal_recruitment_owner;
DO $$ BEGIN EXECUTE format('REVOKE portal_recruitment_owner FROM %I',current_user); END $$;

COMMIT;
