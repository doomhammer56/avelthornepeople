BEGIN;

DO $$ BEGIN EXECUTE format('GRANT portal_recruitment_owner TO %I', current_user); END $$;
GRANT CREATE ON SCHEMA portal_private TO portal_recruitment_owner;

-- Public contact intake: encrypt at the app boundary, then insert through this
-- SECURITY DEFINER path so portal_runtime never needs a direct INSERT grant.
CREATE FUNCTION portal_private.receive_contact_message(
  p_id uuid,
  p_sender bytea,
  p_body bytea,
  p_locale text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_id IS NULL
    OR p_sender IS NULL OR octet_length(p_sender) < 1
    OR p_body IS NULL OR octet_length(p_body) < 1
    OR p_locale IS NULL OR p_locale NOT IN ('en', 'zh')
  THEN
    RAISE EXCEPTION 'Invalid contact message' USING ERRCODE = '22023';
  END IF;

  INSERT INTO portal.contact_messages (
    id,
    sender_encrypted,
    body_encrypted,
    locale,
    state
  ) VALUES (
    p_id,
    p_sender,
    p_body,
    p_locale,
    'NEW'
  );
END;
$$;

ALTER FUNCTION portal_private.receive_contact_message(uuid, bytea, bytea, text)
  OWNER TO portal_recruitment_owner;
REVOKE ALL ON FUNCTION portal_private.receive_contact_message(uuid, bytea, bytea, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_private.receive_contact_message(uuid, bytea, bytea, text)
  TO portal_runtime;

REVOKE CREATE ON SCHEMA portal_private FROM portal_recruitment_owner;
DO $$ BEGIN EXECUTE format('REVOKE portal_recruitment_owner FROM %I', current_user); END $$;

COMMIT;
