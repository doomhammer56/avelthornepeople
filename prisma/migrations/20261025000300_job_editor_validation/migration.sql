BEGIN;
GRANT portal_jobs_owner TO CURRENT_USER;

-- All details use a fixed vocabulary. HTTP handlers allowlist them again.
CREATE FUNCTION portal_private.job_invalid(p_field text,p_code text) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
  RAISE EXCEPTION 'Job validation failed' USING ERRCODE='22023',
    DETAIL=jsonb_build_array(jsonb_build_object('field',p_field,'code',p_code))::text;
END $$;

CREATE FUNCTION portal_private.job_trim(p_value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
  SELECT btrim(p_value,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
$$;

CREATE FUNCTION portal_private.normalize_job_draft(p_draft jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE result jsonb:='{}'; s jsonb; content jsonb; v_lang text; f text; v jsonb; a jsonb; t text; n numeric; stamp timestamptz; ids uuid[]:='{}'; id uuid;
BEGIN
  IF p_draft IS NULL OR jsonb_typeof(p_draft)<>'object' OR octet_length(p_draft::text)>220000 THEN PERFORM portal_private.job_invalid('draft','invalid'); END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_draft) k WHERE k NOT IN ('en','zh','settings','developmentFixture')) THEN PERFORM portal_private.job_invalid('draft','invalid'); END IF;
  FOREACH v_lang IN ARRAY ARRAY['en','zh'] LOOP
    content:=p_draft->v_lang;
    IF jsonb_typeof(content) IS DISTINCT FROM 'object' THEN PERFORM portal_private.job_invalid('draft','invalid'); END IF;
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(content) k WHERE k NOT IN ('title','responsibilities','requirements')) THEN PERFORM portal_private.job_invalid('draft','invalid'); END IF;
    IF jsonb_typeof(content->'title') IS DISTINCT FROM 'string' THEN PERFORM portal_private.job_invalid('draft.'||v_lang||'.title','invalid'); END IF;
    t:=content->>'title';
    IF length(t)>200 THEN PERFORM portal_private.job_invalid('draft.'||v_lang||'.title','too_long'); END IF;
    content:=jsonb_build_object('title',portal_private.job_trim(t));
    FOREACH f IN ARRAY ARRAY['responsibilities','requirements'] LOOP
      a:=p_draft->v_lang->f;
      IF jsonb_typeof(a) IS DISTINCT FROM 'array' THEN PERFORM portal_private.job_invalid('draft.'||v_lang||'.'||f,'invalid'); END IF;
      IF jsonb_array_length(a)>50 THEN PERFORM portal_private.job_invalid('draft.'||v_lang||'.'||f,'too_many'); END IF;
      v:='[]';
      FOR t IN SELECT value::text FROM jsonb_array_elements(a) LOOP
        -- Inspect original JSON type before extracting its plain text.
        IF jsonb_typeof(t::jsonb)<>'string' THEN PERFORM portal_private.job_invalid('draft.'||v_lang||'.'||f,'invalid'); END IF;
        t:=t::jsonb#>>'{}';
        IF length(t)>2000 THEN PERFORM portal_private.job_invalid('draft.'||v_lang||'.'||f,'too_long'); END IF;
        t:=portal_private.job_trim(t);
        IF t<>'' THEN v:=v||jsonb_build_array(t); END IF;
      END LOOP;
      content:=content||jsonb_build_object(f,v);
    END LOOP;
    result:=result||jsonb_build_object(v_lang,content);
  END LOOP;
  s:=p_draft->'settings';
  IF jsonb_typeof(s) IS DISTINCT FROM 'object' THEN PERFORM portal_private.job_invalid('draft','invalid'); END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(s) k WHERE k NOT IN ('departmentId','locationIds','jobType','experience','salary','showSalary','publishAt','closeAt')) THEN PERFORM portal_private.job_invalid('draft','invalid'); END IF;
  IF jsonb_typeof(s->'departmentId') IS DISTINCT FROM 'null' THEN
    BEGIN
      IF jsonb_typeof(s->'departmentId') IS DISTINCT FROM 'string' OR s->>'departmentId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN PERFORM portal_private.job_invalid('draft.settings.departmentId','invalid'); END IF;
      id:=(s->>'departmentId')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN PERFORM portal_private.job_invalid('draft.settings.departmentId','invalid'); END;
  END IF;
  IF jsonb_typeof(s->'locationIds') IS DISTINCT FROM 'array' THEN PERFORM portal_private.job_invalid('draft.settings.locationIds','invalid'); END IF;
  IF jsonb_array_length(s->'locationIds')>30 THEN PERFORM portal_private.job_invalid('draft.settings.locationIds','too_many'); END IF;
  FOR v IN SELECT value FROM jsonb_array_elements(s->'locationIds') LOOP
    BEGIN
      IF jsonb_typeof(v)<>'string' OR v#>>'{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN PERFORM portal_private.job_invalid('draft.settings.locationIds','invalid'); END IF;
      id:=(v#>>'{}')::uuid;
      IF id=ANY(ids) THEN PERFORM portal_private.job_invalid('draft.settings.locationIds','invalid'); END IF;
      ids:=array_append(ids,id);
    EXCEPTION WHEN invalid_text_representation THEN PERFORM portal_private.job_invalid('draft.settings.locationIds','invalid'); END;
  END LOOP;
  IF jsonb_typeof(s->'showSalary') IS DISTINCT FROM 'boolean' THEN PERFORM portal_private.job_invalid('draft.settings.showSalary','invalid'); END IF;
  IF s->>'jobType' IS NULL OR s->>'jobType' NOT IN ('FULL_TIME','PART_TIME','CONTRACT','INTERNSHIP','INTERN','TEMPORARY') THEN PERFORM portal_private.job_invalid('draft.settings.jobType','invalid'); END IF;
  IF s->>'experience' IS NULL OR s->>'experience' NOT IN ('ENTRY','MID','SENIOR','ANY') THEN PERFORM portal_private.job_invalid('draft.settings.experience','invalid'); END IF;
  IF jsonb_typeof(s->'salary') IS DISTINCT FROM 'null' THEN
    v:=s->'salary';
    IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN PERFORM portal_private.job_invalid('draft.settings.salary','invalid'); END IF;
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN ('min','max','currency','period')) THEN PERFORM portal_private.job_invalid('draft.settings.salary','invalid'); END IF;
    FOREACH f IN ARRAY ARRAY['min','max'] LOOP
      IF jsonb_typeof(v->f) IS DISTINCT FROM 'number' THEN PERFORM portal_private.job_invalid('draft.settings.salary.'||f,'invalid'); END IF;
      n:=(v->>f)::numeric;
      IF n<0 OR n>999999999999.99 THEN PERFORM portal_private.job_invalid('draft.settings.salary.'||f,'invalid'); END IF;
      IF n<>trunc(n,2) THEN PERFORM portal_private.job_invalid('draft.settings.salary.'||f,'precision'); END IF;
    END LOOP;
    IF (v->>'min')::numeric>(v->>'max')::numeric THEN PERFORM portal_private.job_invalid('draft.settings.salary.max','invalid_range'); END IF;
    IF v->>'currency' IS NULL OR v->>'currency'!~'^[A-Z]{3}$' THEN PERFORM portal_private.job_invalid('draft.settings.salary.currency','invalid'); END IF;
    IF v->>'period' IS NULL OR v->>'period' NOT IN ('HOUR','DAY','MONTH','YEAR') THEN PERFORM portal_private.job_invalid('draft.settings.salary.period','invalid'); END IF;
  ELSIF (s->>'showSalary')::boolean THEN PERFORM portal_private.job_invalid('draft.settings.salary','required'); END IF;
  FOREACH f IN ARRAY ARRAY['publishAt','closeAt'] LOOP
    IF jsonb_typeof(s->f) IS DISTINCT FROM 'null' THEN
      t:=s->>f;
      IF jsonb_typeof(s->f) IS DISTINCT FROM 'string' OR t!~'^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$' THEN PERFORM portal_private.job_invalid('draft.settings.'||f,'invalid'); END IF;
      BEGIN stamp:=t::timestamptz;
      EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN PERFORM portal_private.job_invalid('draft.settings.'||f,'invalid'); END;
      IF NOT isfinite(stamp) THEN PERFORM portal_private.job_invalid('draft.settings.'||f,'invalid'); END IF;
      s:=jsonb_set(s,ARRAY[f],to_jsonb(to_char(stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
    END IF;
  END LOOP;
  IF s->>'closeAt' IS NOT NULL AND s->>'publishAt' IS NOT NULL AND (s->>'closeAt')::timestamptz<=(s->>'publishAt')::timestamptz THEN PERFORM portal_private.job_invalid('draft.settings.closeAt','invalid_range'); END IF;
  RETURN result||jsonb_build_object('settings',s);
END $$;

CREATE OR REPLACE FUNCTION portal_private.validate_job_draft(p_draft jsonb,p_publish boolean,p_fallback boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE d jsonb:=portal_private.normalize_job_draft(p_draft); s jsonb; v_lang text; f text; v_location uuid;
BEGIN
  s:=d->'settings';
  IF p_publish THEN
    FOREACH v_lang IN ARRAY ARRAY['zh','en'] LOOP
      IF v_lang='zh' OR NOT coalesce(p_fallback,false) THEN
        IF d->v_lang->>'title'='' THEN PERFORM portal_private.job_invalid('draft.'||v_lang||'.title',CASE WHEN v_lang='en' THEN 'fallback_required' ELSE 'required' END); END IF;
        FOREACH f IN ARRAY ARRAY['responsibilities','requirements'] LOOP
          IF jsonb_array_length(d->v_lang->f)=0 THEN PERFORM portal_private.job_invalid('draft.'||v_lang||'.'||f,CASE WHEN v_lang='en' THEN 'fallback_required' ELSE 'required' END); END IF;
        END LOOP;
      END IF;
    END LOOP;
    IF s->>'departmentId' IS NULL THEN PERFORM portal_private.job_invalid('draft.settings.departmentId','required'); END IF;
    IF jsonb_array_length(s->'locationIds')=0 THEN PERFORM portal_private.job_invalid('draft.settings.locationIds','required'); END IF;
    IF (s->>'closeAt')::timestamptz<=statement_timestamp() THEN PERFORM portal_private.job_invalid('draft.settings.closeAt','expired'); END IF;
  END IF;
  IF s->>'departmentId' IS NOT NULL THEN
    PERFORM 1 FROM portal.departments WHERE portal.departments.id=(s->>'departmentId')::uuid AND active
      AND (NOT p_publish OR coalesce(p_fallback,false) OR nullif(portal_private.job_trim(name_en),'') IS NOT NULL) FOR SHARE;
    IF NOT FOUND THEN PERFORM portal_private.job_invalid('draft.settings.departmentId','inactive'); END IF;
  END IF;
  FOR v_location IN SELECT value::uuid FROM jsonb_array_elements_text(s->'locationIds') ORDER BY value LOOP
    PERFORM 1 FROM portal.locations WHERE id=v_location AND active
      AND (NOT p_publish OR coalesce(p_fallback,false) OR nullif(portal_private.job_trim(name_en),'') IS NOT NULL) FOR SHARE;
    IF NOT FOUND THEN PERFORM portal_private.job_invalid('draft.settings.locationIds','inactive'); END IF;
  END LOOP;
END $$;

-- The command replacement follows below; no table grants change.

CREATE OR REPLACE FUNCTION portal_private.manage_job(p_action text,p_id uuid,p_expected integer,p_request uuid,
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
    p_draft:=portal_private.normalize_job_draft(p_draft);
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
        p_draft:=portal_private.normalize_job_draft(p_draft);
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
        p_draft:=portal_private.normalize_job_draft(j.draft_content);
        s:=p_draft->'settings';
        -- Null means immediate on first approval, preserve the approved date on later edits.
        s:=jsonb_set(s,'{publishAt}',to_jsonb(to_char(coalesce((s->>'publishAt')::timestamptz,j.publish_at,v_now) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
        p_draft:=jsonb_set(p_draft,'{settings}',s);
        PERFORM portal_private.validate_job_draft(p_draft,true,coalesce(p_fallback,false));
        v_content:=p_draft || jsonb_build_object('englishFallback',coalesce(p_fallback,false));
        IF j.published_content=v_content AND j.status='PUBLISHED' THEN RETURN j.id; END IF;
        UPDATE portal.jobs SET draft_content=p_draft,published_content=v_content,published_version=version+1,version=version+1,
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

REVOKE ALL ON FUNCTION portal_private.job_invalid(text,text),portal_private.job_trim(text),portal_private.normalize_job_draft(jsonb) FROM PUBLIC;
GRANT CREATE ON SCHEMA portal_private TO portal_jobs_owner;
ALTER FUNCTION portal_private.job_invalid(text,text) OWNER TO portal_jobs_owner;
ALTER FUNCTION portal_private.job_trim(text) OWNER TO portal_jobs_owner;
ALTER FUNCTION portal_private.normalize_job_draft(jsonb) OWNER TO portal_jobs_owner;
REVOKE CREATE ON SCHEMA portal_private FROM portal_jobs_owner;
REVOKE portal_jobs_owner FROM CURRENT_USER;
COMMIT;
