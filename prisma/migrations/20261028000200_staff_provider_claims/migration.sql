BEGIN;
ALTER TABLE portal_private.staff_provider_operations
  ADD COLUMN claim_id uuid,
  ADD COLUMN claimed_at timestamptz,
  ADD COLUMN claimed_profile_version integer,
  ADD CONSTRAINT staff_provider_claim_shape CHECK (
    (claim_id IS NULL AND claimed_at IS NULL AND claimed_profile_version IS NULL)
    OR (claim_id IS NOT NULL AND claimed_at IS NOT NULL AND claimed_profile_version IS NOT NULL AND claimed_profile_version>0)
  );

-- Claims do not expire automatically. The Auth provider cannot fence requests:
-- a timeout may still apply remotely. Reclaiming an uncertain request would
-- allow its late ban to overtake a newer activation. Pending operations already
-- prevent later profile transitions through change_staff/manage_team_change.
CREATE FUNCTION portal_private.claim_staff_provider_operation(p_id uuid,p_claim uuid)
RETURNS TABLE(profile_id uuid,operation text,state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op portal_private.staff_provider_operations; profile portal.staff_profiles;
BEGIN
  PERFORM portal_private.require_staff_admin();
  IF p_id IS NULL OR p_claim IS NULL THEN RAISE EXCEPTION 'Invalid claim' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(710201);
  PERFORM portal_private.require_staff_admin();
  SELECT * INTO op FROM portal_private.staff_provider_operations WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR op.completed_at IS NOT NULL THEN RETURN QUERY SELECT NULL::uuid,NULL::text,'complete'::text; RETURN; END IF;
  IF op.claim_id IS NOT NULL THEN RETURN QUERY SELECT NULL::uuid,NULL::text,'pending'::text; RETURN; END IF;
  SELECT * INTO profile FROM portal.staff_profiles WHERE id=op.profile_id FOR SHARE;
  IF profile.id IS NULL OR (op.operation='ban') IS DISTINCT FROM (NOT profile.active) THEN
    RAISE EXCEPTION 'Stale provider operation' USING ERRCODE='40001';
  END IF;
  IF EXISTS(SELECT 1 FROM portal_private.staff_provider_operations o WHERE o.profile_id=op.profile_id
    AND o.completed_at IS NULL AND (o.created_at,o.id)<(op.created_at,op.id)) THEN
    RETURN QUERY SELECT NULL::uuid,NULL::text,'pending'::text; RETURN;
  END IF;
  UPDATE portal_private.staff_provider_operations SET claim_id=p_claim,claimed_at=statement_timestamp(),claimed_profile_version=profile.version WHERE id=p_id;
  RETURN QUERY SELECT op.profile_id,op.operation,'claimed'::text;
END $$;

CREATE FUNCTION portal_private.finish_staff_provider_claim(p_id uuid,p_claim uuid,p_success boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op portal_private.staff_provider_operations; profile portal.staff_profiles;
BEGIN
  PERFORM portal_private.require_staff_admin();
  IF p_id IS NULL OR p_claim IS NULL OR p_success IS NULL THEN RAISE EXCEPTION 'Invalid claim' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(710201);
  PERFORM portal_private.require_staff_admin();
  SELECT * INTO op FROM portal_private.staff_provider_operations WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR op.claim_id IS DISTINCT FROM p_claim THEN RAISE EXCEPTION 'Stale provider claim' USING ERRCODE='40001'; END IF;
  IF op.completed_at IS NOT NULL THEN
    IF p_success THEN RETURN; END IF;
    RAISE EXCEPTION 'Operation already complete' USING ERRCODE='40001';
  END IF;
  SELECT * INTO profile FROM portal.staff_profiles WHERE id=op.profile_id FOR SHARE;
  IF profile.id IS NULL OR profile.version IS DISTINCT FROM op.claimed_profile_version
    OR (op.operation='ban') IS DISTINCT FROM (NOT profile.active) THEN
    RAISE EXCEPTION 'Stale provider operation' USING ERRCODE='40001';
  END IF;
  IF p_success THEN
    UPDATE portal_private.staff_provider_operations SET completed_at=statement_timestamp() WHERE id=p_id;
  ELSE
    -- Only a definitive provider rejection may release a claim for retry.
    -- Network errors/timeouts/5xx and abandoned workers must retain the claim.
    UPDATE portal_private.staff_provider_operations SET claim_id=NULL,claimed_at=NULL,claimed_profile_version=NULL WHERE id=p_id;
  END IF;
END $$;

-- Reuse the established administrative definer's access to the RLS-protected
-- operation ledger. Do not depend on whichever role happens to run deployment.
DO $$ DECLARE admin_owner name; BEGIN
  SELECT r.rolname INTO STRICT admin_owner FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
    WHERE p.oid='portal_private.require_staff_admin()'::regprocedure;
  EXECUTE format('ALTER FUNCTION portal_private.claim_staff_provider_operation(uuid,uuid) OWNER TO %I',admin_owner);
  EXECUTE format('ALTER FUNCTION portal_private.finish_staff_provider_claim(uuid,uuid,boolean) OWNER TO %I',admin_owner);
END $$;

REVOKE ALL ON FUNCTION portal_private.claim_staff_provider_operation(uuid,uuid),portal_private.finish_staff_provider_claim(uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_private.claim_staff_provider_operation(uuid,uuid),portal_private.finish_staff_provider_claim(uuid,uuid,boolean) TO portal_runtime;
REVOKE EXECUTE ON FUNCTION portal_private.complete_staff_provider_operation(uuid) FROM portal_runtime;
REVOKE ALL ON FUNCTION portal_private.complete_staff_provider_operation(uuid) FROM PUBLIC;
COMMIT;
