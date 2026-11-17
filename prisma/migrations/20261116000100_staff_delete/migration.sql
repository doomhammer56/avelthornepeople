BEGIN;

-- Allow exactly one new audit code. Every earlier code is preserved by wrapping
-- the current predicate, the same way the privacy migration extended it.
ALTER FUNCTION portal_private.audit_codes_are_safe(text,text) RENAME TO audit_codes_before_staff_delete;
CREATE FUNCTION portal_private.audit_codes_are_safe(kind text,event text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT portal_private.audit_codes_before_staff_delete(kind,event)
    OR (kind='STAFF_PROFILE' AND event='STAFF_DELETED')
$$;
-- CHECK constraints bind function OIDs; rebind to the extended predicate.
ALTER TABLE portal.audit_logs DROP CONSTRAINT audit_logs_codes;
ALTER TABLE portal.audit_logs ADD CONSTRAINT audit_logs_codes
  CHECK(portal_private.audit_codes_are_safe(object_type,action)) NOT VALID;

-- Permanently removes a deactivated staff profile.
--
-- Safety rules, all enforced here rather than in the UI:
--  * Admin only, on a live admitted session (same boundary as change_staff).
--  * Never your own account, and never an active member: deactivate first.
--  * Versioned and idempotent per request, like every other team command.
--  * No pending provider synchronization.
--  * A member who has audit history, owns jobs/content, or otherwise appears in
--    a restricted reference cannot be removed. Those foreign keys are RESTRICT on
--    purpose so the audit trail never loses its actor; the resulting 23503 is
--    reported to the caller instead of being worked around.
-- Only bookkeeping that exists purely about this member (session cutoff, finished
-- provider operations, the invitation that created them) is cleaned up.
CREATE FUNCTION portal_private.delete_staff(target_id uuid,expected integer,request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); saved portal_private.team_commands; profile portal.staff_profiles;
  body jsonb; result jsonb;
BEGIN
  PERFORM portal_private.require_staff_admin();
  IF target_id IS NULL OR request_id IS NULL OR expected IS NULL OR expected<1 THEN
    RAISE EXCEPTION 'Invalid team command' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('team:'||request_id::text,0));
  PERFORM pg_advisory_xact_lock(710201);
  PERFORM portal_private.require_staff_admin();
  body:=jsonb_build_object('action','delete','userId',target_id,'expectedVersion',expected);
  SELECT * INTO saved FROM portal_private.team_commands c WHERE c.request_id=delete_staff.request_id;
  IF FOUND THEN
    IF saved.actor_id<>actor OR saved.command<>body THEN RAISE EXCEPTION 'Request conflict' USING ERRCODE='40001'; END IF;
    RETURN saved.result;
  END IF;
  IF target_id=actor THEN
    RAISE EXCEPTION 'Cannot delete own account' USING ERRCODE='42501';
  END IF;
  SELECT * INTO profile FROM portal.staff_profiles WHERE id=target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Staff profile missing' USING ERRCODE='P0002'; END IF;
  IF profile.version<>expected THEN RAISE EXCEPTION 'Stale staff profile' USING ERRCODE='40001'; END IF;
  IF profile.active THEN RAISE EXCEPTION 'Active member' USING ERRCODE='55000'; END IF;
  IF EXISTS(SELECT 1 FROM portal_private.staff_provider_operations WHERE profile_id=target_id AND completed_at IS NULL) THEN
    RAISE EXCEPTION 'Provider reconciliation pending' USING ERRCODE='55000';
  END IF;

  DELETE FROM portal_private.staff_session_cutoffs WHERE profile_id=target_id;
  DELETE FROM portal_private.staff_provider_operations WHERE profile_id=target_id AND completed_at IS NOT NULL;
  DELETE FROM portal_private.staff_invitation_requests WHERE profile_id=target_id;

  -- Written before the delete so a restricted reference rolls both back together.
  INSERT INTO portal.audit_logs(actor_id,object_type,object_id,action,safe_changes,request_id)
    VALUES(actor,'STAFF_PROFILE',target_id,'STAFF_DELETED',
      jsonb_build_object('role',profile.role,'active',false),request_id);
  DELETE FROM portal.staff_profiles WHERE id=target_id;

  result:=jsonb_build_object('userId',target_id,'deleted',true);
  INSERT INTO portal_private.team_commands(request_id,actor_id,command,result)
    VALUES(request_id,actor,body,result);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION portal_private.delete_staff(uuid,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_private.delete_staff(uuid,integer,uuid) TO portal_runtime;
COMMIT;
