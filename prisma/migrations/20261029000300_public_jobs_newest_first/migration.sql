BEGIN;

-- Keep the existing public-view owner and RLS boundary. Creation time is used
-- only for ordering; public API responses continue to expose the posting date.
GRANT portal_public_view_owner TO CURRENT_USER;
GRANT SELECT (created_at) ON portal.jobs TO portal_public_view_owner;
GRANT CREATE ON SCHEMA portal TO portal_public_view_owner;

CREATE OR REPLACE VIEW portal.visible_jobs WITH (security_barrier = true) AS
SELECT id, canonical_slug, department_id, job_type, experience,
       published_content, publish_at, close_at, show_salary,
       CASE WHEN show_salary THEN salary_min END AS salary_min,
       CASE WHEN show_salary THEN salary_max END AS salary_max,
       CASE WHEN show_salary THEN salary_currency END AS salary_currency,
       CASE WHEN show_salary THEN salary_period END AS salary_period,
       created_at
FROM portal.jobs;

REVOKE CREATE ON SCHEMA portal FROM portal_public_view_owner;
COMMIT;
