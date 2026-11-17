BEGIN;
DO $$ BEGIN EXECUTE format('GRANT portal_recruitment_owner TO %I',current_user); END $$;

-- Ordinary intake and stage changes share the identity gate. Merges, identity
-- updates/deletes and deletion requests retain the exclusive gate, before rows
-- are locked, so aliases/deletion visibility cannot change underneath intake.
CREATE OR REPLACE FUNCTION portal_private.lock_candidate_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='INSERT' AND TG_TABLE_NAME IN('candidates','applications') THEN
    PERFORM pg_advisory_xact_lock_shared(72705,1);
  ELSE
    PERFORM pg_advisory_xact_lock(72705,1);
  END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION portal_private.lock_candidate_insert_contacts() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE lock_key bigint;
BEGIN
  -- Same namespace/order as accept_application, also covering trusted direct
  -- inserts. Hash collisions merely serialize unrelated contacts; never expose
  -- contact values or grant this helper as a caller capability.
  FOR lock_key IN
    SELECT DISTINCT hashtextextended('intake-contact:'||field||':'||NEW.hmac_key_version::text||':'||encode(value,'hex'),72705)
    FROM (VALUES ('email',NEW.email_hmac),('phone',NEW.phone_hmac)) k(field,value)
    WHERE value IS NOT NULL ORDER BY 1
  LOOP PERFORM pg_advisory_xact_lock(lock_key); END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION portal_private.lock_candidate_insert_contacts() FROM PUBLIC;
CREATE TRIGGER candidate_insert_contacts BEFORE INSERT ON portal.candidates
FOR EACH ROW EXECUTE FUNCTION portal_private.lock_candidate_insert_contacts();

-- Keep the applied functions' full validation, owners, grants and command
-- behavior. Fail deployment if the expected lock point has changed; never
-- silently replace a different function version or edit an applied migration.
DO $$
DECLARE definition text; old_lock text:='PERFORM pg_advisory_xact_lock(72705,1);';
BEGIN
  definition:=pg_get_functiondef('portal_private.manage_recruitment(text,uuid,integer,uuid,text,uuid,integer)'::regprocedure);
  IF (length(definition)-length(replace(definition,old_lock,'')))/length(old_lock)<>1 THEN
    RAISE EXCEPTION 'Unexpected recruitment lock definition';
  END IF;
  definition:=replace(definition,old_lock,$replacement$
    IF p_kind='stage' THEN PERFORM pg_advisory_xact_lock_shared(72705,1);
    ELSE PERFORM pg_advisory_xact_lock(72705,1); END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('recruitment-request:'||p_request::text,72705));
  $replacement$);
  EXECUTE definition;

  SELECT pg_get_functiondef(p.oid) INTO STRICT definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='portal_private' AND p.proname='accept_application';
  IF (length(definition)-length(replace(definition,old_lock,'')))/length(old_lock)<>1 THEN
    RAISE EXCEPTION 'Unexpected intake lock definition';
  END IF;
  definition:=replace(definition,old_lock,$replacement$
    PERFORM pg_advisory_xact_lock_shared(72705,1);
    PERFORM pg_advisory_xact_lock(hashtextextended('intake-request:'||p_job::text||':'||p_request::text,72705));
    -- Lock all active HMAC versions, not just the version used for insertion.
    -- Deployments must retain the established shared keyring across instances.
    PERFORM pg_advisory_xact_lock(locks.lock_key) FROM (
      SELECT DISTINCT hashtextextended('intake-contact:'||k.field||':'||k.version::text||':'||lower(k.hash),72705) lock_key
      FROM jsonb_to_recordset(p_keys) k(version integer,field text,hash text)
      ORDER BY 1
    ) locks;
  $replacement$);
  EXECUTE definition;
END $$;
DO $$ BEGIN EXECUTE format('REVOKE portal_recruitment_owner FROM %I',current_user); END $$;
COMMIT;
