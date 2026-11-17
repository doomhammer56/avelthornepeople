BEGIN;
ALTER TABLE portal.content_blocks ADD COLUMN slot text UNIQUE,
  ADD COLUMN published_sort_order integer,
  ADD COLUMN published_version integer,
  ADD CONSTRAINT content_managed_slot CHECK(slot IS NULL OR slot=lower(type)),
  ADD CONSTRAINT content_managed_publication CHECK(slot IS NULL OR
    ((published_content IS NULL AND published_sort_order IS NULL AND published_version IS NULL)
    OR (published_content IS NOT NULL AND published_sort_order IS NOT NULL AND published_version IS NOT NULL AND published_sort_order>=0 AND published_version>0)));

CREATE TABLE portal.content_images(
 id uuid PRIMARY KEY,object_key text NOT NULL UNIQUE CHECK(object_key='images/'||id::text||'.webp'),
 width integer NOT NULL CHECK(width BETWEEN 1 AND 2400),height integer NOT NULL CHECK(height BETWEEN 1 AND 2400),
 size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 3000000),sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),
 uploaded_by uuid NOT NULL REFERENCES portal.staff_profiles(id) ON DELETE RESTRICT,
 created_at timestamptz(6) NOT NULL DEFAULT now()
);
ALTER TABLE portal.content_images ENABLE ROW LEVEL SECURITY;
CREATE ROLE portal_content_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT portal_content_owner TO CURRENT_USER;
GRANT USAGE ON SCHEMA portal,portal_private TO portal_content_owner;
GRANT CREATE ON SCHEMA portal_private TO portal_content_owner;
GRANT EXECUTE ON FUNCTION portal_private.staff_session_is_admitted(uuid) TO portal_content_owner;
GRANT SELECT ON portal.staff_profiles,portal.content_blocks,portal.content_images TO portal_content_owner;
GRANT UPDATE(id) ON portal.staff_profiles,portal.content_images TO portal_content_owner;
GRANT INSERT,UPDATE ON portal.content_blocks TO portal_content_owner;
GRANT INSERT ON portal.content_images,portal.audit_logs,portal.outbox_events TO portal_content_owner;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['staff_profiles','content_blocks','content_images','audit_logs','outbox_events'] LOOP
 EXECUTE format('CREATE POLICY content_command_owner ON portal.%I TO portal_content_owner USING(true) WITH CHECK(true)',t);
END LOOP; END $$;
REVOKE INSERT(id,type,sort_order,draft_content),UPDATE(type,sort_order,draft_content,version) ON portal.content_blocks FROM portal_runtime;
GRANT SELECT ON portal.content_images TO portal_runtime;
CREATE POLICY content_staff_images ON portal.content_images FOR SELECT TO portal_runtime
 USING((SELECT portal_private.current_staff_role()) IN('ADMIN','HR','READ_ONLY'));
CREATE TABLE portal_private.content_commands(request_id uuid PRIMARY KEY,actor_id uuid NOT NULL,digest text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE portal_private.content_commands ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON portal_private.content_commands TO portal_content_owner;
CREATE POLICY content_command_records ON portal_private.content_commands TO portal_content_owner USING(true) WITH CHECK(true);

CREATE FUNCTION portal_private.content_admin() RETURNS uuid LANGUAGE plpgsql SET search_path='' AS $$
DECLARE actor uuid:=nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; role_name text;
BEGIN
 IF portal_private.staff_session_is_admitted((nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid) IS NOT TRUE THEN RAISE EXCEPTION 'Session not admitted' USING ERRCODE='42501'; END IF;
 SELECT role INTO role_name FROM portal.staff_profiles WHERE id=actor AND active FOR SHARE;
 IF role_name IS DISTINCT FROM 'ADMIN' THEN RAISE EXCEPTION 'Denied' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;

CREATE FUNCTION portal_private.validate_content(p_type text,p_draft jsonb,p_publish boolean,p_fallback boolean) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE lang text; field text; item jsonb; part jsonb; image_id uuid; item_ids text[]:=ARRAY[]::text[]; whitespace text:=E' \t\r\n'||chr(11)||chr(12)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279);
BEGIN
 IF p_type IS NULL OR p_type NOT IN('BANNER','PROFILE','CULTURE','BENEFIT','LOCATION','TEAM') OR p_draft IS NULL
  OR jsonb_typeof(p_draft) IS DISTINCT FROM 'object' OR octet_length(p_draft::text)>240000
  OR NOT p_draft ?& ARRAY['en','zh','imageId','items'] OR (SELECT count(*) FROM jsonb_object_keys(p_draft))<>4
  OR jsonb_typeof(p_draft->'items') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid content' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_draft->'items')>30 OR jsonb_typeof(p_draft->'imageId') NOT IN('null','string') THEN RAISE EXCEPTION 'Invalid content' USING ERRCODE='22023'; END IF;
 FOREACH lang IN ARRAY ARRAY['zh','en'] LOOP
  part:=p_draft->lang;
  IF jsonb_typeof(part) IS DISTINCT FROM 'object' OR NOT part ?& ARRAY['title','body','eyebrow','imageAlt'] OR (SELECT count(*) FROM jsonb_object_keys(part))<>4 THEN RAISE EXCEPTION 'Invalid translation' USING ERRCODE='22023'; END IF;
  FOREACH field IN ARRAY ARRAY['title','body','eyebrow','imageAlt'] LOOP
   IF jsonb_typeof(part->field) IS DISTINCT FROM 'string' OR length(part->>field)>(CASE field WHEN 'title' THEN 200 WHEN 'body' THEN 6000 WHEN 'eyebrow' THEN 120 ELSE 250 END) THEN RAISE EXCEPTION 'Invalid translation' USING ERRCODE='22023'; END IF;
  END LOOP;
  IF p_publish AND (lang='zh' OR NOT p_fallback) AND (btrim(part->>'title',whitespace)='' OR (p_type IN('BANNER','PROFILE') AND btrim(part->>'body',whitespace)='') OR (p_draft->>'imageId' IS NOT NULL AND btrim(part->>'imageAlt',whitespace)='')) THEN RAISE EXCEPTION 'Translation required' USING ERRCODE='22023'; END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_draft->'items') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR NOT item ?& ARRAY['id','kind','en','zh','imageId','locationFilter'] OR (SELECT count(*) FROM jsonb_object_keys(item))<>6
   OR jsonb_typeof(item->'id') IS DISTINCT FROM 'string' OR item->>'id'!~'^[a-zA-Z0-9_-]{1,50}$' OR item->>'id'=ANY(item_ids)
   OR jsonb_typeof(item->'kind') IS DISTINCT FROM 'string'
   OR (p_type='BANNER' AND item->>'kind'<>'stat') OR (p_type='PROFILE' AND item->>'kind' NOT IN('mission','history','service','card')) OR (p_type NOT IN('BANNER','PROFILE') AND item->>'kind'<>'card')
   OR jsonb_typeof(item->'locationFilter') IS DISTINCT FROM 'string' OR length(item->>'locationFilter')>100 OR jsonb_typeof(item->'imageId') NOT IN('null','string') THEN RAISE EXCEPTION 'Invalid item' USING ERRCODE='22023'; END IF;
  item_ids:=array_append(item_ids,item->>'id');
  FOREACH lang IN ARRAY ARRAY['zh','en'] LOOP
   part:=item->lang;
   IF jsonb_typeof(part) IS DISTINCT FROM 'object' OR NOT part ?& ARRAY['title','body','label','imageAlt'] OR (SELECT count(*) FROM jsonb_object_keys(part))<>4 THEN RAISE EXCEPTION 'Invalid item translation' USING ERRCODE='22023'; END IF;
   FOREACH field IN ARRAY ARRAY['title','body','label','imageAlt'] LOOP
    IF jsonb_typeof(part->field) IS DISTINCT FROM 'string' OR length(part->>field)>(CASE field WHEN 'title' THEN 200 WHEN 'body' THEN 2000 WHEN 'label' THEN 120 ELSE 250 END) THEN RAISE EXCEPTION 'Invalid item translation' USING ERRCODE='22023'; END IF;
   END LOOP;
   IF (lang='zh' OR (p_publish AND NOT p_fallback)) AND item->>'kind'='history' AND part->>'label'!~'^[0-9]{4}$' THEN RAISE EXCEPTION 'Invalid history year' USING ERRCODE='22023'; END IF;
   IF p_publish AND (lang='zh' OR NOT p_fallback) AND (btrim(part->>'title',whitespace)='' OR (item->>'imageId' IS NOT NULL AND btrim(part->>'imageAlt',whitespace)='')) THEN RAISE EXCEPTION 'Item translation required' USING ERRCODE='22023'; END IF;
  END LOOP;
 END LOOP;
 FOR image_id IN SELECT DISTINCT value::uuid FROM (
  SELECT p_draft->>'imageId' value UNION ALL SELECT value->>'imageId' FROM jsonb_array_elements(p_draft->'items')
 ) ids WHERE value IS NOT NULL LOOP
  PERFORM 1 FROM portal.content_images WHERE id=image_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Image unavailable' USING ERRCODE='22023'; END IF;
 END LOOP;
END $$;

CREATE FUNCTION portal_private.register_content_image(p_id uuid,p_key text,p_width integer,p_height integer,p_size integer,p_sha text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=portal_private.content_admin();
BEGIN
 INSERT INTO portal.content_images(id,object_key,width,height,size_bytes,sha256,uploaded_by) VALUES(p_id,p_key,p_width,p_height,p_size,p_sha,actor);
 INSERT INTO portal.audit_logs(actor_id,object_type,object_id,action,safe_changes,request_id) VALUES(actor,'CONTENT_IMAGE',p_id,'CONTENT_IMAGE_UPLOADED','{}',p_id);
 INSERT INTO portal.outbox_events(event_type,aggregate_id,delivery_key,safe_references) VALUES('CONTENT_IMAGE_UPLOADED',p_id,'content-image:'||p_id::text,jsonb_build_object('imageId',p_id));
 RETURN p_id;
END $$;

CREATE FUNCTION portal_private.manage_content(p_action text,p_id uuid,p_expected integer,p_request uuid,p_type text DEFAULT NULL,p_draft jsonb DEFAULT NULL,p_order integer DEFAULT NULL,p_fallback boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=portal_private.content_admin(); c portal.content_blocks%ROWTYPE; previous portal_private.content_commands%ROWTYPE; fingerprint text; result jsonb; next_version integer;
BEGIN
 IF p_action IS NULL OR p_action NOT IN('create','save','publish','unpublish') OR p_id IS NULL OR p_request IS NULL OR p_fallback IS NULL THEN RAISE EXCEPTION 'Invalid command' USING ERRCODE='22023'; END IF;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('action',p_action,'id',p_id,'version',p_expected,'type',p_type,'draft',p_draft,'order',p_order,'fallback',p_fallback)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,7606));
 SELECT * INTO previous FROM portal_private.content_commands WHERE request_id=p_request;
 IF FOUND THEN IF previous.actor_id<>actor OR previous.digest<>fingerprint THEN RAISE EXCEPTION 'Request conflict' USING ERRCODE='40001'; END IF; RETURN previous.result; END IF;
 IF p_action='create' THEN
  IF p_expected IS NOT NULL OR p_order IS NULL OR p_order NOT BETWEEN 0 AND 10000 OR p_fallback THEN RAISE EXCEPTION 'Invalid creation' USING ERRCODE='22023'; END IF;
  PERFORM portal_private.validate_content(p_type,p_draft,false,false);
  INSERT INTO portal.content_blocks(id,type,slot,sort_order,draft_content) VALUES(p_id,p_type,lower(p_type),p_order,p_draft);
  next_version:=1;
 ELSE
  SELECT * INTO c FROM portal.content_blocks WHERE id=p_id AND slot IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Content missing' USING ERRCODE='P0002'; END IF;
  IF p_expected IS NULL OR p_expected<>c.version THEN RAISE EXCEPTION 'Stale content' USING ERRCODE='40001'; END IF;
  next_version:=c.version+1;
  IF p_type IS NOT NULL THEN RAISE EXCEPTION 'Immutable type' USING ERRCODE='22023'; END IF;
  IF p_action='save' THEN
   IF p_order IS NULL OR p_order NOT BETWEEN 0 AND 10000 OR p_fallback THEN RAISE EXCEPTION 'Invalid save' USING ERRCODE='22023'; END IF;
   PERFORM portal_private.validate_content(c.type,p_draft,false,false);
   UPDATE portal.content_blocks SET draft_content=p_draft,sort_order=p_order,version=next_version WHERE id=p_id;
  ELSE
   IF p_draft IS NOT NULL OR p_order IS NOT NULL THEN RAISE EXCEPTION 'Unexpected draft' USING ERRCODE='22023'; END IF;
   IF p_action='publish' THEN
    PERFORM portal_private.validate_content(c.type,c.draft_content,true,p_fallback);
    UPDATE portal.content_blocks SET published_content=c.draft_content||jsonb_build_object('englishFallback',p_fallback),published_by=actor,published_at=statement_timestamp(),published_sort_order=c.sort_order,published_version=next_version,version=next_version WHERE id=p_id;
   ELSE
    IF p_fallback THEN RAISE EXCEPTION 'Invalid unpublish' USING ERRCODE='22023'; END IF;
    UPDATE portal.content_blocks SET published_content=NULL,published_by=NULL,published_at=NULL,published_sort_order=NULL,published_version=NULL,version=next_version WHERE id=p_id;
   END IF;
  END IF;
 END IF;
 result:=jsonb_build_object('id',p_id,'version',next_version,'action',p_action);
 INSERT INTO portal.audit_logs(actor_id,object_type,object_id,action,safe_changes,request_id) VALUES(actor,'CONTENT',p_id,'CONTENT_'||upper(p_action),result,p_request);
 INSERT INTO portal.outbox_events(event_type,aggregate_id,delivery_key,safe_references) VALUES('CONTENT_'||upper(p_action),p_id,'content:'||p_request::text,result);
 INSERT INTO portal_private.content_commands(request_id,actor_id,digest,result) VALUES(p_request,actor,fingerprint,result);
 RETURN result;
END $$;

GRANT SELECT(slot,published_sort_order,published_version) ON portal.content_blocks TO portal_public_view_owner;
GRANT SELECT ON portal.content_images TO portal_public_view_owner;
CREATE POLICY published_content_image_owner ON portal.content_images FOR SELECT TO portal_public_view_owner USING(true);
CREATE VIEW portal.company_content WITH(security_barrier=true) AS SELECT id,type,published_sort_order sort_order,published_version version,published_content,published_at FROM portal.content_blocks WHERE slot IS NOT NULL;
CREATE VIEW portal.published_content_images WITH(security_barrier=true) AS SELECT i.id,i.object_key,i.width,i.height FROM portal.content_images i
 WHERE EXISTS(SELECT 1 FROM portal.content_blocks c WHERE c.slot IS NOT NULL AND (c.published_content->>'imageId'=i.id::text OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.published_content->'items')='array' THEN c.published_content->'items' ELSE '[]'::jsonb END) item WHERE item->>'imageId'=i.id::text)));
GRANT SELECT ON portal.company_content,portal.published_content_images TO portal_public_reader;
GRANT portal_public_view_owner TO CURRENT_USER;
GRANT CREATE ON SCHEMA portal TO portal_public_view_owner;
ALTER VIEW portal.company_content OWNER TO portal_public_view_owner;
ALTER VIEW portal.published_content_images OWNER TO portal_public_view_owner;
REVOKE CREATE ON SCHEMA portal FROM portal_public_view_owner;
REVOKE portal_public_view_owner FROM CURRENT_USER;

REVOKE ALL ON FUNCTION portal_private.content_admin(),portal_private.validate_content(text,jsonb,boolean,boolean),portal_private.register_content_image(uuid,text,integer,integer,integer,text),portal_private.manage_content(text,uuid,integer,uuid,text,jsonb,integer,boolean) FROM PUBLIC;
ALTER FUNCTION portal_private.content_admin() OWNER TO portal_content_owner;
ALTER FUNCTION portal_private.validate_content(text,jsonb,boolean,boolean) OWNER TO portal_content_owner;
ALTER FUNCTION portal_private.register_content_image(uuid,text,integer,integer,integer,text) OWNER TO portal_content_owner;
ALTER FUNCTION portal_private.manage_content(text,uuid,integer,uuid,text,jsonb,integer,boolean) OWNER TO portal_content_owner;
GRANT EXECUTE ON FUNCTION portal_private.register_content_image(uuid,text,integer,integer,integer,text),portal_private.manage_content(text,uuid,integer,uuid,text,jsonb,integer,boolean) TO portal_runtime;
REVOKE CREATE ON SCHEMA portal_private FROM portal_content_owner;
REVOKE portal_content_owner FROM CURRENT_USER;
COMMIT;
