BEGIN;

-- The contact intake SECURITY DEFINER function runs as portal_recruitment_owner.
-- Grant table write + an owner policy so inserts are not blocked by RLS.
GRANT INSERT ON portal.contact_messages TO portal_recruitment_owner;
CREATE POLICY contact_intake_owner ON portal.contact_messages
  FOR INSERT TO portal_recruitment_owner
  WITH CHECK (true);

COMMIT;
