BEGIN;
SET LOCAL TIME ZONE 'UTC';

-- Retention is an organisation policy, not a statutory blanket duration. The
-- current recruitment consent permits at most 24 months. Deployment does not
-- enable destructive scheduled retention; an ADMIN must explicitly activate it.
CREATE TABLE portal.privacy_policy (
  id integer PRIMARY KEY DEFAULT 1 CHECK(id=1),
  retention_months integer NOT NULL DEFAULT 24 CHECK(retention_months BETWEEN 1 AND 24),
  evidence_months integer NOT NULL DEFAULT 24 CHECK(evidence_months BETWEEN 1 AND 24),
  retention_enabled boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO portal.privacy_policy(id) VALUES(1);
ALTER TABLE portal.privacy_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.privacy_policy FROM PUBLIC;
GRANT SELECT ON portal.privacy_policy TO portal_runtime;
CREATE POLICY privacy_policy_admin ON portal.privacy_policy FOR SELECT TO portal_runtime
  USING((SELECT portal_private.current_staff_role())='ADMIN');

ALTER TABLE portal.applications ADD COLUMN retention_expires_at timestamptz;
UPDATE portal.applications SET retention_expires_at=submitted_at+interval '24 months';
ALTER TABLE portal.applications ALTER COLUMN retention_expires_at SET NOT NULL;
CREATE INDEX applications_retention_idx ON portal.applications(retention_expires_at,id);
ALTER TABLE portal.deletion_requests ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0),
  ADD COLUMN decision_code text CHECK(decision_code IN('IDENTITY_UNVERIFIED','DUPLICATE','NOT_APPLICABLE'));

CREATE TABLE portal.candidate_legal_holds (
  candidate_id uuid PRIMARY KEY REFERENCES portal.candidates(id) ON DELETE CASCADE,
  case_ref uuid NOT NULL,reason_code text NOT NULL CHECK(reason_code IN('LEGAL_OBLIGATION','LEGAL_CLAIM')),
  hold_until timestamptz NOT NULL,released_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_by uuid NOT NULL REFERENCES portal.staff_profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE portal.candidate_legal_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.candidate_legal_holds FROM PUBLIC;
GRANT SELECT ON portal.candidate_legal_holds TO portal_runtime;
CREATE POLICY legal_holds_admin ON portal.candidate_legal_holds FOR SELECT TO portal_runtime
  USING((SELECT portal_private.current_staff_role())='ADMIN');

CREATE ROLE portal_privacy_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE portal_privacy_worker NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT portal_privacy_owner TO CURRENT_USER;
GRANT USAGE ON SCHEMA portal,portal_private TO portal_privacy_owner;
GRANT USAGE ON SCHEMA portal_private TO portal_privacy_worker;
GRANT CREATE ON SCHEMA portal_private TO portal_privacy_owner;
GRANT EXECUTE ON FUNCTION portal_private.staff_session_is_admitted(uuid) TO portal_privacy_owner;
GRANT EXECUTE ON FUNCTION portal_private.candidate_group_blocked(uuid) TO portal_privacy_owner;
GRANT SELECT ON portal.staff_profiles,portal.candidates,portal.applications,portal.uploads,
  portal.deletion_requests,portal.privacy_policy,portal.candidate_legal_holds TO portal_privacy_owner;
GRANT UPDATE(id) ON portal.staff_profiles TO portal_privacy_owner;
GRANT UPDATE(id) ON portal.applications TO portal_privacy_owner;
GRANT INSERT,UPDATE,DELETE ON portal.deletion_requests,portal.candidate_legal_holds TO portal_privacy_owner;
GRANT UPDATE ON portal.privacy_policy TO portal_privacy_owner;
GRANT UPDATE(access_revoked_at) ON portal.uploads TO portal_privacy_owner;
GRANT DELETE ON portal.applications,portal.uploads,portal.candidates TO portal_privacy_owner;
GRANT INSERT,DELETE ON portal.audit_logs,portal.outbox_events TO portal_privacy_owner;
GRANT SELECT,DELETE ON portal_private.recruitment_commands TO portal_privacy_owner;
CREATE POLICY privacy_recruitment_commands ON portal_private.recruitment_commands TO portal_privacy_owner USING(true) WITH CHECK(true);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['staff_profiles','candidates','applications','uploads','deletion_requests','privacy_policy','candidate_legal_holds','audit_logs','outbox_events'] LOOP
    EXECUTE format('CREATE POLICY privacy_owner ON portal.%I TO portal_privacy_owner USING(true) WITH CHECK(true)',t);
  END LOOP;
END $$;
GRANT SELECT ON portal.audit_logs,portal.outbox_events TO portal_privacy_owner;

CREATE TABLE portal_private.privacy_commands (
  request_id uuid PRIMARY KEY,actor_id uuid NOT NULL,target_id uuid NOT NULL,
  digest text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
-- Non-personal history prevents a relaxed policy resurrecting expired data.
CREATE TABLE portal_private.privacy_policy_history (
  version integer PRIMARY KEY,retention_months integer NOT NULL CHECK(retention_months BETWEEN 1 AND 24),
  effective_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
INSERT INTO portal_private.privacy_policy_history(version,retention_months) VALUES(1,24);
ALTER TABLE portal_private.privacy_policy_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal_private.privacy_policy_history FROM PUBLIC;
GRANT SELECT,INSERT ON portal_private.privacy_policy_history TO portal_privacy_owner;
CREATE POLICY privacy_owner ON portal_private.privacy_policy_history TO portal_privacy_owner USING(true) WITH CHECK(true);
CREATE TABLE portal_private.privacy_erasure_jobs (
  application_id uuid PRIMARY KEY REFERENCES portal.applications(id) ON DELETE CASCADE,
  upload_id uuid NOT NULL REFERENCES portal.uploads(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK(reason IN('REQUEST','RETENTION')),
  available_at timestamptz NOT NULL,lease_token uuid,lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((lease_token IS NULL)=(lease_until IS NULL))
);
CREATE INDEX privacy_erasure_jobs_due_idx ON portal_private.privacy_erasure_jobs(available_at,application_id);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['privacy_commands','privacy_erasure_jobs'] LOOP
    EXECUTE format('ALTER TABLE portal_private.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON portal_private.%I FROM PUBLIC',t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON portal_private.%I TO portal_privacy_owner',t);
    EXECUTE format('CREATE POLICY privacy_owner ON portal_private.%I TO portal_privacy_owner USING(true) WITH CHECK(true)',t);
  END LOOP;
END $$;

CREATE FUNCTION portal_private.privacy_group(p_candidate uuid) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce(array_agg(id ORDER BY id),'{}'::uuid[]) FROM portal.candidates
    WHERE coalesce(merged_into_id,id)=(SELECT coalesce(merged_into_id,id) FROM portal.candidates WHERE id=p_candidate)
$$;
CREATE FUNCTION portal_private.privacy_group_held(p_candidate uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM portal.candidate_legal_holds WHERE candidate_id=ANY(portal_private.privacy_group(p_candidate))
    AND released_at IS NULL AND hold_until>statement_timestamp())
$$;
CREATE FUNCTION portal_private.privacy_retention_deadline(p_submitted timestamptz,p_expires timestamptz) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT least(p_expires,p_submitted+make_interval(months=>coalesce((SELECT min(retention_months)
    FROM portal_private.privacy_policy_history WHERE effective_at>=p_submitted OR version=(
      SELECT version FROM portal_private.privacy_policy_history WHERE effective_at<p_submitted ORDER BY effective_at DESC,version DESC LIMIT 1)),24)))
$$;
CREATE FUNCTION portal_private.application_data_available(p_id uuid,p_submitted timestamptz,p_expires timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT portal_private.privacy_retention_deadline(p_submitted,p_expires)>statement_timestamp()
    AND NOT EXISTS(SELECT 1 FROM portal_private.privacy_erasure_jobs WHERE application_id=p_id)
    AND NOT EXISTS(SELECT 1 FROM portal.applications a WHERE a.id=p_id AND portal_private.candidate_group_blocked(a.candidate_id))
$$;
CREATE FUNCTION portal_private.candidate_data_available(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT NOT portal_private.candidate_group_blocked(p_id) AND EXISTS(SELECT 1 FROM portal.candidates c WHERE c.id=p_id AND (
    EXISTS(SELECT 1 FROM portal.applications a WHERE a.candidate_id=ANY(portal_private.privacy_group(c.id))
      AND portal_private.application_data_available(a.id,a.submitted_at,a.retention_expires_at))
    OR (NOT EXISTS(SELECT 1 FROM portal.applications a WHERE a.candidate_id=ANY(portal_private.privacy_group(c.id)))
      AND portal_private.privacy_retention_deadline(c.created_at,c.created_at+interval '24 months')>statement_timestamp())))
$$;

CREATE FUNCTION portal_private.guard_application_retention() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.retention_expires_at:=NEW.submitted_at+make_interval(months=>(SELECT retention_months FROM portal.privacy_policy WHERE id=1));
  ELSE
    IF (NEW.submitted_at,NEW.retention_expires_at) IS DISTINCT FROM (OLD.submitted_at,OLD.retention_expires_at) THEN
      RAISE EXCEPTION 'Retention deadline is immutable' USING ERRCODE='22023';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT portal_private.application_data_available(OLD.id,OLD.submitted_at,OLD.retention_expires_at) THEN
      RAISE EXCEPTION 'Application unavailable' USING ERRCODE='55000';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER application_retention BEFORE INSERT OR UPDATE ON portal.applications
  FOR EACH ROW EXECUTE FUNCTION portal_private.guard_application_retention();
CREATE POLICY applications_retention ON portal.applications AS RESTRICTIVE FOR SELECT TO portal_runtime
  USING(portal_private.application_data_available(id,submitted_at,retention_expires_at));
CREATE POLICY candidates_retention ON portal.candidates AS RESTRICTIVE FOR SELECT TO portal_runtime
  USING(portal_private.candidate_data_available(id));

CREATE FUNCTION portal_private.manage_privacy(p_kind text,p_id uuid,p_expected integer,p_request uuid,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
  saved portal_private.privacy_commands%ROWTYPE; d portal.deletion_requests%ROWTYPE;
  h portal.candidate_legal_holds%ROWTYPE; policy portal.privacy_policy%ROWTYPE;
  fingerprint text; result jsonb; event_name text; object_kind text;
  group_ids uuid[]; root uuid; received timestamptz; until_at timestamptz;
BEGIN
  IF portal_private.staff_session_is_admitted((nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid) IS NOT TRUE THEN
    RAISE EXCEPTION 'Session not admitted' USING ERRCODE='42501'; END IF;
  PERFORM id FROM portal.staff_profiles WHERE id=actor AND active AND role='ADMIN' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Denied' USING ERRCODE='42501'; END IF;
  IF p_id IS NULL OR p_request IS NULL OR p_kind IS NULL OR p_kind NOT IN('request','verify','reject','hold','release','policy')
    OR p_body IS NULL OR jsonb_typeof(p_body)<>'object' OR octet_length(p_body::text)>2048 THEN
    RAISE EXCEPTION 'Invalid privacy command' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(72705,1);
  fingerprint:=encode(sha256(convert_to(jsonb_build_object('kind',p_kind,'id',p_id,'expected',p_expected,'body',p_body)::text,'UTF8')),'hex');
  SELECT * INTO saved FROM portal_private.privacy_commands WHERE request_id=p_request;
  IF FOUND THEN
    IF saved.actor_id<>actor OR saved.digest<>fingerprint THEN RAISE EXCEPTION 'Request conflict' USING ERRCODE='40001'; END IF;
    RETURN saved.result;
  END IF;
  IF p_kind='request' THEN
    IF p_expected IS NOT NULL OR p_body-ARRAY['candidateId','requesterRef','receivedAt']<>'{}'::jsonb
      OR NOT(p_body ?& ARRAY['candidateId','requesterRef']) THEN RAISE EXCEPTION 'Invalid request' USING ERRCODE='22023'; END IF;
    group_ids:=portal_private.privacy_group((p_body->>'candidateId')::uuid);
    IF cardinality(group_ids)=0 THEN RAISE EXCEPTION 'Candidate missing' USING ERRCODE='P0002'; END IF;
    IF EXISTS(SELECT 1 FROM portal.deletion_requests WHERE candidate_id=ANY(group_ids) AND state NOT IN('COMPLETED','REJECTED')) THEN
      RAISE EXCEPTION 'Open request exists' USING ERRCODE='40001'; END IF;
    received:=coalesce((p_body->>'receivedAt')::timestamptz,statement_timestamp());
    IF NOT isfinite(received) OR received>statement_timestamp() OR (p_body->>'requesterRef')::uuid IS NULL THEN
      RAISE EXCEPTION 'Invalid receipt' USING ERRCODE='22023'; END IF;
    INSERT INTO portal.deletion_requests(id,candidate_id,verified_requester_ref,reason_code,requested_at,due_at)
      VALUES(p_id,(p_body->>'candidateId')::uuid,(p_body->>'requesterRef')::uuid,'ERASURE',received,received+interval '1 month');
    result:=jsonb_build_object('id',p_id,'version',1); event_name:='DELETION_REQUESTED'; object_kind:='PRIVACY_REQUEST';
  ELSIF p_kind IN('verify','reject') THEN
    IF p_expected IS NULL OR p_expected<1 OR p_body-ARRAY['reasonCode']<>'{}'::jsonb
      OR (p_kind='verify' AND p_body<>'{}'::jsonb) THEN RAISE EXCEPTION 'Invalid decision' USING ERRCODE='22023'; END IF;
    SELECT * INTO d FROM portal.deletion_requests WHERE id=p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Request missing' USING ERRCODE='P0002'; END IF;
    IF d.version<>p_expected OR d.state NOT IN('REQUESTED','VERIFIED','ON_HOLD') THEN RAISE EXCEPTION 'Request conflict' USING ERRCODE='40001'; END IF;
    IF p_kind='verify' THEN
      IF d.state<>'REQUESTED' OR d.candidate_id IS NULL THEN RAISE EXCEPTION 'Request conflict' USING ERRCODE='40001'; END IF;
      UPDATE portal.deletion_requests SET state=CASE WHEN portal_private.privacy_group_held(d.candidate_id) THEN 'ON_HOLD' ELSE 'VERIFIED' END,
        verified_at=statement_timestamp(),verified_by=actor,version=version+1 WHERE id=p_id;
      event_name:='DELETION_VERIFIED';
    ELSE
      IF p_body->>'reasonCode' IS NULL OR p_body->>'reasonCode' NOT IN('IDENTITY_UNVERIFIED','DUPLICATE','NOT_APPLICABLE') THEN
        RAISE EXCEPTION 'Invalid reason' USING ERRCODE='22023'; END IF;
      UPDATE portal.deletion_requests SET state='REJECTED',decision_code=p_body->>'reasonCode',version=version+1 WHERE id=p_id;
      event_name:='DELETION_REJECTED';
    END IF;
    result:=jsonb_build_object('id',p_id,'version',d.version+1); object_kind:='PRIVACY_REQUEST';
  ELSIF p_kind IN('hold','release') THEN
    group_ids:=portal_private.privacy_group(p_id);
    IF cardinality(group_ids)=0 THEN RAISE EXCEPTION 'Candidate missing' USING ERRCODE='P0002'; END IF;
    SELECT coalesce(merged_into_id,id) INTO root FROM portal.candidates WHERE id=p_id;
    IF EXISTS(SELECT 1 FROM portal_private.privacy_erasure_jobs j JOIN portal.applications a ON a.id=j.application_id WHERE a.candidate_id=ANY(group_ids))
      OR EXISTS(SELECT 1 FROM portal.deletion_requests WHERE candidate_id=ANY(group_ids) AND state='PROCESSING') THEN
      RAISE EXCEPTION 'Erasure already started' USING ERRCODE='55000'; END IF;
    SELECT * INTO h FROM portal.candidate_legal_holds WHERE candidate_id=root FOR UPDATE;
    IF p_expected IS NULL OR p_expected<>coalesce(h.version,0) THEN RAISE EXCEPTION 'Hold conflict' USING ERRCODE='40001'; END IF;
    IF p_kind='hold' THEN
      IF p_body-ARRAY['caseRef','reasonCode','until']<>'{}'::jsonb OR NOT(p_body ?& ARRAY['caseRef','reasonCode','until'])
        OR p_body->>'reasonCode' IS NULL OR p_body->>'reasonCode' NOT IN('LEGAL_OBLIGATION','LEGAL_CLAIM') OR (p_body->>'caseRef')::uuid IS NULL THEN
        RAISE EXCEPTION 'Invalid hold' USING ERRCODE='22023'; END IF;
      until_at:=(p_body->>'until')::timestamptz;
      IF until_at IS NULL OR until_at<=statement_timestamp() OR until_at>statement_timestamp()+interval '1 year' THEN
        RAISE EXCEPTION 'Invalid hold expiry' USING ERRCODE='22023'; END IF;
      INSERT INTO portal.candidate_legal_holds(candidate_id,case_ref,reason_code,hold_until,created_by)
        VALUES(root,(p_body->>'caseRef')::uuid,p_body->>'reasonCode',until_at,actor)
        ON CONFLICT(candidate_id) DO UPDATE SET case_ref=excluded.case_ref,reason_code=excluded.reason_code,
          hold_until=excluded.hold_until,released_at=NULL,version=portal.candidate_legal_holds.version+1,updated_at=statement_timestamp();
      UPDATE portal.deletion_requests SET state='ON_HOLD',version=version+1 WHERE candidate_id=ANY(group_ids) AND state='VERIFIED';
      event_name:='PRIVACY_HOLD_SET';
    ELSE
      IF h.candidate_id IS NULL OR p_body<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid release' USING ERRCODE='22023'; END IF;
      UPDATE portal.candidate_legal_holds SET released_at=statement_timestamp(),version=version+1,updated_at=statement_timestamp() WHERE candidate_id=root;
      UPDATE portal.deletion_requests SET state='VERIFIED',version=version+1 WHERE candidate_id=ANY(group_ids) AND state='ON_HOLD'
        AND NOT portal_private.privacy_group_held(root);
      event_name:='PRIVACY_HOLD_RELEASED';
    END IF;
    result:=jsonb_build_object('id',root,'version',coalesce(h.version,0)+1); object_kind:='PRIVACY_HOLD';
  ELSE
    IF p_id<>'00000000-0000-4000-8000-000000000001'::uuid
      OR p_body-ARRAY['retentionMonths','evidenceMonths','retentionEnabled']<>'{}'::jsonb
      OR NOT(p_body ?& ARRAY['retentionMonths','evidenceMonths','retentionEnabled'])
      OR jsonb_typeof(p_body->'retentionEnabled')<>'boolean'
      OR jsonb_typeof(p_body->'retentionMonths')<>'number' OR jsonb_typeof(p_body->'evidenceMonths')<>'number'
      OR (p_body->>'retentionMonths')!~'^[0-9]{1,2}$' OR (p_body->>'evidenceMonths')!~'^[0-9]{1,2}$' THEN
      RAISE EXCEPTION 'Invalid policy' USING ERRCODE='22023'; END IF;
    SELECT * INTO policy FROM portal.privacy_policy WHERE id=1 FOR UPDATE;
    IF p_expected IS NULL OR p_expected<>policy.version THEN RAISE EXCEPTION 'Policy conflict' USING ERRCODE='40001'; END IF;
    UPDATE portal.privacy_policy SET retention_months=(p_body->>'retentionMonths')::integer,evidence_months=(p_body->>'evidenceMonths')::integer,
      retention_enabled=(p_body->>'retentionEnabled')::boolean,version=version+1,updated_at=statement_timestamp() WHERE id=1;
    INSERT INTO portal_private.privacy_policy_history(version,retention_months) VALUES(policy.version+1,(p_body->>'retentionMonths')::integer);
    result:=jsonb_build_object('id',p_id,'version',policy.version+1); event_name:='PRIVACY_POLICY_CHANGED'; object_kind:='PRIVACY_POLICY';
  END IF;
  INSERT INTO portal.audit_logs(actor_id,object_type,object_id,action,safe_changes,request_id)
    VALUES(actor,object_kind,(result->>'id')::uuid,event_name,result,p_request);
  INSERT INTO portal_private.privacy_commands(request_id,actor_id,target_id,digest,result)
    VALUES(p_request,actor,(result->>'id')::uuid,fingerprint,result);
  RETURN result;
END $$;

-- Purge linked pseudonymous command/audit/outbox records together with the data.
-- Completion evidence refers only to the opaque deletion request, never contacts.
CREATE FUNCTION portal_private.scrub_privacy_references(p_ids uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ids text[]:=p_ids::text[];
BEGIN
  DELETE FROM portal.audit_logs WHERE object_id=ANY(p_ids)
    OR safe_changes->>'candidateId'=ANY(ids) OR safe_changes->>'sourceId'=ANY(ids)
    OR safe_changes->>'applicationId'=ANY(ids) OR safe_changes->>'uploadId'=ANY(ids) OR safe_changes->>'id'=ANY(ids);
  DELETE FROM portal.outbox_events WHERE aggregate_id=ANY(p_ids)
    OR safe_references->>'candidateId'=ANY(ids) OR safe_references->>'sourceId'=ANY(ids)
    OR safe_references->>'applicationId'=ANY(ids) OR safe_references->>'uploadId'=ANY(ids) OR safe_references->>'id'=ANY(ids);
  DELETE FROM portal_private.recruitment_commands WHERE command->>'id'=ANY(ids) OR command->>'sourceId'=ANY(ids);
  DELETE FROM portal_private.privacy_commands WHERE target_id=ANY(p_ids);
END $$;

CREATE FUNCTION portal_private.request_privacy_from_receipt(p_upload uuid,p_cap bytea,p_request uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate uuid; ids uuid[];
BEGIN
  IF p_upload IS NULL OR p_cap IS NULL OR octet_length(p_cap)<>32 OR p_request IS NULL THEN
    RAISE EXCEPTION 'Invalid request' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(72705,1);
  IF EXISTS(SELECT 1 FROM portal.deletion_requests WHERE id=p_request) THEN RETURN; END IF;
  SELECT a.candidate_id INTO candidate FROM portal.applications a JOIN portal.uploads u ON u.id=a.cv_upload_id
    WHERE u.id=p_upload AND u.capability_hash=p_cap AND u.access_revoked_at IS NULL
      AND a.receipt_hash=p_cap AND a.receipt_expires_at>statement_timestamp() AND a.intake_state='CONFIRMED'
      AND portal_private.application_data_available(a.id,a.submitted_at,a.retention_expires_at);
  IF candidate IS NULL THEN RETURN; END IF;
  ids:=portal_private.privacy_group(candidate);
  IF EXISTS(SELECT 1 FROM portal.deletion_requests WHERE candidate_id=ANY(ids) AND state NOT IN('COMPLETED','REJECTED')) THEN RETURN; END IF;
  INSERT INTO portal.deletion_requests(id,candidate_id,verified_requester_ref,reason_code,due_at)
    VALUES(p_request,candidate,p_request,'ERASURE',statement_timestamp()+interval '1 month');
  INSERT INTO portal.audit_logs(object_type,object_id,action,safe_changes,request_id)
    VALUES('PRIVACY_REQUEST',p_request,'DELETION_REQUESTED',jsonb_build_object('id',p_request,'version',1),p_request);
END $$;

CREATE FUNCTION portal_private.complete_privacy_groups(p_limit integer DEFAULT 20) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c record; d record; ids uuid[]; completed integer:=0; policy portal.privacy_policy%ROWTYPE;
BEGIN
  SELECT * INTO policy FROM portal.privacy_policy WHERE id=1;
  FOR c IN SELECT id FROM portal.candidates root WHERE merged_into_id IS NULL
    AND NOT EXISTS(SELECT 1 FROM portal.applications WHERE candidate_id=ANY(portal_private.privacy_group(root.id)))
    AND NOT portal_private.privacy_group_held(root.id)
    AND (EXISTS(SELECT 1 FROM portal.deletion_requests WHERE candidate_id=ANY(portal_private.privacy_group(root.id)) AND state IN('VERIFIED','PROCESSING'))
      OR (policy.retention_enabled AND NOT EXISTS(SELECT 1 FROM portal.candidates member WHERE member.id=ANY(portal_private.privacy_group(root.id))
        AND portal_private.privacy_retention_deadline(member.created_at,member.created_at+interval '24 months')>statement_timestamp())))
    ORDER BY id LIMIT p_limit
  LOOP
    ids:=portal_private.privacy_group(c.id);
    FOR d IN UPDATE portal.deletion_requests SET state='COMPLETED',completed_at=statement_timestamp(),candidate_id=NULL,
      cleanup_progress='{"database":"removed","storage":"removed"}',version=version+1
      WHERE candidate_id=ANY(ids) AND state IN('VERIFIED','PROCESSING') RETURNING id,version
    LOOP
      INSERT INTO portal.audit_logs(object_type,object_id,action,safe_changes,request_id)
        VALUES('PRIVACY_REQUEST',d.id,'DELETION_COMPLETED',jsonb_build_object('id',d.id,'version',d.version),gen_random_uuid());
      completed:=completed+1;
    END LOOP;
    PERFORM portal_private.scrub_privacy_references(ids);
    DELETE FROM portal.candidates WHERE id=ANY(ids) AND merged_into_id IS NOT NULL;
    DELETE FROM portal.candidates WHERE id=c.id;
  END LOOP;
  RETURN completed;
END $$;

CREATE FUNCTION portal_private.prepare_privacy_cleanup(p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE work record; policy portal.privacy_policy%ROWTYPE; queued integer:=0; completed integer; request_driven boolean;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid batch' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(72705,1);
  SELECT * INTO policy FROM portal.privacy_policy WHERE id=1;
  UPDATE portal.deletion_requests SET state='VERIFIED',version=version+1 WHERE state='ON_HOLD' AND verified_at IS NOT NULL
    AND NOT portal_private.privacy_group_held(candidate_id);
  FOR work IN SELECT a.id,a.candidate_id,a.cv_upload_id,u.provider_upload_expires_at,u.created_at,u.access_revoked_at
    FROM portal.applications a JOIN portal.uploads u ON u.id=a.cv_upload_id
    WHERE NOT EXISTS(SELECT 1 FROM portal_private.privacy_erasure_jobs WHERE application_id=a.id)
      AND NOT portal_private.privacy_group_held(a.candidate_id)
      AND ((policy.retention_enabled AND portal_private.privacy_retention_deadline(a.submitted_at,a.retention_expires_at)<=statement_timestamp())
        OR EXISTS(SELECT 1 FROM portal.deletion_requests WHERE candidate_id=ANY(portal_private.privacy_group(a.candidate_id)) AND state IN('VERIFIED','PROCESSING')))
    ORDER BY a.retention_expires_at,a.id LIMIT p_limit FOR UPDATE OF a,u
  LOOP
    request_driven:=EXISTS(SELECT 1 FROM portal.deletion_requests WHERE candidate_id=ANY(portal_private.privacy_group(work.candidate_id)) AND state IN('VERIFIED','PROCESSING'));
    UPDATE portal.uploads SET access_revoked_at=coalesce(access_revoked_at,statement_timestamp()) WHERE id=work.cv_upload_id;
    INSERT INTO portal_private.privacy_erasure_jobs(application_id,upload_id,reason,available_at)
      VALUES(work.id,work.cv_upload_id,CASE WHEN request_driven THEN 'REQUEST' ELSE 'RETENTION' END,
        greatest(coalesce(work.provider_upload_expires_at,work.created_at+interval '2 hours')+interval '5 minutes',
          coalesce(work.access_revoked_at,statement_timestamp())+interval '1 minute'));
    UPDATE portal.deletion_requests SET state='PROCESSING',version=version+1
      WHERE candidate_id=ANY(portal_private.privacy_group(work.candidate_id)) AND state='VERIFIED';
    -- Cancel pending notifications before leaving the transaction for Storage.
    DELETE FROM portal.outbox_events WHERE aggregate_id IN(work.id,work.cv_upload_id);
    queued:=queued+1;
  END LOOP;
  completed:=portal_private.complete_privacy_groups(p_limit);
  RETURN jsonb_build_object('queued',queued,'completed',completed);
END $$;

CREATE FUNCTION portal_private.claim_privacy_cleanup(p_limit integer DEFAULT 5) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE work record; token uuid; result jsonb:='[]';
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Invalid batch' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(72705,1);
  FOR work IN SELECT j.application_id,j.upload_id,u.storage_provider,u.bucket,u.object_key FROM portal_private.privacy_erasure_jobs j
    JOIN portal.uploads u ON u.id=j.upload_id
    WHERE available_at<=statement_timestamp() AND (lease_until IS NULL OR lease_until<=statement_timestamp())
      AND u.access_revoked_at IS NOT NULL AND u.access_revoked_at<=statement_timestamp()-interval '1 minute'
      AND coalesce(u.provider_upload_expires_at,u.created_at+interval '2 hours')<=statement_timestamp()-interval '5 minutes'
    ORDER BY available_at,j.application_id LIMIT p_limit FOR UPDATE OF j SKIP LOCKED
  LOOP
    token:=gen_random_uuid();
    UPDATE portal_private.privacy_erasure_jobs SET lease_token=token,lease_until=statement_timestamp()+interval '2 minutes',attempts=attempts+1
      WHERE application_id=work.application_id;
    result:=result||jsonb_build_object('applicationId',work.application_id,'uploadId',work.upload_id,'provider',work.storage_provider,
      'bucket',work.bucket,'objectKey',work.object_key,'leaseToken',token);
  END LOOP;
  RETURN result;
END $$;

CREATE FUNCTION portal_private.finish_privacy_cleanup(p_application uuid,p_token uuid,p_removed boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE work portal_private.privacy_erasure_jobs%ROWTYPE; receipt uuid:=gen_random_uuid();
BEGIN
  IF p_application IS NULL OR p_token IS NULL OR p_removed IS NULL THEN RAISE EXCEPTION 'Invalid result' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(72705,1);
  SELECT * INTO work FROM portal_private.privacy_erasure_jobs WHERE application_id=p_application AND lease_token=p_token
    AND lease_until>statement_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT p_removed THEN
    UPDATE portal_private.privacy_erasure_jobs SET lease_token=NULL,lease_until=NULL,
      available_at=statement_timestamp()+make_interval(secs=>least(3600,30*power(2,least(attempts-1,7)))::double precision)
      WHERE application_id=p_application;
    RETURN false;
  END IF;
  PERFORM portal_private.scrub_privacy_references(ARRAY[p_application,work.upload_id]);
  DELETE FROM portal.applications WHERE id=p_application;
  DELETE FROM portal.uploads WHERE id=work.upload_id;
  INSERT INTO portal.audit_logs(object_type,object_id,action,safe_changes,request_id)
    VALUES('PRIVACY_ERASURE',receipt,'PERSONAL_DATA_ERASED',jsonb_build_object('id',receipt),gen_random_uuid());
  -- Completion is deliberately separate: every application in every alias must
  -- be gone before the request can be acknowledged as completed.
  RETURN true;
END $$;

CREATE FUNCTION portal_private.privacy_cleanup_summary() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE completed integer; months integer;
BEGIN
  PERFORM pg_advisory_xact_lock(72705,1);
  completed:=portal_private.complete_privacy_groups(20);
  SELECT evidence_months INTO months FROM portal.privacy_policy WHERE id=1;
  DELETE FROM portal_private.privacy_commands WHERE request_id IN(SELECT request_id FROM portal_private.privacy_commands
    WHERE created_at<statement_timestamp()-make_interval(months=>months) ORDER BY created_at LIMIT 100);
  DELETE FROM portal.audit_logs WHERE id IN(SELECT id FROM portal.audit_logs WHERE object_type IN('PRIVACY_REQUEST','PRIVACY_HOLD','PRIVACY_POLICY','PRIVACY_ERASURE')
    AND created_at<statement_timestamp()-make_interval(months=>months) ORDER BY created_at LIMIT 100);
  DELETE FROM portal.deletion_requests WHERE id IN(SELECT id FROM portal.deletion_requests WHERE state IN('COMPLETED','REJECTED')
    AND coalesce(completed_at,updated_at)<statement_timestamp()-make_interval(months=>months) ORDER BY updated_at LIMIT 100);
  RETURN jsonb_build_object('completed',completed,
    'pending',(SELECT count(*) FROM portal_private.privacy_erasure_jobs),
    'overdue',(SELECT count(*) FROM portal.deletion_requests WHERE state NOT IN('COMPLETED','REJECTED') AND due_at<=statement_timestamp()));
END $$;

-- Preserve every prior audit code while adding a finite privacy vocabulary.
ALTER FUNCTION portal_private.audit_codes_are_safe(text,text) RENAME TO audit_codes_before_privacy;
CREATE FUNCTION portal_private.audit_codes_are_safe(kind text,event text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT portal_private.audit_codes_before_privacy(kind,event)
    OR (kind IN('PRIVACY_REQUEST','PRIVACY_HOLD','PRIVACY_POLICY','PRIVACY_ERASURE')
      AND event IN('DELETION_REQUESTED','DELETION_VERIFIED','DELETION_REJECTED','DELETION_COMPLETED',
        'PRIVACY_HOLD_SET','PRIVACY_HOLD_RELEASED','PRIVACY_POLICY_CHANGED','PERSONAL_DATA_ERASED'))
$$;
-- CHECK constraints bind function OIDs; rebind them to the extended predicate.
ALTER TABLE portal.audit_logs DROP CONSTRAINT audit_logs_codes;
ALTER TABLE portal.audit_logs ADD CONSTRAINT audit_logs_codes CHECK(portal_private.audit_codes_are_safe(object_type,action)) NOT VALID;
CREATE OR REPLACE FUNCTION portal_private.guard_audit_record() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF portal_private.audit_payload_is_safe(NEW.safe_changes) IS NOT TRUE
     OR portal_private.audit_codes_are_safe(NEW.object_type,NEW.action) IS NOT TRUE THEN
    RAISE EXCEPTION 'Unsafe audit record' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

-- CV issuance must enforce expiry even inside the recruitment definer role.
-- Bound issuance still calls this function immediately before returning a URL.
GRANT portal_recruitment_owner TO CURRENT_USER;
DO $migration$
DECLARE definition text; position integer;
BEGIN
  definition:=pg_get_functiondef('portal_private.record_cv_access(uuid,uuid)'::regprocedure);
  position:=strpos(definition,'BEGIN');
  IF position=0 THEN RAISE EXCEPTION 'Unexpected CV access definition'; END IF;
  definition:=overlay(definition placing $guard$BEGIN
    IF NOT EXISTS(SELECT 1 FROM portal.applications a WHERE a.id=application_id
      AND portal_private.application_data_available(a.id,a.submitted_at,a.retention_expires_at)) THEN
      RAISE EXCEPTION 'CV access denied' USING ERRCODE='42501'; END IF;
$guard$ from position for length('BEGIN'));
  EXECUTE definition;
END $migration$;
DO $migration$
DECLARE definition text; position integer; target text; upload_parameter text;
BEGIN
  FOREACH target IN ARRAY ARRAY['portal_private.application_upload(uuid,bytea)','portal_private.replay_application(uuid,bytea,uuid,uuid,bytea)'] LOOP
    definition:=pg_get_functiondef(target::regprocedure);
    position:=strpos(definition,'BEGIN');
    IF position=0 THEN RAISE EXCEPTION 'Unexpected replay definition'; END IF;
    upload_parameter:=CASE WHEN target LIKE '%application_upload(%' THEN 'p_id' ELSE 'p_upload' END;
    definition:=overlay(definition placing format($guard$BEGIN
      IF EXISTS(SELECT 1 FROM portal.applications a WHERE a.cv_upload_id=%s
        AND NOT portal_private.application_data_available(a.id,a.submitted_at,a.retention_expires_at)) THEN
        RAISE EXCEPTION 'Application unavailable' USING ERRCODE='22023'; END IF;
$guard$,upload_parameter) from position for length('BEGIN'));
    EXECUTE definition;
  END LOOP;
END $migration$;

DO $$ DECLARE f regprocedure; BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='portal_private'
    AND p.proname IN('privacy_group','privacy_group_held','privacy_retention_deadline','application_data_available','candidate_data_available','guard_application_retention',
      'manage_privacy','scrub_privacy_references','request_privacy_from_receipt','complete_privacy_groups','prepare_privacy_cleanup','claim_privacy_cleanup','finish_privacy_cleanup','privacy_cleanup_summary') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO portal_privacy_owner',f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
    EXECUTE format('ALTER FUNCTION %s SET timezone TO ''UTC''',f);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION portal_private.manage_privacy(text,uuid,integer,uuid,jsonb),
  portal_private.request_privacy_from_receipt(uuid,bytea,uuid),
  portal_private.application_data_available(uuid,timestamptz,timestamptz),portal_private.candidate_data_available(uuid) TO portal_runtime;
GRANT EXECUTE ON FUNCTION portal_private.application_data_available(uuid,timestamptz,timestamptz) TO portal_recruitment_owner;
DO $$ DECLARE owner_name text; BEGIN
  SELECT pg_get_userbyid(proowner) INTO owner_name FROM pg_proc WHERE oid='portal_private.record_cv_access(uuid,uuid)'::regprocedure;
  -- Preserve the legacy definer owner, which can differ from recruitment_owner.
  -- Grant after transferring predicate ownership so this explicit ACL survives.
  EXECUTE format('GRANT EXECUTE ON FUNCTION portal_private.application_data_available(uuid,timestamptz,timestamptz) TO %I',owner_name);
END $$;
GRANT EXECUTE ON FUNCTION portal_private.prepare_privacy_cleanup(integer),portal_private.claim_privacy_cleanup(integer),
  portal_private.finish_privacy_cleanup(uuid,uuid,boolean),portal_private.privacy_cleanup_summary() TO portal_privacy_worker;
REVOKE CREATE ON SCHEMA portal_private FROM portal_privacy_owner;
REVOKE portal_privacy_owner,portal_recruitment_owner FROM CURRENT_USER;
COMMIT;
