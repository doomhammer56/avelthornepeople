BEGIN;

-- Use the existing admitted-Admin definer boundary. The runtime receives no
-- Auth table grants, and managed Auth tables/policies are not changed.
CREATE FUNCTION portal_private.read_staff_accounts(p_page integer)
RETURNS TABLE(
  id uuid,display_name text,role text,active boolean,version integer,
  provider_id uuid,email text,last_sign_in_at timestamptz,pending_operation_id uuid
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM portal_private.require_staff_admin();
  IF p_page IS NULL OR p_page<1 OR p_page>10000 THEN
    RAISE EXCEPTION 'Invalid staff page' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
    WITH page AS MATERIALIZED (
      SELECT p.id,p.display_name,p.role,p.active,p.version,p.created_at
      FROM portal.staff_profiles p ORDER BY p.created_at,p.id
      LIMIT 51 OFFSET ((p_page-1)*50)
    )
    SELECT p.id,p.display_name,p.role,p.active,p.version,
      u.id,u.email::text,u.last_sign_in_at,pending.id
    FROM page p LEFT JOIN auth.users u ON u.id=p.id
    LEFT JOIN LATERAL (
      SELECT o.id FROM portal_private.staff_provider_operations o
      WHERE o.profile_id=p.id AND o.completed_at IS NULL
      ORDER BY o.created_at,o.id LIMIT 1
    ) pending ON true
    ORDER BY p.created_at,p.id;
END $$;

REVOKE ALL ON FUNCTION portal_private.read_staff_accounts(integer) FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','portal_public_reader','portal_metrics_writer','portal_jobs_worker'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION portal_private.read_staff_accounts(integer) FROM %I',r);
    END IF;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION portal_private.read_staff_accounts(integer) TO portal_runtime;

COMMIT;
