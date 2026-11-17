BEGIN;

-- Allow exactly one new audit code. Every earlier code is preserved by wrapping
-- the current predicate, the same way the staff-delete migration extended it.
ALTER FUNCTION portal_private.audit_codes_are_safe(text,text) RENAME TO audit_codes_before_staff_rename;
CREATE FUNCTION portal_private.audit_codes_are_safe(kind text,event text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT portal_private.audit_codes_before_staff_rename(kind,event)
    OR (kind='STAFF_PROFILE' AND event='STAFF_RENAMED')
$$;
-- CHECK constraints bind function OIDs; rebind to the extended predicate.
ALTER TABLE portal.audit_logs DROP CONSTRAINT audit_logs_codes;
ALTER TABLE portal.audit_logs ADD CONSTRAINT audit_logs_codes
  CHECK(portal_private.audit_codes_are_safe(object_type,action)) NOT VALID;

-- Lets any signed-in staff member change their OWN display name.
--
-- The target is always auth.uid(): there is no id parameter, so this can never
-- rename someone else. Role and active status are not touched here; those stay
-- behind change_staff (Admin only). The caller must hold an admitted, live
-- session on an active profile, the same boundary every other command uses.
-- The version trigger on staff_profiles bumps the version, so an Admin who has
-- the Accounts screen open sees a stale-version conflict instead of silently
-- overwriting the rename. An unchanged name writes nothing and is not audited.
CREATE FUNCTION portal_private.rename_own_profile(new_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); cleaned text:=btrim(new_name); profile portal.staff_profiles;
BEGIN
  IF actor IS NULL
     OR portal_private.current_staff_role() IS NULL
     OR NOT portal_private.staff_session_is_admitted(
       (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid) THEN
    RAISE EXCEPTION 'Staff access denied' USING ERRCODE='42501';
  END IF;
  IF cleaned IS NULL OR length(cleaned) NOT BETWEEN 1 AND 100 OR cleaned ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Invalid name' USING ERRCODE='22023';
  END IF;
  SELECT * INTO profile FROM portal.staff_profiles WHERE id=actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Staff access denied' USING ERRCODE='42501'; END IF;
  IF profile.display_name IS DISTINCT FROM cleaned THEN
    UPDATE portal.staff_profiles SET display_name=cleaned,updated_at=now() WHERE id=actor
      RETURNING * INTO profile;
    INSERT INTO portal.audit_logs(actor_id,object_type,object_id,action,safe_changes,request_id)
      VALUES(actor,'STAFF_PROFILE',actor,'STAFF_RENAMED','{}',gen_random_uuid());
  END IF;
  RETURN jsonb_build_object('displayName',profile.display_name,'version',profile.version);
END $$;
REVOKE ALL ON FUNCTION portal_private.rename_own_profile(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_private.rename_own_profile(text) TO portal_runtime;
COMMIT;
