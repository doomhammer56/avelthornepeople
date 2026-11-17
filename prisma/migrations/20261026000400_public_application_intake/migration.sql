BEGIN;

-- Unscanned is an explicit temporary policy, never a successful scan result.
ALTER TABLE portal.uploads DROP CONSTRAINT uploads_scan_state_check,
  ADD CONSTRAINT uploads_scan_state_check CHECK(scan_state IN('PENDING','UNSCANNED','CLEAN','INFECTED','ERROR')),
  ADD COLUMN intake_job_id uuid REFERENCES portal.jobs(id) ON DELETE RESTRICT,
  ADD COLUMN intake_request_id uuid,
  ADD CONSTRAINT uploads_intake_binding_check CHECK((intake_job_id IS NULL)=(intake_request_id IS NULL)),
  ADD CONSTRAINT uploads_unscanned_check CHECK(scan_state<>'UNSCANNED' OR (
    bucket='cv-quarantine' AND storage_provider='SUPABASE' AND scanned_at IS NULL
    AND size_bytes IS NOT NULL AND size_bytes=declared_size_bytes AND sha256 IS NOT NULL
    AND detected_type IS NOT NULL AND detected_type IN('application/pdf','application/msword')));
ALTER TABLE portal.applications DROP CONSTRAINT applications_cv_scan_state_check,
  DROP CONSTRAINT applications_confirmation_check,
  ADD CONSTRAINT applications_cv_scan_state_check CHECK(cv_scan_state IN('CLEAN','UNSCANNED')),
  ADD CONSTRAINT applications_confirmation_check CHECK(intake_state<>'CONFIRMED' OR (
    candidate_id IS NOT NULL AND cv_scan_state IS NOT NULL AND cv_scan_state IN('CLEAN','UNSCANNED')));

DO $$ BEGIN EXECUTE format('GRANT portal_recruitment_owner TO %I',current_user); END $$;
GRANT CREATE ON SCHEMA portal_private TO portal_recruitment_owner;
DO $$ BEGIN EXECUTE format('GRANT portal_public_view_owner TO %I',current_user); END $$;
SET LOCAL ROLE portal_public_view_owner;
GRANT SELECT ON portal.visible_jobs TO portal_recruitment_owner;
RESET ROLE;
GRANT SELECT ON portal.uploads TO portal_recruitment_owner;
GRANT INSERT ON portal.candidates,portal.applications,portal.uploads TO portal_recruitment_owner;
GRANT UPDATE(scan_state,size_bytes,sha256,detected_type) ON portal.uploads TO portal_recruitment_owner;
CREATE POLICY intake_upload_owner ON portal.uploads TO portal_recruitment_owner USING(true) WITH CHECK(true);

CREATE TABLE portal_private.intake_traffic (
  key uuid PRIMARY KEY,minute_start timestamptz NOT NULL,day_start timestamptz NOT NULL,
  minute_count integer NOT NULL,day_count integer NOT NULL
);
ALTER TABLE portal_private.intake_traffic ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON portal_private.intake_traffic TO portal_recruitment_owner;
CREATE POLICY intake_traffic_owner ON portal_private.intake_traffic TO portal_recruitment_owner USING(true) WITH CHECK(true);

CREATE FUNCTION portal_private.consume_intake_traffic(p_key uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE k uuid; t portal_private.intake_traffic%ROWTYPE; moment timestamptz:=statement_timestamp();
  minute_limit integer; day_limit integer;
BEGIN
  IF p_key IS NULL OR p_key='00000000-0000-0000-0000-000000000000'::uuid THEN RAISE EXCEPTION 'Invalid request' USING ERRCODE='22023'; END IF;
  FOREACH k IN ARRAY ARRAY['00000000-0000-0000-0000-000000000000'::uuid,p_key] LOOP
    minute_limit:=CASE WHEN k=p_key THEN 12 ELSE 120 END;
    day_limit:=CASE WHEN k=p_key THEN 100 ELSE 2000 END;
    INSERT INTO portal_private.intake_traffic AS r VALUES(k,moment,moment,1,1)
      ON CONFLICT(key) DO UPDATE SET
      minute_count=CASE WHEN r.minute_start<=moment-interval '1 minute' THEN 1 ELSE least(r.minute_count+1,121) END,
      minute_start=CASE WHEN r.minute_start<=moment-interval '1 minute' THEN moment ELSE r.minute_start END,
      day_count=CASE WHEN r.day_start<=moment-interval '1 day' THEN 1 ELSE least(r.day_count+1,2001) END,
      day_start=CASE WHEN r.day_start<=moment-interval '1 day' THEN moment ELSE r.day_start END
      RETURNING * INTO t;
    IF t.day_count>day_limit THEN RETURN greatest(1,ceil(extract(epoch FROM t.day_start+interval '1 day'-moment))::integer); END IF;
    IF t.minute_count>minute_limit THEN RETURN greatest(1,ceil(extract(epoch FROM t.minute_start+interval '1 minute'-moment))::integer); END IF;
  END LOOP;
  DELETE FROM portal_private.intake_traffic WHERE day_start<moment-interval '2 days';
  RETURN 0;
END $$;

CREATE FUNCTION portal_private.reserve_application_upload(p_job uuid,p_request uuid,p_id uuid,p_key text,p_size bigint,p_cap bytea)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_job IS NULL OR p_request IS NULL OR p_id IS NULL OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 10000000
    OR p_cap IS NULL OR octet_length(p_cap)<>32 OR p_key IS NULL
    OR p_key !~ ('^'||p_id::text||'/[0-9a-f-]{36}\.(pdf|doc)$') THEN RAISE EXCEPTION 'Invalid upload' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM portal.visible_jobs WHERE id=p_job) THEN RAISE EXCEPTION 'Job closed' USING ERRCODE='P0002'; END IF;
  INSERT INTO portal.uploads(id,storage_provider,bucket,object_key,declared_size_bytes,capability_hash,capability_expires_at,provider_upload_expires_at,intake_job_id,intake_request_id)
    VALUES(p_id,'SUPABASE','cv-quarantine',p_key,p_size,p_cap,statement_timestamp()+interval '15 minutes',statement_timestamp()+interval '2 hours 5 minutes',p_job,p_request);
END $$;

CREATE FUNCTION portal_private.application_upload(p_id uuid,p_cap bytea) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE u portal.uploads%ROWTYPE;
BEGIN
  SELECT * INTO u FROM portal.uploads WHERE id=p_id AND capability_hash=p_cap AND access_revoked_at IS NULL
    AND (capability_expires_at>statement_timestamp() OR EXISTS(SELECT 1 FROM portal.applications WHERE cv_upload_id=p_id AND intake_state='CONFIRMED'));
  IF NOT FOUND THEN RAISE EXCEPTION 'Upload unavailable' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('id',u.id,'jobId',u.intake_job_id,'requestId',u.intake_request_id,'objectKey',u.object_key,'size',u.declared_size_bytes);
END $$;

CREATE FUNCTION portal_private.expired_application_uploads() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce(jsonb_agg(t),'[]') FROM (
    SELECT u.id,u.object_key AS "objectKey",u.provider_upload_expires_at AS "providerExpiresAt"
    FROM portal.uploads u WHERE u.intake_job_id IS NOT NULL AND u.scan_state='PENDING'
      AND u.provider_upload_expires_at<statement_timestamp()-interval '5 minutes'
      AND NOT EXISTS(SELECT 1 FROM portal.applications a WHERE a.cv_upload_id=u.id)
    ORDER BY u.provider_upload_expires_at,u.id LIMIT 20
  ) t
$$;
CREATE FUNCTION portal_private.remove_expired_application_upload(p_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  DELETE FROM portal.uploads u WHERE u.id=p_id AND u.intake_job_id IS NOT NULL AND u.scan_state='PENDING'
    AND u.provider_upload_expires_at<statement_timestamp()-interval '5 minutes'
    AND NOT EXISTS(SELECT 1 FROM portal.applications a WHERE a.cv_upload_id=u.id)
$$;
GRANT DELETE ON portal.uploads TO portal_recruitment_owner;

-- The web service validates bytes and encrypts PII before this atomic boundary.
-- Candidate identity changes use the same lock as BE-05 merges/deletion requests.
CREATE FUNCTION portal_private.accept_application(p_job uuid,p_request uuid,p_upload uuid,p_cap bytea,p_type text,p_size bigint,p_sha bytea,
  p_id uuid,p_profile bytea,p_cover bytea,p_locale text,p_digest bytea,p_candidate uuid,p_name bytea,p_email bytea,p_phone bytea,p_keys jsonb,p_version integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u portal.uploads%ROWTYPE; previous portal.applications%ROWTYPE; matched uuid; matching_count integer; both_match boolean;
BEGIN
  IF p_job IS NULL OR p_request IS NULL OR p_upload IS NULL OR p_id IS NULL OR p_candidate IS NULL OR p_version IS NULL OR p_version<1
    OR p_cap IS NULL OR octet_length(p_cap)<>32 OR p_sha IS NULL OR octet_length(p_sha)<>32 OR p_digest IS NULL OR octet_length(p_digest)<>32
    OR p_profile IS NULL OR octet_length(p_profile)<1 OR p_name IS NULL OR p_email IS NULL OR p_phone IS NULL
    OR p_type IS NULL OR p_type NOT IN('application/pdf','application/msword') OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 10000000
    OR p_locale IS NULL OR p_locale NOT IN('en','zh') OR p_keys IS NULL OR jsonb_typeof(p_keys)<>'array'
    OR jsonb_array_length(p_keys) NOT BETWEEN 2 AND 10 THEN RAISE EXCEPTION 'Invalid application' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(72705,1);
  SELECT * INTO u FROM portal.uploads WHERE id=p_upload AND capability_hash=p_cap AND intake_job_id=p_job AND intake_request_id=p_request AND access_revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid upload' USING ERRCODE='22023'; END IF;
  SELECT * INTO previous FROM portal.applications WHERE job_id=p_job AND idempotency_key=p_request;
  IF FOUND THEN
    IF previous.payload_digest<>p_digest THEN RAISE EXCEPTION 'Request conflict' USING ERRCODE='40001'; END IF;
    RETURN 'duplicate';
  END IF;
  IF u.capability_expires_at<=statement_timestamp() OR u.scan_state<>'PENDING' OR u.declared_size_bytes<>p_size
    OR right(u.object_key,4)<>(CASE WHEN p_type='application/pdf' THEN '.pdf' ELSE '.doc' END) THEN RAISE EXCEPTION 'Invalid upload' USING ERRCODE='22023'; END IF;
  -- Lock the base row so closure and acceptance have a defined transaction order.
  PERFORM id FROM portal.jobs WHERE id=p_job FOR SHARE;
  IF NOT EXISTS(SELECT 1 FROM portal.visible_jobs WHERE id=p_job) THEN RAISE EXCEPTION 'Job closed' USING ERRCODE='P0002'; END IF;
  WITH matches AS (
    SELECT coalesce(c.merged_into_id,c.id) id,bool_or(k.field='email') email,bool_or(k.field='phone') phone
    FROM jsonb_to_recordset(p_keys) k(version integer,field text,hash text) JOIN portal.candidates c
      ON c.hmac_key_version=k.version AND ((k.field='email' AND c.email_hmac=decode(k.hash,'hex')) OR(k.field='phone' AND c.phone_hmac=decode(k.hash,'hex')))
    GROUP BY coalesce(c.merged_into_id,c.id)
  ) SELECT count(*),(array_agg(id))[1],bool_and(email AND phone) INTO matching_count,matched,both_match FROM matches;
  IF EXISTS(SELECT 1 FROM portal.candidates c JOIN jsonb_to_recordset(p_keys) k(version integer,field text,hash text)
    ON c.hmac_key_version=k.version AND ((k.field='email' AND c.email_hmac=decode(k.hash,'hex')) OR(k.field='phone' AND c.phone_hmac=decode(k.hash,'hex')))
    WHERE portal_private.candidate_group_blocked(c.id)) THEN RAISE EXCEPTION 'Candidate unavailable' USING ERRCODE='55000'; END IF;
  IF matching_count<>1 OR both_match IS NOT TRUE THEN
    matched:=p_candidate;
    INSERT INTO portal.candidates(id,name_encrypted,email_encrypted,phone_encrypted,email_hmac,phone_hmac,hmac_key_version)
      VALUES(matched,p_name,p_email,p_phone,
        (SELECT decode(k.hash,'hex') FROM jsonb_to_recordset(p_keys) k(version integer,field text,hash text) WHERE k.version=p_version AND k.field='email'),
        (SELECT decode(k.hash,'hex') FROM jsonb_to_recordset(p_keys) k(version integer,field text,hash text) WHERE k.version=p_version AND k.field='phone'),p_version);
  END IF;
  UPDATE portal.uploads SET scan_state='UNSCANNED',size_bytes=p_size,sha256=p_sha,detected_type=p_type WHERE id=p_upload;
  INSERT INTO portal.applications(id,job_id,candidate_id,cv_upload_id,cv_scan_state,intake_state,profile_encrypted,cover_letter_encrypted,
    consent_at,policy_version,source,submission_channel,locale,duplicate_candidate_match,idempotency_key,payload_digest,receipt_hash,receipt_expires_at,confirmed_at)
    VALUES(p_id,p_job,matched,p_upload,'UNSCANNED','CONFIRMED',p_profile,p_cover,statement_timestamp(),'recruitment-24-months-v1','CAREERS','PUBLIC_SITE',
      p_locale,matching_count>0 AND (matching_count<>1 OR both_match IS NOT TRUE),p_request,p_digest,p_cap,statement_timestamp()+interval '1 day',statement_timestamp());
  INSERT INTO portal.audit_logs(object_type,object_id,action,safe_changes,request_id)
    VALUES('APPLICATION',p_id,'CONFIRMED',jsonb_build_object('uploadId',p_upload),p_request);
  INSERT INTO portal.outbox_events(event_type,aggregate_id,delivery_key,safe_references)
    VALUES('APPLICATION_CONFIRMED',p_id,'application:'||p_id,jsonb_build_object('id',p_id));
  RETURN 'accepted';
END $$;

GRANT SELECT,UPDATE(id) ON portal.jobs TO portal_recruitment_owner;
CREATE POLICY intake_job_lock ON portal.jobs FOR SELECT TO portal_recruitment_owner USING(true);
CREATE POLICY intake_job_share ON portal.jobs FOR UPDATE TO portal_recruitment_owner USING(true) WITH CHECK(true);
DO $$ DECLARE f regprocedure; BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='portal_private'
    AND p.proname IN('consume_intake_traffic','reserve_application_upload','application_upload','accept_application','expired_application_uploads','remove_expired_application_upload') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
    EXECUTE format('ALTER FUNCTION %s OWNER TO portal_recruitment_owner',f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO portal_runtime',f);
  END LOOP;
END $$;
REVOKE CREATE ON SCHEMA portal_private FROM portal_recruitment_owner;
DO $$ BEGIN EXECUTE format('REVOKE portal_recruitment_owner FROM %I',current_user); END $$;

DROP POLICY recruiting_clean_uploads ON portal.uploads;
CREATE POLICY recruiting_clean_uploads ON portal.uploads FOR SELECT TO portal_runtime USING(
  scan_state IN('CLEAN','UNSCANNED') AND access_revoked_at IS NULL
  AND (SELECT portal_private.current_staff_role()) IN('ADMIN','HR')
  AND EXISTS(SELECT 1 FROM portal.applications a WHERE a.cv_upload_id=uploads.id AND a.intake_state='CONFIRMED'));
CREATE OR REPLACE FUNCTION portal_private.record_cv_access(application_id uuid,request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target_upload uuid;
BEGIN
  IF portal_private.current_staff_role() IS NULL OR portal_private.current_staff_role() NOT IN('ADMIN','HR') THEN RAISE EXCEPTION 'CV access denied' USING ERRCODE='42501'; END IF;
  SELECT u.id INTO target_upload FROM portal.applications a JOIN portal.uploads u ON u.id=a.cv_upload_id
    WHERE a.id=application_id AND a.intake_state='CONFIRMED' AND u.access_revoked_at IS NULL AND u.storage_provider='SUPABASE'
    AND ((u.scan_state='CLEAN' AND u.bucket='cv-clean') OR(u.scan_state='UNSCANNED' AND u.bucket='cv-quarantine'))
    AND NOT portal_private.candidate_group_blocked(a.candidate_id);
  IF target_upload IS NULL THEN RAISE EXCEPTION 'CV access denied' USING ERRCODE='42501'; END IF;
  INSERT INTO portal.audit_logs(actor_id,object_type,object_id,action,safe_changes,request_id)
    VALUES(auth.uid(),'APPLICATION',application_id,'CV_URL_ISSUED',jsonb_build_object('uploadId',target_upload),request_id);
END $$;
COMMIT;
