BEGIN;
ALTER TABLE portal.departments ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE portal.locations ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
CREATE TABLE portal.job_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK(kind IN('jobType','experience')),
  code text NOT NULL CHECK(code~'^[A-Z][A-Z0-9_]{0,63}$'),
  name_en text NOT NULL CHECK(length(btrim(name_en)) BETWEEN 1 AND 120),
  name_zh text NOT NULL CHECK(length(btrim(name_zh)) BETWEEN 1 AND 120),
  active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1 CHECK(version>0),
  UNIQUE(kind,code)
);
ALTER TABLE portal.job_options ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.job_options FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO portal.job_options(kind,code,name_en,name_zh) VALUES
  ('jobType','FULL_TIME','Full-time','全职'),('jobType','PART_TIME','Part-time','兼职'),
  ('jobType','CONTRACT','Contract','合同工'),('jobType','INTERNSHIP','Internship','实习'),
  ('jobType','INTERN','Internship','实习'),('jobType','TEMPORARY','Temporary','临时'),
  ('experience','ENTRY','Entry level','初级'),('experience','MID','Mid level','中级'),
  ('experience','SENIOR','Senior','高级'),('experience','ANY','Any experience','经验不限');
GRANT SELECT ON portal.job_options TO portal_runtime,portal_public_view_owner,portal_jobs_owner;
GRANT UPDATE(id) ON portal.job_options TO portal_jobs_owner;
CREATE POLICY reference_staff_read ON portal.job_options FOR SELECT TO portal_runtime USING((SELECT portal_private.current_staff_role()) IN('ADMIN','HR','READ_ONLY'));
CREATE POLICY reference_public_labels ON portal.job_options FOR SELECT TO portal_public_view_owner USING(true);
CREATE POLICY reference_commands ON portal.job_options TO portal_jobs_owner USING(true) WITH CHECK(true);
GRANT portal_public_view_owner TO CURRENT_USER;
GRANT CREATE ON SCHEMA portal TO portal_public_view_owner;
SET LOCAL ROLE portal_public_view_owner;
CREATE VIEW portal.public_job_options WITH(security_barrier=true) AS SELECT kind,code,name_en,name_zh FROM portal.job_options;
GRANT SELECT ON portal.public_job_options TO portal_public_reader;
RESET ROLE;
REVOKE CREATE ON SCHEMA portal FROM portal_public_view_owner;

-- Track changes made by either the Admin API or an operator, with no-op stability.
CREATE FUNCTION portal_private.reference_version() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  NEW.version:=CASE WHEN (to_jsonb(NEW)-'version') IS DISTINCT FROM (to_jsonb(OLD)-'version') THEN OLD.version+1 ELSE OLD.version END;
  RETURN NEW;
END $$;
CREATE TRIGGER reference_version BEFORE UPDATE ON portal.departments FOR EACH ROW EXECUTE FUNCTION portal_private.reference_version();
CREATE TRIGGER reference_version BEFORE UPDATE ON portal.locations FOR EACH ROW EXECUTE FUNCTION portal_private.reference_version();
CREATE TRIGGER reference_version BEFORE UPDATE ON portal.job_options FOR EACH ROW EXECUTE FUNCTION portal_private.reference_version();

GRANT portal_jobs_owner TO CURRENT_USER;
GRANT CREATE ON SCHEMA portal_private TO portal_jobs_owner;
GRANT INSERT,UPDATE ON portal.departments,portal.locations,portal.job_options TO portal_jobs_owner;
CREATE TABLE portal_private.reference_commands(request_id uuid PRIMARY KEY,actor_id uuid NOT NULL,digest text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE portal_private.reference_commands ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON portal_private.reference_commands TO portal_jobs_owner;
CREATE POLICY reference_command_owner ON portal_private.reference_commands TO portal_jobs_owner USING(true) WITH CHECK(true);
REVOKE INSERT(id,code,name_zh,name_en,active),UPDATE(code,name_zh,name_en,active) ON portal.departments FROM portal_runtime;
REVOKE INSERT(id,code,name_zh,name_en,address_zh,address_en,country_code,timezone,active),UPDATE(code,name_zh,name_en,address_zh,address_en,country_code,timezone,active) ON portal.locations FROM portal_runtime;

CREATE FUNCTION portal_private.manage_job_reference(p_category text,p_id uuid,p_expected integer,p_request uuid,p_value jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
  relation text; prior jsonb; result jsonb; previous portal_private.reference_commands%ROWTYPE; digest text;
BEGIN
  IF p_category IS NULL OR p_category NOT IN('department','location','jobType','experience') OR p_id IS NULL OR p_expected IS NULL OR p_expected<0 OR p_request IS NULL
    OR p_value IS NULL OR jsonb_typeof(p_value)<>'object' OR octet_length(p_value::text)>10000 THEN RAISE EXCEPTION 'Invalid reference' USING ERRCODE='22023'; END IF;
  IF portal_private.staff_session_is_admitted((nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid) IS NOT TRUE THEN RAISE EXCEPTION 'Session not admitted' USING ERRCODE='42501'; END IF;
  PERFORM id FROM portal.staff_profiles WHERE id=actor AND active AND role='ADMIN' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Denied' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_value) k WHERE k NOT IN('code','nameEn','nameZh','active','countryCode','timeZone','addressEn','addressZh'))
    OR jsonb_typeof(p_value->'code') IS DISTINCT FROM 'string' OR p_value->>'code'!~'^[A-Z][A-Z0-9_]{0,63}$'
    OR jsonb_typeof(p_value->'nameEn') IS DISTINCT FROM 'string' OR length(btrim(p_value->>'nameEn')) NOT BETWEEN 1 AND 120
    OR jsonb_typeof(p_value->'nameZh') IS DISTINCT FROM 'string' OR length(btrim(p_value->>'nameZh')) NOT BETWEEN 1 AND 120
    OR jsonb_typeof(p_value->'active') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid reference' USING ERRCODE='22023'; END IF;
  IF p_category='location' THEN
    IF jsonb_typeof(p_value->'countryCode') IS DISTINCT FROM 'string' OR p_value->>'countryCode'!~'^[A-Z]{2}$'
      OR jsonb_typeof(p_value->'timeZone') IS DISTINCT FROM 'string' OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_value->>'timeZone')
      OR length(coalesce(p_value->>'addressEn',''))>300 OR length(coalesce(p_value->>'addressZh',''))>300 THEN RAISE EXCEPTION 'Invalid location' USING ERRCODE='22023'; END IF;
  ELSIF p_value ?| ARRAY['countryCode','timeZone','addressEn','addressZh'] THEN RAISE EXCEPTION 'Invalid reference' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,72708));
  digest:=md5(jsonb_build_object('category',p_category,'id',p_id,'expected',p_expected,'value',p_value)::text);
  SELECT * INTO previous FROM portal_private.reference_commands WHERE request_id=p_request;
  IF FOUND THEN
    IF previous.actor_id<>actor OR previous.digest<>digest THEN RAISE EXCEPTION 'Request conflict' USING ERRCODE='40001'; END IF;
    RETURN previous.result;
  END IF;
  relation:=CASE p_category WHEN 'department' THEN 'departments' WHEN 'location' THEN 'locations' ELSE 'job_options' END;
  EXECUTE format('SELECT to_jsonb(t) FROM portal.%I t WHERE id=$1 FOR UPDATE',relation) INTO prior USING p_id;
  IF p_expected=0 THEN
    IF prior IS NOT NULL THEN RAISE EXCEPTION 'Reference exists' USING ERRCODE='40001'; END IF;
    IF p_category='department' THEN
      INSERT INTO portal.departments(id,code,name_en,name_zh,active) VALUES(p_id,p_value->>'code',btrim(p_value->>'nameEn'),btrim(p_value->>'nameZh'),(p_value->>'active')::boolean);
    ELSIF p_category='location' THEN
      INSERT INTO portal.locations(id,code,name_en,name_zh,active,country_code,timezone,address_en,address_zh)
        VALUES(p_id,p_value->>'code',btrim(p_value->>'nameEn'),btrim(p_value->>'nameZh'),(p_value->>'active')::boolean,p_value->>'countryCode',p_value->>'timeZone',nullif(btrim(p_value->>'addressEn'),''),nullif(btrim(p_value->>'addressZh'),''));
    ELSE
      INSERT INTO portal.job_options(id,kind,code,name_en,name_zh,active) VALUES(p_id,p_category,p_value->>'code',btrim(p_value->>'nameEn'),btrim(p_value->>'nameZh'),(p_value->>'active')::boolean);
    END IF;
  ELSE
    IF prior IS NULL THEN RAISE EXCEPTION 'Reference missing' USING ERRCODE='P0002'; END IF;
    IF (prior->>'version')::integer<>p_expected OR prior->>'code'<>p_value->>'code' OR (relation='job_options' AND prior->>'kind'<>p_category) THEN RAISE EXCEPTION 'Reference changed' USING ERRCODE='40001'; END IF;
    IF p_category='location' THEN
      UPDATE portal.locations SET name_en=btrim(p_value->>'nameEn'),name_zh=btrim(p_value->>'nameZh'),active=(p_value->>'active')::boolean,
        country_code=p_value->>'countryCode',timezone=p_value->>'timeZone',address_en=nullif(btrim(p_value->>'addressEn'),''),address_zh=nullif(btrim(p_value->>'addressZh'),'') WHERE id=p_id;
    ELSE
      EXECUTE format('UPDATE portal.%I SET name_en=$2,name_zh=$3,active=$4 WHERE id=$1',relation)
        USING p_id,btrim(p_value->>'nameEn'),btrim(p_value->>'nameZh'),(p_value->>'active')::boolean;
    END IF;
  END IF;
  EXECUTE format('SELECT jsonb_build_object(''id'',id,''version'',version) FROM portal.%I WHERE id=$1',relation) INTO result USING p_id;
  IF relation='job_options' AND (prior IS NULL OR (prior->>'version')::integer<>(result->>'version')::integer) THEN
    INSERT INTO portal.audit_logs(actor_id,object_type,object_id,action,safe_changes,request_id)
      VALUES(actor,'JOB_OPTION',p_id,CASE WHEN p_expected=0 THEN 'JOB_OPTION_CREATED' ELSE 'JOB_OPTION_UPDATED' END,
        jsonb_build_object('version',(result->>'version')::integer,'fields',jsonb_build_array('name_en','name_zh','active')),p_request);
    INSERT INTO portal.outbox_events(event_type,aggregate_id,delivery_key,safe_references)
      VALUES('JOB_OPTION_UPDATED',p_id,'reference:'||p_request,jsonb_build_object('id',p_id));
  END IF;
  INSERT INTO portal_private.reference_commands VALUES(p_request,actor,digest,result,now());
  RETURN result;
END $$;
ALTER FUNCTION portal_private.manage_job_reference(text,uuid,integer,uuid,jsonb) OWNER TO portal_jobs_owner;
REVOKE ALL ON FUNCTION portal_private.manage_job_reference(text,uuid,integer,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_private.manage_job_reference(text,uuid,integer,uuid,jsonb) TO portal_runtime;

-- Updated job normalization and validation follow below.
CREATE OR REPLACE FUNCTION portal_private.normalize_job_draft(p_draft jsonb) RETURNS jsonb
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
  IF s->>'jobType' IS NULL OR jsonb_typeof(s->'jobType')<>'string' OR s->>'jobType' !~ '^[A-Z][A-Z0-9_]{0,63}$' THEN PERFORM portal_private.job_invalid('draft.settings.jobType','invalid'); END IF;
  IF s->>'experience' IS NULL OR jsonb_typeof(s->'experience')<>'string' OR s->>'experience' !~ '^[A-Z][A-Z0-9_]{0,63}$' THEN PERFORM portal_private.job_invalid('draft.settings.experience','invalid'); END IF;
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
  PERFORM id FROM portal.job_options WHERE kind='jobType' AND code=s->>'jobType' AND active FOR SHARE;
  IF NOT FOUND THEN PERFORM portal_private.job_invalid('draft.settings.jobType','inactive'); END IF;
  PERFORM id FROM portal.job_options WHERE kind='experience' AND code=s->>'experience' AND active FOR SHARE;
  IF NOT FOUND THEN PERFORM portal_private.job_invalid('draft.settings.experience','inactive'); END IF;
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

CREATE OR REPLACE FUNCTION portal_private.audit_codes_are_safe(kind text,event text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT kind IN('JOB','APPLICATION','CANDIDATE','CONTENT','CONTENT_IMAGE','STAFF_PROFILE','AUTH_ACCOUNT','DEPARTMENT','LOCATION','CONTACT_MESSAGE','JOB_OPTION')
    AND event IN(
      'JOB_CREATE','JOB_SAVE','JOB_DUPLICATE','JOB_SUBMIT','JOB_PUBLISH','JOB_PAUSE','JOB_RESUME','JOB_CLOSE','DEV_FIXTURE_SEEDED',
      'APPLICATION_STAGE_CHANGED','CANDIDATES_MERGED','CV_URL_ISSUED','UPDATED','CONFIRMED',
      'CONTENT_CREATE','CONTENT_SAVE','CONTENT_PUBLISH','CONTENT_UNPUBLISH','CONTENT_IMAGE_UPLOADED','CONTENT_TEMPLATE_CREATED','CONTENT_SEEDED',
      'STAFF_LINKED','STAFF_CHANGED','STAFF_BOOTSTRAPPED','STAFF_PROVIDER_SYNCED','PASSWORD_CHANGED','PASSWORD_CHANGE_UNCERTAIN',
      'DEPARTMENT_CREATED','DEPARTMENT_UPDATED','DEPARTMENT_DELETED','LOCATION_CREATED','LOCATION_UPDATED','LOCATION_DELETED',
      'CONTACT_MESSAGE_CREATED','CONTACT_MESSAGE_UPDATED','CONTACT_MESSAGE_DELETED','JOB_OPTION_CREATED','JOB_OPTION_UPDATED')
$$;

REVOKE CREATE ON SCHEMA portal_private FROM portal_jobs_owner;
REVOKE portal_jobs_owner FROM CURRENT_USER;
COMMIT;
