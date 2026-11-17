BEGIN;
GRANT portal_jobs_owner TO CURRENT_USER;
-- PostgreSQL requires the new function owner to have CREATE on its schema.
GRANT CREATE ON SCHEMA portal_private TO portal_jobs_owner;

-- One row per import attempt. The audit log forbids free text, so the file name
-- and batch counts live here. Jobs written by an import carry the batch id as
-- their audit request_id, which links this row to the individual JOB_* events.
CREATE TABLE portal.job_imports (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES portal.staff_profiles(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  file_name text NOT NULL CHECK(length(file_name) BETWEEN 1 AND 255 AND file_name !~ '[[:cntrl:]]'),
  status text NOT NULL CHECK(status IN('COMPLETED','FAILED')),
  duplicate_mode text NOT NULL CHECK(duplicate_mode IN('NONE','SKIP','OVERWRITE','MIXED')),
  total_rows integer NOT NULL CHECK(total_rows BETWEEN 0 AND 1000),
  created_count integer NOT NULL DEFAULT 0 CHECK(created_count BETWEEN 0 AND 1000),
  overwritten_count integer NOT NULL DEFAULT 0 CHECK(overwritten_count BETWEEN 0 AND 1000),
  skipped_count integer NOT NULL DEFAULT 0 CHECK(skipped_count BETWEEN 0 AND 1000),
  failed_count integer NOT NULL DEFAULT 0 CHECK(failed_count BETWEEN 0 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_imports_recent_idx ON portal.job_imports(created_at DESC,id DESC);
CREATE INDEX job_imports_actor_idx ON portal.job_imports(actor_id);

ALTER TABLE portal.job_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.job_imports FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON portal.job_imports TO portal_runtime;
GRANT SELECT,INSERT ON portal.job_imports TO portal_jobs_owner;
CREATE POLICY job_imports_staff_read ON portal.job_imports FOR SELECT TO portal_runtime
  USING((SELECT portal_private.current_staff_role()) IN('ADMIN','HR'));
CREATE POLICY job_imports_command_owner ON portal.job_imports TO portal_jobs_owner USING(true) WITH CHECK(true);

-- The only write path. Re-checks session admission and role like manage_job, so a
-- direct call cannot record an import for someone who may not write jobs.
CREATE FUNCTION portal_private.record_job_import(p_id uuid,p_file_name text,p_status text,p_mode text,
  p_total integer,p_created integer,p_overwritten integer,p_skipped integer,p_failed integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid := nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; v_role text;
BEGIN
  IF p_id IS NULL OR p_file_name IS NULL OR p_status IS NULL OR p_mode IS NULL OR p_total IS NULL
    OR p_created IS NULL OR p_overwritten IS NULL OR p_skipped IS NULL OR p_failed IS NULL THEN
    RAISE EXCEPTION 'Invalid import record' USING ERRCODE='22023';
  END IF;
  IF portal_private.staff_session_is_admitted((nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid) IS NOT TRUE THEN
    RAISE EXCEPTION 'Session not admitted' USING ERRCODE='42501';
  END IF;
  SELECT role INTO v_role FROM portal.staff_profiles WHERE id=v_actor AND active FOR SHARE;
  IF v_role IS NULL OR v_role NOT IN ('HR','ADMIN') THEN
    RAISE EXCEPTION 'Staff access denied' USING ERRCODE='42501';
  END IF;
  INSERT INTO portal.job_imports(id,actor_id,file_name,status,duplicate_mode,total_rows,created_count,overwritten_count,skipped_count,failed_count)
    VALUES(p_id,v_actor,p_file_name,p_status,p_mode,p_total,p_created,p_overwritten,p_skipped,p_failed);
END $$;

REVOKE ALL ON FUNCTION portal_private.record_job_import(uuid,text,text,text,integer,integer,integer,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_private.record_job_import(uuid,text,text,text,integer,integer,integer,integer,integer) TO portal_runtime;
ALTER FUNCTION portal_private.record_job_import(uuid,text,text,text,integer,integer,integer,integer,integer) OWNER TO portal_jobs_owner;

REVOKE CREATE ON SCHEMA portal_private FROM portal_jobs_owner;
REVOKE portal_jobs_owner FROM CURRENT_USER;
COMMIT;
