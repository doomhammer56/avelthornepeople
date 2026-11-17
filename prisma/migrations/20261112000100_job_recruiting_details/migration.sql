BEGIN;
GRANT portal_jobs_owner TO CURRENT_USER;
GRANT CREATE ON SCHEMA portal_private TO portal_jobs_owner;

-- Fix forward: accept an optional staff-only "recruiting" block in job drafts
-- (priority, gender and bilingual free-text details from the recruiting sheet).
-- It lives beside "settings", so it stays editable after the settings lock, and
-- it is never selected by the public job DTO. Everything else is unchanged from
-- the previous definition.
CREATE OR REPLACE FUNCTION portal_private.normalize_job_draft(p_draft jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE result jsonb:='{}'; s jsonb; content jsonb; v_lang text; f text; v jsonb; a jsonb; t text; n numeric; stamp timestamptz; ids uuid[]:='{}'; id uuid;
BEGIN
  IF p_draft IS NULL OR jsonb_typeof(p_draft)<>'object' OR octet_length(p_draft::text)>220000 THEN PERFORM portal_private.job_invalid('draft','invalid'); END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_draft) k WHERE k NOT IN ('en','zh','settings','recruiting','developmentFixture')) THEN PERFORM portal_private.job_invalid('draft','invalid'); END IF;
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
  result:=result||jsonb_build_object('settings',s);
  -- Staff-only recruiting details. Stored sparse: empty values are dropped and an
  -- empty block is omitted, so a draft without details is unchanged.
  IF p_draft ? 'recruiting' AND jsonb_typeof(p_draft->'recruiting') IS DISTINCT FROM 'null' THEN
    DECLARE r jsonb:=p_draft->'recruiting'; ro jsonb:='{}'; nf jsonb; nt jsonb; k text; l text; txt text;
    BEGIN
      IF jsonb_typeof(r)<>'object' THEN PERFORM portal_private.job_invalid('draft.recruiting','invalid'); END IF;
      IF EXISTS(SELECT 1 FROM jsonb_object_keys(r) x WHERE x NOT IN ('priority','gender','nationality','age','languages','workingHours','salaryNote','workArrangement','other','benefits','precautions','hardRequirements','remark')) THEN
        PERFORM portal_private.job_invalid('draft.recruiting','invalid');
      END IF;
      IF r ? 'priority' AND jsonb_typeof(r->'priority')<>'null' THEN
        IF jsonb_typeof(r->'priority')<>'string' OR r->>'priority' NOT IN ('URGENT','HIGH','MEDIUM','LOW') THEN
          PERFORM portal_private.job_invalid('draft.recruiting.priority','invalid');
        END IF;
        ro:=ro||jsonb_build_object('priority',r->'priority');
      END IF;
      IF r ? 'gender' AND jsonb_typeof(r->'gender')<>'null' THEN
        IF jsonb_typeof(r->'gender')<>'string' OR r->>'gender' NOT IN ('ANY','FEMALE_PREFERRED','MALE_PREFERRED','FEMALE','MALE') THEN
          PERFORM portal_private.job_invalid('draft.recruiting.gender','invalid');
        END IF;
        ro:=ro||jsonb_build_object('gender',r->'gender');
      END IF;
      FOREACH k IN ARRAY ARRAY['nationality','age','languages','workingHours','salaryNote','workArrangement','other','benefits','precautions','hardRequirements','remark'] LOOP
        IF r ? k AND jsonb_typeof(r->k)<>'null' THEN
          nf:=r->k;
          IF jsonb_typeof(nf)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(nf) x WHERE x NOT IN ('en','zh')) THEN
            PERFORM portal_private.job_invalid('draft.recruiting','invalid');
          END IF;
          nt:='{}';
          FOREACH l IN ARRAY ARRAY['en','zh'] LOOP
            IF nf ? l AND jsonb_typeof(nf->l)<>'null' THEN
              IF jsonb_typeof(nf->l)<>'string' THEN PERFORM portal_private.job_invalid('draft.recruiting','invalid'); END IF;
              txt:=nf->>l;
              IF length(txt)>4000 THEN PERFORM portal_private.job_invalid('draft.recruiting','too_long'); END IF;
              txt:=portal_private.job_trim(txt);
              IF txt<>'' THEN nt:=nt||jsonb_build_object(l,txt); END IF;
            END IF;
          END LOOP;
          IF nt<>'{}'::jsonb THEN ro:=ro||jsonb_build_object(k,nt); END IF;
        END IF;
      END LOOP;
      IF ro<>'{}'::jsonb THEN result:=result||jsonb_build_object('recruiting',ro); END IF;
    END;
  END IF;
  RETURN result;
END $$;

REVOKE CREATE ON SCHEMA portal_private FROM portal_jobs_owner;
REVOKE portal_jobs_owner FROM CURRENT_USER;
COMMIT;
