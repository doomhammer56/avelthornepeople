BEGIN;

ALTER TABLE portal.uploads
    ADD COLUMN provider_upload_expires_at timestamptz(6),
    ADD COLUMN access_revoked_at timestamptz(6);

DROP POLICY recruiting_clean_uploads ON portal.uploads;
CREATE POLICY recruiting_clean_uploads ON portal.uploads FOR SELECT TO portal_runtime
USING (
    scan_state = 'CLEAN' AND access_revoked_at IS NULL
    AND (SELECT portal_private.current_staff_role()) IN ('ADMIN', 'HR')
    AND EXISTS (SELECT 1 FROM portal.applications AS a WHERE a.cv_upload_id = uploads.id)
);

-- The shared runtime cannot insert arbitrary audit events. This narrow operation
-- rechecks live authorization after signing and inserts only opaque references.
CREATE FUNCTION portal_private.record_cv_access(application_id uuid, request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target_upload uuid;
BEGIN
    IF portal_private.current_staff_role() IS NULL
       OR portal_private.current_staff_role() NOT IN ('ADMIN', 'HR') THEN
        RAISE EXCEPTION 'CV access denied' USING ERRCODE = '42501';
    END IF;
    SELECT u.id INTO target_upload
    FROM portal.applications a
    JOIN portal.uploads u ON u.id = a.cv_upload_id
    JOIN portal.candidates c ON c.id = a.candidate_id
    WHERE a.id = application_id AND a.intake_state = 'CONFIRMED'
      AND u.scan_state = 'CLEAN' AND u.access_revoked_at IS NULL
      AND u.storage_provider = 'SUPABASE' AND u.bucket = 'cv-clean'
      AND c.deletion_requested_at IS NULL;
    IF target_upload IS NULL THEN
        RAISE EXCEPTION 'CV access denied' USING ERRCODE = '42501';
    END IF;
    INSERT INTO portal.audit_logs (actor_id, object_type, object_id, action, safe_changes, request_id)
    VALUES (auth.uid(), 'APPLICATION', application_id, 'CV_URL_ISSUED',
        jsonb_build_object('uploadId', target_upload), request_id);
END;
$$;
REVOKE ALL ON FUNCTION portal_private.record_cv_access(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_private.record_cv_access(uuid, uuid) TO portal_runtime;

COMMIT;
