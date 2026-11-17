BEGIN;

-- The privacy definer calls this legacy recruitment-owned function. Grant as
-- its actual owner: the deployment login need not inherit that owner's rights.
GRANT portal_recruitment_owner TO CURRENT_USER;
SET LOCAL ROLE portal_recruitment_owner;
GRANT EXECUTE ON FUNCTION portal_private.candidate_group_blocked(uuid)
  TO portal_privacy_owner;
RESET ROLE;
REVOKE portal_recruitment_owner FROM CURRENT_USER;

COMMIT;
