BEGIN;
-- Existing operator-owned CV/attachment SECURITY DEFINER functions must call
-- the restricted owner's group check after deployment commits. No application
-- login receives ownership, table writes or membership in the command owner.
GRANT portal_recruitment_owner TO CURRENT_USER;
GRANT EXECUTE ON FUNCTION portal_private.candidate_group_blocked(uuid) TO CURRENT_USER;
REVOKE portal_recruitment_owner FROM CURRENT_USER;
COMMIT;
