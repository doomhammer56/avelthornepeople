BEGIN;
ALTER TABLE portal.staff_profiles ADD COLUMN version integer NOT NULL DEFAULT 1
  CHECK(version>0);
CREATE FUNCTION portal_private.guard_staff_profile_version() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  NEW.version:=OLD.version+CASE WHEN (NEW.display_name,NEW.role,NEW.active)
    IS DISTINCT FROM (OLD.display_name,OLD.role,OLD.active) THEN 1 ELSE 0 END;
  RETURN NEW;
END $$;
CREATE TRIGGER staff_profile_version BEFORE UPDATE ON portal.staff_profiles
  FOR EACH ROW EXECUTE FUNCTION portal_private.guard_staff_profile_version();

CREATE TABLE portal_private.team_commands(
  request_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES portal.staff_profiles(id) ON DELETE RESTRICT,
  command jsonb NOT NULL CHECK(jsonb_typeof(command)='object'),
  result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE portal_private.team_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal_private.team_commands FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','portal_runtime','portal_public_reader'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON portal_private.team_commands FROM %I',r);
    END IF;
  END LOOP;
END $$;

-- Reuse the established admin-only lifecycle helper and its ownership boundary.
-- No runtime connection can skip the version/replay checks through the old helper.
CREATE FUNCTION portal_private.manage_team_change(target_id uuid,expected integer,target_role text,target_active boolean,request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); saved portal_private.team_commands; profile portal.staff_profiles;
  body jsonb; result jsonb; operation_id uuid; current_version integer;
BEGIN
  PERFORM portal_private.require_staff_admin();
  IF target_id IS NULL OR request_id IS NULL OR expected IS NULL OR expected<1
    OR target_role IS NULL OR target_role NOT IN('ADMIN','HR','READ_ONLY') OR target_active IS NULL THEN
    RAISE EXCEPTION 'Invalid team command' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('team:'||request_id::text,0));
  PERFORM pg_advisory_xact_lock(710201);
  PERFORM portal_private.require_staff_admin();
  body:=jsonb_build_object('userId',target_id,'expectedVersion',expected,'role',target_role,'active',target_active);
  SELECT * INTO saved FROM portal_private.team_commands c WHERE c.request_id=manage_team_change.request_id;
  IF FOUND THEN
    IF saved.actor_id<>actor OR saved.command<>body THEN RAISE EXCEPTION 'Request conflict' USING ERRCODE='40001'; END IF;
    RETURN saved.result;
  END IF;
  SELECT * INTO profile FROM portal.staff_profiles WHERE id=target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Staff profile missing' USING ERRCODE='P0002'; END IF;
  IF profile.version<>expected THEN RAISE EXCEPTION 'Stale staff profile' USING ERRCODE='40001'; END IF;
  IF EXISTS(SELECT 1 FROM portal_private.staff_provider_operations WHERE profile_id=target_id AND completed_at IS NULL) THEN
    RAISE EXCEPTION 'Provider reconciliation pending' USING ERRCODE='55000';
  END IF;
  IF profile.role IS DISTINCT FROM target_role OR profile.active IS DISTINCT FROM target_active THEN
    operation_id:=portal_private.change_staff(target_id,target_role,target_active,request_id);
    SELECT version INTO current_version FROM portal.staff_profiles WHERE id=target_id;
    INSERT INTO portal.outbox_events(event_type,aggregate_id,delivery_key,safe_references)
      VALUES('STAFF_CHANGED',target_id,'staff-change:'||request_id::text,jsonb_build_object('id',target_id,'version',current_version));
  ELSE current_version:=profile.version;
  END IF;
  result:=jsonb_build_object('userId',target_id,'version',current_version,'operationId',operation_id);
  INSERT INTO portal_private.team_commands(request_id,actor_id,command,result)
    VALUES(request_id,actor,body,result);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION portal_private.manage_team_change(uuid,integer,text,boolean,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION portal_private.change_staff(uuid,text,boolean,uuid) FROM portal_runtime;
GRANT EXECUTE ON FUNCTION portal_private.manage_team_change(uuid,integer,text,boolean,uuid) TO portal_runtime;

CREATE FUNCTION portal_private.pending_team_operations(profile_ids uuid[])
RETURNS TABLE(profile_id uuid,operation_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM portal_private.require_staff_admin();
  IF profile_ids IS NULL OR cardinality(profile_ids)>50 THEN RAISE EXCEPTION 'Invalid profile page' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT DISTINCT ON(o.profile_id) o.profile_id,o.id FROM portal_private.staff_provider_operations o
    WHERE o.profile_id=ANY(profile_ids) AND o.completed_at IS NULL ORDER BY o.profile_id,o.created_at,o.id;
END $$;
REVOKE ALL ON FUNCTION portal_private.pending_team_operations(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_private.pending_team_operations(uuid[]) TO portal_runtime;
COMMIT;
