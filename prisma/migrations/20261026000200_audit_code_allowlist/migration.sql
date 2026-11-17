BEGIN;
-- Uppercase shape alone is insufficient: a legacy code may itself contain a name.
-- Keep the code vocabulary synchronized with the safe response projection.
CREATE FUNCTION portal_private.audit_codes_are_safe(kind text,event text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT kind IN('JOB','APPLICATION','CANDIDATE','CONTENT','CONTENT_IMAGE','STAFF_PROFILE','AUTH_ACCOUNT','DEPARTMENT','LOCATION','CONTACT_MESSAGE')
    AND event IN(
      'JOB_CREATE','JOB_SAVE','JOB_DUPLICATE','JOB_SUBMIT','JOB_PUBLISH','JOB_PAUSE','JOB_RESUME','JOB_CLOSE','DEV_FIXTURE_SEEDED',
      'APPLICATION_STAGE_CHANGED','CANDIDATES_MERGED','CV_URL_ISSUED','UPDATED','CONFIRMED',
      'CONTENT_CREATE','CONTENT_SAVE','CONTENT_PUBLISH','CONTENT_UNPUBLISH','CONTENT_IMAGE_UPLOADED','CONTENT_TEMPLATE_CREATED','CONTENT_SEEDED',
      'STAFF_LINKED','STAFF_CHANGED','STAFF_BOOTSTRAPPED','STAFF_PROVIDER_SYNCED','PASSWORD_CHANGED','PASSWORD_CHANGE_UNCERTAIN',
      'DEPARTMENT_CREATED','DEPARTMENT_UPDATED','DEPARTMENT_DELETED','LOCATION_CREATED','LOCATION_UPDATED','LOCATION_DELETED',
      'CONTACT_MESSAGE_CREATED','CONTACT_MESSAGE_UPDATED','CONTACT_MESSAGE_DELETED')
$$;
ALTER TABLE portal.audit_logs DROP CONSTRAINT audit_logs_codes;
ALTER TABLE portal.audit_logs ADD CONSTRAINT audit_logs_codes
  CHECK(portal_private.audit_codes_are_safe(object_type,action)) NOT VALID;

-- CHECK errors normally include the failing row in DETAIL. Reject unsafe input
-- first with a constant error so payloads cannot be echoed into diagnostics.
CREATE FUNCTION portal_private.guard_audit_record() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF portal_private.audit_payload_is_safe(NEW.safe_changes) IS NOT TRUE
     OR portal_private.audit_codes_are_safe(NEW.object_type,NEW.action) IS NOT TRUE THEN
    RAISE EXCEPTION 'Unsafe audit record' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER audit_record_guard BEFORE INSERT OR UPDATE ON portal.audit_logs
  FOR EACH ROW EXECUTE FUNCTION portal_private.guard_audit_record();
COMMIT;
