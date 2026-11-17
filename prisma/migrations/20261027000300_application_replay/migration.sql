BEGIN;

DO $$ BEGIN EXECUTE format('GRANT portal_recruitment_owner TO %I',current_user); END $$;
GRANT CREATE ON SCHEMA portal_private TO portal_recruitment_owner;

CREATE OR REPLACE FUNCTION portal_private.application_upload(p_id uuid,p_cap bytea) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE u portal.uploads%ROWTYPE; accepted_sha text;
BEGIN
  SELECT * INTO u FROM portal.uploads WHERE id=p_id AND capability_hash=p_cap AND access_revoked_at IS NULL
    AND (capability_expires_at>statement_timestamp() OR EXISTS(
      SELECT 1 FROM portal.applications WHERE cv_upload_id=p_id AND intake_state='CONFIRMED'));
  IF NOT FOUND THEN RAISE EXCEPTION 'Upload unavailable' USING ERRCODE='22023'; END IF;
  -- Only the hash of a committed, bound submission can skip file validation.
  IF EXISTS(SELECT 1 FROM portal.applications a WHERE a.cv_upload_id=u.id
    AND a.job_id=u.intake_job_id AND a.idempotency_key=u.intake_request_id AND a.intake_state='CONFIRMED') THEN
    accepted_sha:=encode(u.sha256,'hex');
  END IF;
  RETURN jsonb_build_object('id',u.id,'jobId',u.intake_job_id,'requestId',u.intake_request_id,
    'objectKey',u.object_key,'size',u.declared_size_bytes,'acceptedSha256',accepted_sha);
END $$;

-- Acknowledge an existing submission without writes, candidate-key access,
-- storage availability, or the global candidate-identity lock. Recheck the
-- capability and every binding here; the earlier descriptor is not authority.
CREATE FUNCTION portal_private.replay_application(p_upload uuid,p_cap bytea,p_job uuid,p_request uuid,p_digest bytea)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE previous_digest bytea;
BEGIN
  IF p_upload IS NULL OR p_job IS NULL OR p_request IS NULL OR p_cap IS NULL OR octet_length(p_cap)<>32
    OR p_digest IS NULL OR octet_length(p_digest)<>32 THEN
    RAISE EXCEPTION 'Invalid replay' USING ERRCODE='22023';
  END IF;
  SELECT a.payload_digest INTO previous_digest FROM portal.applications a
    JOIN portal.uploads u ON u.id=a.cv_upload_id
    WHERE u.id=p_upload AND u.capability_hash=p_cap AND u.access_revoked_at IS NULL
      AND u.intake_job_id=p_job AND u.intake_request_id=p_request
      AND a.job_id=p_job AND a.idempotency_key=p_request AND a.intake_state='CONFIRMED';
  IF NOT FOUND THEN RAISE EXCEPTION 'Replay unavailable' USING ERRCODE='22023'; END IF;
  IF previous_digest<>p_digest THEN RAISE EXCEPTION 'Request conflict' USING ERRCODE='40001'; END IF;
END $$;

ALTER FUNCTION portal_private.application_upload(uuid,bytea) OWNER TO portal_recruitment_owner;
ALTER FUNCTION portal_private.replay_application(uuid,bytea,uuid,uuid,bytea) OWNER TO portal_recruitment_owner;
REVOKE ALL ON FUNCTION portal_private.application_upload(uuid,bytea),portal_private.replay_application(uuid,bytea,uuid,uuid,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_private.application_upload(uuid,bytea),portal_private.replay_application(uuid,bytea,uuid,uuid,bytea) TO portal_runtime;
REVOKE CREATE ON SCHEMA portal_private FROM portal_recruitment_owner;
DO $$ BEGIN EXECUTE format('REVOKE portal_recruitment_owner FROM %I',current_user); END $$;

COMMIT;
