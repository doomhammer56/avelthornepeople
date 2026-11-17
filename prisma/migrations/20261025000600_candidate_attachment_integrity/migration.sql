BEGIN;
-- Preserve the existing FK error for orphan IDs; only known candidates can be
-- canonicalized or checked for deletion restrictions.
CREATE OR REPLACE FUNCTION portal_private.canonical_application_candidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE canonical uuid;
BEGIN
  IF NEW.candidate_id IS NOT NULL THEN
    SELECT coalesce(merged_into_id,id) INTO canonical FROM portal.candidates WHERE id=NEW.candidate_id;
    IF FOUND THEN
      IF portal_private.candidate_group_blocked(NEW.candidate_id) THEN RAISE EXCEPTION 'Candidate unavailable' USING ERRCODE='55000'; END IF;
      NEW.candidate_id:=canonical;
    END IF;
  END IF;
  RETURN NEW;
END $$;
COMMIT;
