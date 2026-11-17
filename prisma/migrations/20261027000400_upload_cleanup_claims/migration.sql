BEGIN;

DO $$ BEGIN EXECUTE format('GRANT portal_recruitment_owner TO %I',current_user); END $$;
GRANT CREATE ON SCHEMA portal_private TO portal_recruitment_owner;

CREATE TABLE portal_private.upload_cleanup_claims (
  upload_id uuid PRIMARY KEY REFERENCES portal.uploads(id) ON DELETE CASCADE,
  lease_token uuid,
  lease_until timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 1 CHECK(attempts BETWEEN 1 AND 16),
  CHECK((lease_token IS NULL)=(lease_until IS NULL))
);
ALTER TABLE portal_private.upload_cleanup_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal_private.upload_cleanup_claims FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON portal_private.upload_cleanup_claims TO portal_recruitment_owner;
CREATE POLICY upload_cleanup_owner ON portal_private.upload_cleanup_claims
  TO portal_recruitment_owner USING(true) WITH CHECK(true);

CREATE FUNCTION portal_private.claim_application_upload_cleanup() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE work record; token uuid; moment timestamptz:=statement_timestamp(); result jsonb:='[]';
BEGIN
  FOR work IN
    SELECT u.id,u.object_key,u.provider_upload_expires_at FROM portal.uploads u
      LEFT JOIN portal_private.upload_cleanup_claims c ON c.upload_id=u.id
    WHERE u.intake_job_id IS NOT NULL AND u.scan_state='PENDING'
      AND u.storage_provider='SUPABASE' AND u.bucket='cv-quarantine'
      AND u.provider_upload_expires_at<moment-interval '5 minutes'
      AND NOT EXISTS(SELECT 1 FROM portal.applications a WHERE a.cv_upload_id=u.id)
      AND (c.upload_id IS NULL OR(c.available_at<=moment AND(c.lease_until IS NULL OR c.lease_until<=moment)))
    ORDER BY u.provider_upload_expires_at,u.id LIMIT 20 FOR UPDATE OF u SKIP LOCKED
  LOOP
    token:=gen_random_uuid();
    INSERT INTO portal_private.upload_cleanup_claims AS c(upload_id,lease_token,lease_until,available_at)
      VALUES(work.id,token,moment+interval '2 minutes',moment)
      ON CONFLICT(upload_id) DO UPDATE SET lease_token=token,lease_until=moment+interval '2 minutes',
        attempts=least(c.attempts+1,16);
    result:=result||jsonb_build_array(jsonb_build_object('id',work.id,'objectKey',work.object_key,
      'providerExpiresAt',work.provider_upload_expires_at,'leaseToken',token));
  END LOOP;
  RETURN result;
END $$;

CREATE FUNCTION portal_private.finish_application_upload_cleanup(p_results jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE work record; claim portal_private.upload_cleanup_claims%ROWTYPE;
  moment timestamptz:=statement_timestamp(); affected integer; removed integer:=0; failed integer:=0; skipped integer:=0;
BEGIN
  IF p_results IS NULL OR jsonb_typeof(p_results)<>'array' OR jsonb_array_length(p_results)>20
    OR EXISTS(SELECT 1 FROM jsonb_to_recordset(p_results) r(id uuid,"leaseToken" uuid,status text)
      WHERE id IS NULL OR "leaseToken" IS NULL OR status IS NULL OR status NOT IN('removed','failed')) THEN
    RAISE EXCEPTION 'Invalid cleanup result' USING ERRCODE='22023';
  END IF;
  FOR work IN SELECT * FROM jsonb_to_recordset(p_results) r(id uuid,"leaseToken" uuid,status text) ORDER BY id LOOP
    -- Match the claimer's upload-before-claim lock order. Stale workers must
    -- never finalize a later worker's lease, even if their Storage call succeeded.
    PERFORM id FROM portal.uploads WHERE id=work.id FOR UPDATE;
    SELECT * INTO claim FROM portal_private.upload_cleanup_claims
      WHERE upload_id=work.id AND lease_token=work."leaseToken" AND lease_until>moment FOR UPDATE;
    IF NOT FOUND THEN skipped:=skipped+1; CONTINUE; END IF;
    IF work.status='removed' THEN
      DELETE FROM portal.uploads u WHERE u.id=work.id AND u.intake_job_id IS NOT NULL AND u.scan_state='PENDING'
        AND u.storage_provider='SUPABASE' AND u.bucket='cv-quarantine'
        AND u.provider_upload_expires_at<moment-interval '5 minutes'
        AND NOT EXISTS(SELECT 1 FROM portal.applications a WHERE a.cv_upload_id=u.id);
      GET DIAGNOSTICS affected=ROW_COUNT;
      IF affected=1 THEN removed:=removed+1; CONTINUE; END IF;
      skipped:=skipped+1;
    ELSE
      failed:=failed+1;
    END IF;
    UPDATE portal_private.upload_cleanup_claims SET lease_token=NULL,lease_until=NULL,
      available_at=moment+make_interval(secs=>least(3600,30*power(2,least(claim.attempts-1,7)))::double precision)
      WHERE upload_id=work.id;
  END LOOP;
  RETURN jsonb_build_object('removed',removed,'failed',failed,'skipped',skipped);
END $$;

ALTER FUNCTION portal_private.claim_application_upload_cleanup() OWNER TO portal_recruitment_owner;
ALTER FUNCTION portal_private.finish_application_upload_cleanup(jsonb) OWNER TO portal_recruitment_owner;
REVOKE ALL ON FUNCTION portal_private.claim_application_upload_cleanup(),portal_private.finish_application_upload_cleanup(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_private.claim_application_upload_cleanup(),portal_private.finish_application_upload_cleanup(jsonb) TO portal_runtime;
REVOKE CREATE ON SCHEMA portal_private FROM portal_recruitment_owner;
DO $$ BEGIN EXECUTE format('REVOKE portal_recruitment_owner FROM %I',current_user); END $$;

COMMIT;
