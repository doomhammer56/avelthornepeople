BEGIN;
GRANT portal_jobs_owner TO CURRENT_USER;

-- Publish one complete language or both. Blank translations are optional;
-- started translations must be complete. Draft saves remain permissive.
-- Keep existing function signatures/owners/grants for older callers.
CREATE OR REPLACE FUNCTION portal_private.validate_job_draft(p_draft jsonb,p_publish boolean,p_fallback boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE d jsonb:=portal_private.normalize_job_draft(p_draft); s jsonb; v_lang text; f text; v_location uuid; v_languages integer:=0; v_has_content boolean;
BEGIN
  s:=d->'settings';
  PERFORM id FROM portal.job_options WHERE kind='jobType' AND code=s->>'jobType' AND active FOR SHARE;
  IF NOT FOUND THEN PERFORM portal_private.job_invalid('draft.settings.jobType','inactive'); END IF;
  PERFORM id FROM portal.job_options WHERE kind='experience' AND code=s->>'experience' AND active FOR SHARE;
  IF NOT FOUND THEN PERFORM portal_private.job_invalid('draft.settings.experience','inactive'); END IF;
  IF p_publish THEN
    FOREACH v_lang IN ARRAY ARRAY['en','zh'] LOOP
      v_has_content := d->v_lang->>'title'<>'' OR jsonb_array_length(d->v_lang->'responsibilities')>0 OR jsonb_array_length(d->v_lang->'requirements')>0;
      IF v_has_content THEN
        v_languages:=v_languages+1;
        IF d->v_lang->>'title'='' THEN PERFORM portal_private.job_invalid('draft.'||v_lang||'.title','required'); END IF;
        FOREACH f IN ARRAY ARRAY['responsibilities','requirements'] LOOP
          IF jsonb_array_length(d->v_lang->f)=0 THEN PERFORM portal_private.job_invalid('draft.'||v_lang||'.'||f,'required'); END IF;
        END LOOP;
      END IF;
    END LOOP;
    IF v_languages=0 THEN PERFORM portal_private.job_invalid('draft','language_required'); END IF;
    IF s->>'departmentId' IS NULL THEN PERFORM portal_private.job_invalid('draft.settings.departmentId','required'); END IF;
    IF jsonb_array_length(s->'locationIds')=0 THEN PERFORM portal_private.job_invalid('draft.settings.locationIds','required'); END IF;
    IF (s->>'closeAt')::timestamptz<=statement_timestamp() THEN PERFORM portal_private.job_invalid('draft.settings.closeAt','expired'); END IF;
  END IF;
  IF s->>'departmentId' IS NOT NULL THEN
    PERFORM 1 FROM portal.departments WHERE portal.departments.id=(s->>'departmentId')::uuid AND active
      AND (NOT p_publish OR nullif(d#>>'{en,title}','') IS NULL OR nullif(portal_private.job_trim(name_en),'') IS NOT NULL) FOR SHARE;
    IF NOT FOUND THEN PERFORM portal_private.job_invalid('draft.settings.departmentId','inactive'); END IF;
  END IF;
  FOR v_location IN SELECT value::uuid FROM jsonb_array_elements_text(s->'locationIds') ORDER BY value LOOP
    PERFORM 1 FROM portal.locations WHERE id=v_location AND active
      AND (NOT p_publish OR nullif(d#>>'{en,title}','') IS NULL OR nullif(portal_private.job_trim(name_en),'') IS NOT NULL) FOR SHARE;
    IF NOT FOUND THEN PERFORM portal_private.job_invalid('draft.settings.locationIds','inactive'); END IF;
  END LOOP;
END $$;


-- Derive fallback metadata from the approved content, without requiring a
-- separate confirmation for a Chinese-only job.
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
        v_content:=p_draft || jsonb_build_object('englishFallback',nullif(p_draft#>>'{en,title}','') IS NULL);
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


REVOKE portal_jobs_owner FROM CURRENT_USER;
COMMIT;
