BEGIN;

CREATE ROLE portal_jobs_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE portal_jobs_worker NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA portal, portal_private TO portal_jobs_owner;
GRANT USAGE ON SCHEMA portal_private TO portal_jobs_worker;
GRANT EXECUTE ON FUNCTION portal_private.staff_session_is_admitted(uuid) TO portal_jobs_owner;
GRANT SELECT ON portal.staff_profiles, portal.departments, portal.locations TO portal_jobs_owner;
-- Row locks require UPDATE permission. No login inherits the command owner's role.
GRANT UPDATE (id) ON portal.staff_profiles, portal.departments, portal.locations TO portal_jobs_owner;
GRANT SELECT, INSERT, UPDATE ON portal.jobs TO portal_jobs_owner;
GRANT SELECT, INSERT, DELETE ON portal.job_locations TO portal_jobs_owner;
GRANT INSERT ON portal.audit_logs, portal.outbox_events TO portal_jobs_owner;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['staff_profiles','departments','locations','jobs','job_locations','audit_logs','outbox_events'] LOOP
    EXECUTE format('CREATE POLICY jobs_command_owner ON portal.%I TO portal_jobs_owner USING (true) WITH CHECK (true)',t);
  END LOOP;
END $$;

-- Remove the legacy unaudited draft write path. All job writes use commands.
REVOKE INSERT (id,canonical_slug,draft_content,owner_id), UPDATE (draft_content,version) ON portal.jobs FROM portal_runtime;

CREATE FUNCTION portal_private.validate_job_draft(p_draft jsonb, p_publish boolean, p_fallback boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE s jsonb := p_draft->'settings'; v_lang text; v_field text; v_value jsonb; v_id uuid; v_publish timestamptz; v_close timestamptz;
BEGIN
  IF p_draft IS NULL OR jsonb_typeof(p_draft) IS DISTINCT FROM 'object' OR octet_length(p_draft::text)>220000
    OR jsonb_typeof(s) IS DISTINCT FROM 'object' OR jsonb_typeof(s->'showSalary') IS DISTINCT FROM 'boolean'
    OR s->>'jobType' IS NULL OR s->>'jobType' NOT IN ('FULL_TIME','PART_TIME','CONTRACT','INTERNSHIP','INTERN','TEMPORARY')
    OR s->>'experience' IS NULL OR s->>'experience' NOT IN ('ENTRY','MID','SENIOR','ANY')
    OR jsonb_typeof(s->'locationIds') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid draft' USING ERRCODE='22023';
  END IF;
  FOREACH v_lang IN ARRAY ARRAY['zh','en'] LOOP
    IF jsonb_typeof(p_draft->v_lang) IS DISTINCT FROM 'object' OR jsonb_typeof(p_draft->v_lang->'title') IS DISTINCT FROM 'string'
      OR length(p_draft->v_lang->>'title')>200 THEN RAISE EXCEPTION 'Invalid content' USING ERRCODE='22023'; END IF;
    FOREACH v_field IN ARRAY ARRAY['responsibilities','requirements'] LOOP
      IF jsonb_typeof(p_draft->v_lang->v_field) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid content' USING ERRCODE='22023'; END IF;
      IF jsonb_array_length(p_draft->v_lang->v_field)>50 THEN RAISE EXCEPTION 'Too many lines' USING ERRCODE='22023'; END IF;
      FOR v_value IN SELECT value FROM jsonb_array_elements(p_draft->v_lang->v_field) LOOP
        IF jsonb_typeof(v_value)<>'string' OR length(v_value#>>'{}')>2000 THEN RAISE EXCEPTION 'Invalid line' USING ERRCODE='22023'; END IF;
      END LOOP;
      IF p_publish AND (v_lang='zh' OR NOT p_fallback) AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(p_draft->v_lang->v_field) l WHERE btrim(l)<>''
      ) THEN RAISE EXCEPTION 'Publication content incomplete' USING ERRCODE='22023'; END IF;
    END LOOP;
    IF p_publish AND (v_lang='zh' OR NOT p_fallback) AND btrim(p_draft->v_lang->>'title')='' THEN
      RAISE EXCEPTION 'Publication title required' USING ERRCODE='22023';
    END IF;
  END LOOP;
  IF jsonb_array_length(s->'locationIds')>30 OR
    (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements_text(s->'locationIds')) THEN
    RAISE EXCEPTION 'Invalid locations' USING ERRCODE='22023';
  END IF;
  v_id := (s->>'departmentId')::uuid;
  IF v_id IS NOT NULL THEN
    PERFORM 1 FROM portal.departments WHERE id=v_id AND active
      AND (NOT p_publish OR p_fallback OR nullif(btrim(name_en),'') IS NOT NULL) FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Inactive department' USING ERRCODE='22023'; END IF;
  ELSIF p_publish THEN RAISE EXCEPTION 'Department required' USING ERRCODE='22023'; END IF;
  FOR v_id IN SELECT value::uuid FROM jsonb_array_elements_text(s->'locationIds') ORDER BY value LOOP
    PERFORM 1 FROM portal.locations WHERE id=v_id AND active
      AND (NOT p_publish OR p_fallback OR nullif(btrim(name_en),'') IS NOT NULL) FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Inactive location' USING ERRCODE='22023'; END IF;
  END LOOP;
  IF p_publish AND jsonb_array_length(s->'locationIds')=0 THEN RAISE EXCEPTION 'Location required' USING ERRCODE='22023'; END IF;
  IF s->'salary' IS NOT NULL AND s->'salary'<>'null'::jsonb THEN
    IF jsonb_typeof(s->'salary'->'min') IS DISTINCT FROM 'number' OR jsonb_typeof(s->'salary'->'max') IS DISTINCT FROM 'number'
      OR (s#>>'{salary,min}')::numeric<0 OR (s#>>'{salary,max}')::numeric<(s#>>'{salary,min}')::numeric
      OR (s#>>'{salary,max}')::numeric>999999999999.99
      OR (s#>>'{salary,currency}') IS NULL OR (s#>>'{salary,currency}')!~'^[A-Z]{3}$'
      OR (s#>>'{salary,period}') IS NULL OR (s#>>'{salary,period}') NOT IN ('HOUR','DAY','MONTH','YEAR') THEN
      RAISE EXCEPTION 'Invalid salary' USING ERRCODE='22023';
    END IF;
  ELSIF (s->>'showSalary')::boolean THEN RAISE EXCEPTION 'Salary required' USING ERRCODE='22023'; END IF;
  -- Require explicit offsets; never interpret a caller's date in the database timezone.
  FOREACH v_field IN ARRAY ARRAY['publishAt','closeAt'] LOOP
    IF s->>v_field IS NOT NULL AND s->>v_field !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
      RAISE EXCEPTION 'Timestamp offset required' USING ERRCODE='22023';
    END IF;
  END LOOP;
  v_publish := (s->>'publishAt')::timestamptz; v_close := (s->>'closeAt')::timestamptz;
  IF (v_publish IS NOT NULL AND NOT isfinite(v_publish)) OR (v_close IS NOT NULL AND NOT isfinite(v_close))
    OR (v_close IS NOT NULL AND v_publish IS NOT NULL AND v_close<=v_publish)
    OR (p_publish AND v_close IS NOT NULL AND v_close<=statement_timestamp()) THEN
    RAISE EXCEPTION 'Invalid schedule' USING ERRCODE='22023';
  END IF;
END $$;

CREATE FUNCTION portal_private.job_event(p_id uuid,p_version integer,p_action text,p_actor uuid,p_request uuid,p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_safe jsonb := jsonb_build_object('version',p_version,'reason',p_reason);
BEGIN
  INSERT INTO portal.audit_logs(actor_id,object_type,object_id,action,safe_changes,request_id)
    VALUES(p_actor,'JOB',p_id,'JOB_'||upper(p_action),v_safe,p_request);
  INSERT INTO portal.outbox_events(event_type,aggregate_id,delivery_key,safe_references)
    VALUES('JOB_'||upper(p_action),p_id,'job:'||p_id::text||':'||p_version::text,
      jsonb_build_object('jobId',p_id,'version',p_version,'reason',p_reason));
END $$;

CREATE FUNCTION portal_private.manage_job(p_action text,p_id uuid,p_expected integer,p_request uuid,
  p_draft jsonb DEFAULT NULL,p_slug text DEFAULT NULL,p_new_id uuid DEFAULT NULL,p_fallback boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j portal.jobs%ROWTYPE; v_role text; v_actor uuid := nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; s jsonb; v_result uuid; v_version integer; v_content jsonb; v_now timestamptz:=statement_timestamp();
BEGIN
  IF p_id IS NULL OR p_request IS NULL OR p_action IS NULL OR p_action NOT IN ('create','save','duplicate','submit','publish','pause','resume','close') THEN
    RAISE EXCEPTION 'Invalid command' USING ERRCODE='22023';
  END IF;
  IF portal_private.staff_session_is_admitted((nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid) IS NOT TRUE THEN
    RAISE EXCEPTION 'Session not admitted' USING ERRCODE='42501';
  END IF;
  SELECT role INTO v_role FROM portal.staff_profiles WHERE id=v_actor AND active FOR SHARE;
  IF v_role IS NULL OR v_role NOT IN ('HR','ADMIN') OR (p_action IN ('publish','resume') AND v_role<>'ADMIN') THEN
    RAISE EXCEPTION 'Staff access denied' USING ERRCODE='42501';
  END IF;
  IF p_action='create' THEN
    PERFORM portal_private.validate_job_draft(p_draft,false);
    IF p_slug IS NULL OR length(p_slug)>180 OR p_slug!~'^[a-z0-9]+(-[a-z0-9]+)*$' THEN RAISE EXCEPTION 'Invalid slug' USING ERRCODE='22023'; END IF;
    INSERT INTO portal.jobs(id,canonical_slug,draft_content,owner_id) VALUES(p_id,p_slug,p_draft,v_actor);
    v_result:=p_id; v_version:=1;
  ELSE
    SELECT * INTO j FROM portal.jobs WHERE id=p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Job missing' USING ERRCODE='P0002'; END IF;
    IF p_expected IS NULL OR j.version<>p_expected THEN RAISE EXCEPTION 'Stale job' USING ERRCODE='40001'; END IF;
    IF p_action='duplicate' THEN
      IF p_new_id IS NULL OR p_new_id=p_id THEN RAISE EXCEPTION 'New identity required' USING ERRCODE='22023'; END IF;
      INSERT INTO portal.jobs(id,canonical_slug,draft_content,owner_id)
        VALUES(p_new_id,'job-'||p_new_id::text,
          CASE WHEN j.draft_content ? 'settings' THEN jsonb_set(j.draft_content,'{settings}',
            (j.draft_content->'settings') || '{"publishAt":null,"closeAt":null}'::jsonb) ELSE j.draft_content END,v_actor);
      v_result:=p_new_id; v_version:=1;
    ELSE
      IF j.status='CLOSED' THEN RAISE EXCEPTION 'Closed is terminal' USING ERRCODE='55000'; END IF;
      IF p_action='save' THEN
        PERFORM portal_private.validate_job_draft(p_draft,false);
        IF p_slug IS NULL OR length(p_slug)>180 OR p_slug!~'^[a-z0-9]+(-[a-z0-9]+)*$' THEN RAISE EXCEPTION 'Invalid slug' USING ERRCODE='22023'; END IF;
        IF j.published_version IS NOT NULL AND p_slug<>j.canonical_slug THEN RAISE EXCEPTION 'Published slug is stable' USING ERRCODE='55000'; END IF;
        IF j.draft_content=p_draft AND j.canonical_slug=p_slug THEN RETURN j.id; END IF;
        UPDATE portal.jobs SET draft_content=p_draft,canonical_slug=p_slug,version=version+1,
          status=CASE WHEN status='PENDING_REVIEW' THEN 'DRAFT' ELSE status END WHERE id=j.id;
      ELSIF p_action='submit' THEN
        PERFORM portal_private.validate_job_draft(j.draft_content,true,true);
        IF j.status='PENDING_REVIEW' OR j.status IN ('PUBLISHED','PAUSED') THEN RETURN j.id; END IF;
        UPDATE portal.jobs SET status='PENDING_REVIEW',version=version+1 WHERE id=j.id;
      ELSIF p_action='publish' THEN
        IF j.status NOT IN ('PENDING_REVIEW','PUBLISHED','PAUSED') THEN RAISE EXCEPTION 'Submit before publication' USING ERRCODE='55000'; END IF;
        PERFORM portal_private.validate_job_draft(j.draft_content,true,coalesce(p_fallback,false));
        s:=j.draft_content->'settings';
        v_content:=j.draft_content || jsonb_build_object('englishFallback',coalesce(p_fallback,false));
        IF j.published_content=v_content AND j.status='PUBLISHED' THEN RETURN j.id; END IF;
        UPDATE portal.jobs SET published_content=v_content,published_version=version+1,version=version+1,
          status='PUBLISHED',department_id=(s->>'departmentId')::uuid,job_type=s->>'jobType',experience=s->>'experience',
          salary_min=(s#>>'{salary,min}')::numeric,salary_max=(s#>>'{salary,max}')::numeric,
          salary_currency=s#>>'{salary,currency}',salary_period=s#>>'{salary,period}',show_salary=(s->>'showSalary')::boolean,
          publish_at=coalesce((s->>'publishAt')::timestamptz,v_now),close_at=(s->>'closeAt')::timestamptz,
          approved_by=v_actor,approved_at=v_now,first_published_at=coalesce(first_published_at,v_now) WHERE id=j.id;
        DELETE FROM portal.job_locations WHERE job_id=j.id;
        INSERT INTO portal.job_locations(job_id,location_id) SELECT j.id,value::uuid FROM jsonb_array_elements_text(s->'locationIds');
      ELSIF p_action='pause' THEN
        IF j.status='PAUSED' THEN RETURN j.id; END IF;
        IF j.status<>'PUBLISHED' THEN RAISE EXCEPTION 'Cannot pause' USING ERRCODE='55000'; END IF;
        UPDATE portal.jobs SET status='PAUSED',version=version+1 WHERE id=j.id;
      ELSIF p_action='resume' THEN
        IF j.status<>'PAUSED' OR j.published_content IS NULL OR j.approved_at IS NULL OR (j.close_at IS NOT NULL AND j.close_at<=v_now) THEN
          RAISE EXCEPTION 'Cannot resume' USING ERRCODE='55000';
        END IF;
        UPDATE portal.jobs SET status='PUBLISHED',version=version+1 WHERE id=j.id;
      ELSIF p_action='close' THEN
        IF j.status NOT IN ('PUBLISHED','PAUSED') THEN RAISE EXCEPTION 'Cannot close' USING ERRCODE='55000'; END IF;
        UPDATE portal.jobs SET status='CLOSED',version=version+1 WHERE id=j.id;
      END IF;
      SELECT version INTO v_version FROM portal.jobs WHERE id=j.id;
      v_result:=j.id;
    END IF;
  END IF;
  PERFORM portal_private.job_event(v_result,v_version,p_action,v_actor,p_request);
  RETURN v_result;
END $$;

CREATE FUNCTION portal_private.close_expired_jobs(p_limit integer,p_request uuid)
RETURNS TABLE(processed integer,remaining boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j record; v_count integer:=0; v_now timestamptz:=statement_timestamp();
BEGIN
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 OR p_request IS NULL THEN RAISE EXCEPTION 'Invalid batch' USING ERRCODE='22023'; END IF;
  FOR j IN SELECT id,version FROM portal.jobs WHERE status IN ('PUBLISHED','PAUSED') AND close_at<=v_now
    ORDER BY close_at,id LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
    UPDATE portal.jobs SET status='CLOSED',version=version+1 WHERE id=j.id AND status IN ('PUBLISHED','PAUSED') AND close_at<=v_now;
    IF FOUND THEN
      PERFORM portal_private.job_event(j.id,j.version+1,'close',NULL,p_request,'EXPIRED');
      v_count:=v_count+1;
    END IF;
  END LOOP;
  RETURN QUERY SELECT v_count,EXISTS(SELECT 1 FROM portal.jobs WHERE status IN ('PUBLISHED','PAUSED') AND close_at<=v_now);
END $$;

REVOKE ALL ON FUNCTION portal_private.validate_job_draft(jsonb,boolean,boolean),portal_private.job_event(uuid,integer,text,uuid,uuid,text),
  portal_private.manage_job(text,uuid,integer,uuid,jsonb,text,uuid,boolean),portal_private.close_expired_jobs(integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_private.manage_job(text,uuid,integer,uuid,jsonb,text,uuid,boolean) TO portal_runtime;
GRANT EXECUTE ON FUNCTION portal_private.close_expired_jobs(integer,uuid) TO portal_jobs_worker;
GRANT portal_jobs_owner TO CURRENT_USER;
GRANT CREATE ON SCHEMA portal_private TO portal_jobs_owner;
ALTER FUNCTION portal_private.validate_job_draft(jsonb,boolean,boolean) OWNER TO portal_jobs_owner;
ALTER FUNCTION portal_private.job_event(uuid,integer,text,uuid,uuid,text) OWNER TO portal_jobs_owner;
ALTER FUNCTION portal_private.manage_job(text,uuid,integer,uuid,jsonb,text,uuid,boolean) OWNER TO portal_jobs_owner;
ALTER FUNCTION portal_private.close_expired_jobs(integer,uuid) OWNER TO portal_jobs_owner;
REVOKE CREATE ON SCHEMA portal_private FROM portal_jobs_owner;
REVOKE portal_jobs_owner FROM CURRENT_USER;
COMMIT;
