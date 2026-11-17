BEGIN;

-- Pure predicate: default EXECUTE is harmless; it reads no application data.
-- Extend this flat value allowlist deliberately when a new audit writer is added.
CREATE FUNCTION portal_private.audit_payload_is_safe(payload jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE k text; v jsonb; field jsonb;
BEGIN
  IF payload IS NULL OR jsonb_typeof(payload)<>'object' OR octet_length(payload::text)>4096 THEN RETURN false; END IF;
  FOR k,v IN SELECT * FROM jsonb_each(payload) LOOP
    IF k IN('id','jobId','applicationId','candidateId','sourceId','uploadId','imageId','operationId') THEN
      IF jsonb_typeof(v)<>'string' OR (v#>>'{}')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
    ELSIF k IN('version','applicationsMoved') THEN
      IF jsonb_typeof(v)<>'number' OR (v::text)!~'^[0-9]{1,10}$' THEN RETURN false; END IF;
      IF (v::text)::numeric>2147483647 OR (k='version' AND (v::text)::numeric<1) THEN RETURN false; END IF;
    ELSIF k IN('role','oldRole') THEN
      IF jsonb_typeof(v)<>'string' OR (v#>>'{}') NOT IN('ADMIN','HR','READ_ONLY') THEN RETURN false; END IF;
    ELSIF k IN('active','oldActive') THEN
      IF jsonb_typeof(v)<>'boolean' THEN RETURN false; END IF;
    ELSIF k='status' THEN
      IF jsonb_typeof(v)<>'string' OR (v#>>'{}') NOT IN('DRAFT','PENDING_REVIEW','PUBLISHED','PAUSED','CLOSED','NEW','SCREENING','INTERVIEW','OFFER','REJECTED') THEN RETURN false; END IF;
    ELSIF k='intakeState' THEN
      IF v<>'"CONFIRMED"'::jsonb THEN RETURN false; END IF;
    ELSIF k='action' THEN
      IF jsonb_typeof(v)<>'string' OR (v#>>'{}') NOT IN('create','save','publish','unpublish') THEN RETURN false; END IF;
    ELSIF k='reason' THEN
      IF v NOT IN('null'::jsonb,'"EXPIRED"'::jsonb) THEN RETURN false; END IF;
    ELSIF k='operation' THEN
      IF v NOT IN('"ban"'::jsonb,'"unban"'::jsonb) THEN RETURN false; END IF;
    ELSIF k='fixture' THEN
      IF v<>'"pv-local-v1"'::jsonb THEN RETURN false; END IF;
    ELSIF k='fields' THEN
      IF jsonb_typeof(v)<>'array' THEN RETURN false; END IF;
      IF jsonb_array_length(v)>20 THEN RETURN false; END IF;
      FOR field IN SELECT value FROM jsonb_array_elements(v) LOOP
        IF jsonb_typeof(field)<>'string' OR (field#>>'{}') NOT IN('code','name_en','name_zh','active','sort_order','address_en','address_zh','country_code','timezone','state','assigned_to') THEN RETURN false; END IF;
      END LOOP;
    ELSE RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END $$;

-- Enforce new writes immediately, without rewriting or trusting historic JSON.
-- Inspect legacy invalid counts, then VALIDATE CONSTRAINT after operator review.
ALTER TABLE portal.audit_logs
  ADD CONSTRAINT audit_logs_safe_payload CHECK(portal_private.audit_payload_is_safe(safe_changes)) NOT VALID,
  ADD CONSTRAINT audit_logs_codes CHECK(object_type ~ '^[A-Z][A-Z0-9_]{0,63}$' AND action ~ '^[A-Z][A-Z0-9_]{0,63}$') NOT VALID;
CREATE INDEX audit_logs_recent_idx ON portal.audit_logs(created_at DESC,id DESC);
CREATE INDEX audit_logs_request_idx ON portal.audit_logs(request_id,created_at DESC,id DESC);

CREATE ROLE portal_audit_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT portal_audit_owner TO CURRENT_USER;
GRANT USAGE ON SCHEMA portal,portal_private TO portal_audit_owner;
GRANT CREATE ON SCHEMA portal_private TO portal_audit_owner;
GRANT SELECT(id,active) ON portal.staff_profiles TO portal_audit_owner;
GRANT INSERT ON portal.audit_logs,portal.outbox_events TO portal_audit_owner;
CREATE POLICY audit_writer_staff ON portal.staff_profiles FOR SELECT TO portal_audit_owner USING(true);
CREATE POLICY audit_writer_log ON portal.audit_logs FOR INSERT TO portal_audit_owner WITH CHECK(true);
CREATE POLICY audit_writer_outbox ON portal.outbox_events FOR INSERT TO portal_audit_owner WITH CHECK(true);

CREATE FUNCTION portal_private.audit_maintenance_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
  previous jsonb; current_row jsonb; keys text[]; fields text[]:=ARRAY[]::text[];
  field text; target uuid; kind text; event_name text; request uuid:=gen_random_uuid(); safe jsonb;
BEGIN
  -- Operator initialization uses its explicit seed audit; do not attribute it to staff.
  IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM portal.staff_profiles WHERE id=actor AND active) THEN RETURN NULL; END IF;
  IF TG_TABLE_SCHEMA<>'portal' THEN RAISE EXCEPTION 'Invalid audit trigger' USING ERRCODE='22023'; END IF;
  IF TG_TABLE_NAME='departments' THEN kind:='DEPARTMENT'; keys:=ARRAY['code','name_en','name_zh','active','sort_order'];
  ELSIF TG_TABLE_NAME='locations' THEN kind:='LOCATION'; keys:=ARRAY['code','name_en','name_zh','address_en','address_zh','country_code','timezone','active','sort_order'];
  ELSIF TG_TABLE_NAME='contact_messages' THEN kind:='CONTACT_MESSAGE'; keys:=ARRAY['state','assigned_to'];
  ELSE RAISE EXCEPTION 'Invalid audit trigger' USING ERRCODE='22023'; END IF;
  IF TG_OP<>'INSERT' THEN previous:=to_jsonb(OLD); END IF;
  IF TG_OP<>'DELETE' THEN current_row:=to_jsonb(NEW); END IF;
  FOREACH field IN ARRAY keys LOOP
    IF previous->field IS DISTINCT FROM current_row->field THEN fields:=array_append(fields,field); END IF;
  END LOOP;
  IF TG_OP='UPDATE' AND cardinality(fields)=0 THEN RETURN NULL; END IF;
  target:=coalesce((current_row->>'id')::uuid,(previous->>'id')::uuid);
  event_name:=kind||CASE TG_OP WHEN 'INSERT' THEN '_CREATED' WHEN 'DELETE' THEN '_DELETED' ELSE '_UPDATED' END;
  safe:=jsonb_build_object('fields',fields);
  INSERT INTO portal.audit_logs(actor_id,object_type,object_id,action,safe_changes,request_id)
    VALUES(actor,kind,target,event_name,safe,request);
  INSERT INTO portal.outbox_events(event_type,aggregate_id,delivery_key,safe_references)
    VALUES(event_name,target,'audit:'||request::text,jsonb_build_object('id',target));
  RETURN NULL;
END $$;
ALTER FUNCTION portal_private.audit_maintenance_change() OWNER TO portal_audit_owner;
REVOKE ALL ON FUNCTION portal_private.audit_maintenance_change() FROM PUBLIC;
CREATE TRIGGER departments_audit AFTER INSERT OR UPDATE OR DELETE ON portal.departments FOR EACH ROW EXECUTE FUNCTION portal_private.audit_maintenance_change();
CREATE TRIGGER locations_audit AFTER INSERT OR UPDATE OR DELETE ON portal.locations FOR EACH ROW EXECUTE FUNCTION portal_private.audit_maintenance_change();
CREATE TRIGGER contact_messages_audit AFTER INSERT OR UPDATE OR DELETE ON portal.contact_messages FOR EACH ROW EXECUTE FUNCTION portal_private.audit_maintenance_change();

CREATE FUNCTION portal_private.audit_provider_completion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; safe jsonb;
BEGIN
  IF actor IS NULL OR OLD.completed_at IS NOT NULL OR NEW.completed_at IS NULL
    OR NOT EXISTS(SELECT 1 FROM portal.staff_profiles WHERE id=actor AND active) THEN RETURN NULL; END IF;
  safe:=jsonb_build_object('operationId',NEW.id,'operation',NEW.operation);
  INSERT INTO portal.audit_logs(actor_id,object_type,object_id,action,safe_changes,request_id)
    VALUES(actor,'STAFF_PROFILE',NEW.profile_id,'STAFF_PROVIDER_SYNCED',safe,NEW.id);
  INSERT INTO portal.outbox_events(event_type,aggregate_id,delivery_key,safe_references)
    VALUES('STAFF_PROVIDER_SYNCED',NEW.profile_id,'staff-sync:'||NEW.id::text,jsonb_build_object('id',NEW.profile_id,'operationId',NEW.id));
  RETURN NULL;
END $$;
ALTER FUNCTION portal_private.audit_provider_completion() OWNER TO portal_audit_owner;
REVOKE ALL ON FUNCTION portal_private.audit_provider_completion() FROM PUBLIC;
CREATE TRIGGER staff_provider_audit AFTER UPDATE OF completed_at ON portal_private.staff_provider_operations FOR EACH ROW EXECUTE FUNCTION portal_private.audit_provider_completion();
REVOKE CREATE ON SCHEMA portal_private FROM portal_audit_owner;
REVOKE portal_audit_owner FROM CURRENT_USER;
COMMIT;
