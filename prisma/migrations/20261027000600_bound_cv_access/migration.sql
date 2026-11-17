BEGIN;

DO $$ BEGIN EXECUTE format('GRANT portal_recruitment_owner TO %I',current_user); END $$;
GRANT CREATE ON SCHEMA portal_private TO portal_recruitment_owner;
GRANT EXECUTE ON FUNCTION portal_private.record_cv_access(uuid,uuid) TO portal_recruitment_owner;

-- Signing happens outside a DB transaction. Before releasing the URL, bind the
-- access audit to exactly the descriptor that was signed, and lock that upload
-- through commit so metadata/revocation cannot change between check and audit.
CREATE FUNCTION portal_private.record_bound_cv_access(
  p_application uuid,p_request uuid,p_upload uuid,p_key text,p_sha bytea,p_type text,p_size bigint
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF portal_private.staff_session_is_admitted(
    (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid) IS NOT TRUE THEN
    RAISE EXCEPTION 'Session not admitted' USING ERRCODE='42501';
  END IF;
  PERFORM u.id FROM portal.applications a JOIN portal.uploads u ON u.id=a.cv_upload_id
    WHERE a.id=p_application AND u.id=p_upload AND u.object_key=p_key AND u.sha256=p_sha
      AND u.detected_type=p_type AND u.size_bytes=p_size
    FOR SHARE OF u;
  IF NOT FOUND THEN RAISE EXCEPTION 'CV changed' USING ERRCODE='42501'; END IF;
  -- Existing fresh role, intake, scan, revocation, deletion and audit checks.
  PERFORM portal_private.record_cv_access(p_application,p_request);
END $$;

ALTER FUNCTION portal_private.record_bound_cv_access(uuid,uuid,uuid,text,bytea,text,bigint) OWNER TO portal_recruitment_owner;
REVOKE ALL ON FUNCTION portal_private.record_bound_cv_access(uuid,uuid,uuid,text,bytea,text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_private.record_bound_cv_access(uuid,uuid,uuid,text,bytea,text,bigint) TO portal_runtime;
REVOKE CREATE ON SCHEMA portal_private FROM portal_recruitment_owner;
DO $$ BEGIN EXECUTE format('REVOKE portal_recruitment_owner FROM %I',current_user); END $$;

COMMIT;
