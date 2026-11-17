BEGIN;

-- No provider/browser role inherits these capabilities. Dedicated server logins
-- are provisioned separately; never grant these roles to anon/authenticated.
CREATE ROLE portal_public_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE portal_public_view_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE portal_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

CREATE SCHEMA portal_private;
REVOKE ALL ON SCHEMA portal_private FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA portal_private REVOKE ALL ON FUNCTIONS FROM PUBLIC;

-- The migration owner can read profiles without recursively invoking their RLS.
-- No caller-provided role/UUID or editable JWT metadata is used as authority.
CREATE FUNCTION portal_private.current_staff_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT p.role FROM portal.staff_profiles AS p
    WHERE p.id = (SELECT auth.uid()) AND p.active
$$;
REVOKE ALL ON FUNCTION portal_private.current_staff_role() FROM PUBLIC;
GRANT USAGE ON SCHEMA portal_private TO portal_runtime;
GRANT EXECUTE ON FUNCTION portal_private.current_staff_role() TO portal_runtime;
GRANT USAGE ON SCHEMA portal TO portal_public_reader, portal_public_view_owner, portal_runtime;
GRANT USAGE ON SCHEMA auth TO portal_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO portal_runtime;

-- Only the view owner can read these columns directly. Its RLS policies apply
-- when a public view runs; it owns no base table and cannot bypass RLS.
GRANT SELECT (id, canonical_slug, status, published_content, published_version,
    approved_at, publish_at, close_at, department_id, job_type, experience,
    show_salary, salary_min, salary_max, salary_currency, salary_period)
    ON portal.jobs TO portal_public_view_owner;
GRANT SELECT (id, code, name_zh, name_en, active) ON portal.departments TO portal_public_view_owner;
GRANT SELECT (id, code, name_zh, name_en, address_zh, address_en, country_code, timezone, active)
    ON portal.locations TO portal_public_view_owner;
GRANT SELECT (job_id, location_id) ON portal.job_locations TO portal_public_view_owner;
GRANT SELECT (id, type, sort_order, published_content, published_at)
    ON portal.content_blocks TO portal_public_view_owner;

CREATE POLICY public_visible_jobs ON portal.jobs FOR SELECT TO portal_public_view_owner
USING (
    status = 'PUBLISHED' AND published_content IS NOT NULL
    AND approved_at IS NOT NULL AND published_version IS NOT NULL
    AND publish_at <= statement_timestamp()
    AND (close_at IS NULL OR close_at > statement_timestamp())
);
CREATE POLICY public_active_departments ON portal.departments FOR SELECT TO portal_public_view_owner
USING (active);
CREATE POLICY public_active_locations ON portal.locations FOR SELECT TO portal_public_view_owner
USING (active);
CREATE POLICY public_visible_job_locations ON portal.job_locations FOR SELECT TO portal_public_view_owner
USING (
    EXISTS (SELECT 1 FROM portal.jobs AS j WHERE j.id = job_id)
    AND EXISTS (SELECT 1 FROM portal.locations AS l WHERE l.id = location_id)
);
CREATE POLICY public_published_content ON portal.content_blocks FOR SELECT TO portal_public_view_owner
USING (published_content IS NOT NULL AND published_at <= statement_timestamp());

CREATE VIEW portal.visible_jobs WITH (security_barrier = true) AS
SELECT id, canonical_slug, department_id, job_type, experience,
       published_content, publish_at, close_at, show_salary,
       CASE WHEN show_salary THEN salary_min END AS salary_min,
       CASE WHEN show_salary THEN salary_max END AS salary_max,
       CASE WHEN show_salary THEN salary_currency END AS salary_currency,
       CASE WHEN show_salary THEN salary_period END AS salary_period
FROM portal.jobs;
CREATE VIEW portal.published_content WITH (security_barrier = true) AS
SELECT id, type, sort_order, published_content FROM portal.content_blocks;
CREATE VIEW portal.public_departments WITH (security_barrier = true) AS
SELECT id, code, name_zh, name_en FROM portal.departments;
CREATE VIEW portal.public_locations WITH (security_barrier = true) AS
SELECT id, code, name_zh, name_en, address_zh, address_en, country_code, timezone
FROM portal.locations;
CREATE VIEW portal.visible_job_locations WITH (security_barrier = true) AS
SELECT job_id, location_id FROM portal.job_locations;

-- Ownership transfer needs temporary CREATE and migration-owner membership.
-- Retain only the latter for future view maintenance; no runtime/provider login
-- receives this membership. Migration credentials must stay out of the app.
GRANT portal_public_view_owner TO CURRENT_USER;
GRANT CREATE ON SCHEMA portal TO portal_public_view_owner;
ALTER VIEW portal.visible_jobs OWNER TO portal_public_view_owner;
ALTER VIEW portal.published_content OWNER TO portal_public_view_owner;
ALTER VIEW portal.public_departments OWNER TO portal_public_view_owner;
ALTER VIEW portal.public_locations OWNER TO portal_public_view_owner;
ALTER VIEW portal.visible_job_locations OWNER TO portal_public_view_owner;
REVOKE CREATE ON SCHEMA portal FROM portal_public_view_owner;
GRANT SELECT ON portal.visible_jobs, portal.published_content, portal.public_departments,
    portal.public_locations, portal.visible_job_locations TO portal_public_reader;

-- Generic authenticated/provider roles retain the DB-01 default-deny boundary.
-- These grants are for a dedicated server runtime with a verified local subject.
GRANT SELECT ON portal.staff_profiles, portal.departments, portal.locations, portal.jobs,
    portal.job_locations, portal.content_blocks, portal.daily_metrics, portal.candidates,
    portal.applications, portal.uploads, portal.contact_messages, portal.audit_logs,
    portal.deletion_requests TO portal_runtime;

DO $$
DECLARE target_table text;
BEGIN
    FOREACH target_table IN ARRAY ARRAY['departments', 'locations', 'jobs', 'job_locations', 'content_blocks', 'daily_metrics']
    LOOP
        EXECUTE format(
            'CREATE POLICY staff_inspection ON portal.%I FOR SELECT TO portal_runtime '
            'USING ((SELECT portal_private.current_staff_role()) IN (''ADMIN'', ''HR'', ''READ_ONLY''))',
            target_table
        );
    END LOOP;
END;
$$;

CREATE POLICY staff_own_profile ON portal.staff_profiles FOR SELECT TO portal_runtime
USING (
    (SELECT portal_private.current_staff_role()) = 'ADMIN'
    OR (id = (SELECT auth.uid()) AND (SELECT portal_private.current_staff_role()) IS NOT NULL)
);
CREATE POLICY recruiting_candidates ON portal.candidates FOR SELECT TO portal_runtime
USING ((SELECT portal_private.current_staff_role()) IN ('ADMIN', 'HR'));
CREATE POLICY recruiting_applications ON portal.applications FOR SELECT TO portal_runtime
USING (intake_state = 'CONFIRMED' AND (SELECT portal_private.current_staff_role()) IN ('ADMIN', 'HR'));
CREATE POLICY recruiting_clean_uploads ON portal.uploads FOR SELECT TO portal_runtime
USING (
    scan_state = 'CLEAN' AND (SELECT portal_private.current_staff_role()) IN ('ADMIN', 'HR')
    AND EXISTS (SELECT 1 FROM portal.applications AS a WHERE a.cv_upload_id = uploads.id)
);
CREATE POLICY recruiting_messages ON portal.contact_messages FOR SELECT TO portal_runtime
USING ((SELECT portal_private.current_staff_role()) IN ('ADMIN', 'HR'));
CREATE POLICY admin_audit ON portal.audit_logs FOR SELECT TO portal_runtime
USING ((SELECT portal_private.current_staff_role()) = 'ADMIN');
CREATE POLICY admin_deletion_requests ON portal.deletion_requests FOR SELECT TO portal_runtime
USING ((SELECT portal_private.current_staff_role()) = 'ADMIN');

-- No direct publication, approval, account administration, audit/queue mutation,
-- intake/scan transition or destructive cleanup capability is granted here.
GRANT INSERT (id, canonical_slug, draft_content, owner_id) ON portal.jobs TO portal_runtime;
GRANT UPDATE (draft_content, version) ON portal.jobs TO portal_runtime;
CREATE POLICY recruiting_create_draft ON portal.jobs FOR INSERT TO portal_runtime
WITH CHECK (
    (SELECT portal_private.current_staff_role()) IN ('ADMIN', 'HR')
    AND owner_id = (SELECT auth.uid()) AND status = 'DRAFT'
    AND published_content IS NULL AND approved_by IS NULL
);
CREATE POLICY recruiting_edit_draft ON portal.jobs FOR UPDATE TO portal_runtime
USING ((SELECT portal_private.current_staff_role()) IN ('ADMIN', 'HR') AND status <> 'CLOSED')
WITH CHECK ((SELECT portal_private.current_staff_role()) IN ('ADMIN', 'HR') AND status <> 'CLOSED');

GRANT UPDATE (status, version) ON portal.applications TO portal_runtime;
CREATE POLICY recruiting_application_status ON portal.applications FOR UPDATE TO portal_runtime
USING (intake_state = 'CONFIRMED' AND (SELECT portal_private.current_staff_role()) IN ('ADMIN', 'HR'))
WITH CHECK (intake_state = 'CONFIRMED' AND (SELECT portal_private.current_staff_role()) IN ('ADMIN', 'HR'));
GRANT UPDATE (state, assigned_to) ON portal.contact_messages TO portal_runtime;
CREATE POLICY recruiting_triage_message ON portal.contact_messages FOR UPDATE TO portal_runtime
USING ((SELECT portal_private.current_staff_role()) IN ('ADMIN', 'HR'))
WITH CHECK ((SELECT portal_private.current_staff_role()) IN ('ADMIN', 'HR'));

GRANT INSERT (id, code, name_zh, name_en, active) ON portal.departments TO portal_runtime;
GRANT UPDATE (code, name_zh, name_en, active) ON portal.departments TO portal_runtime;
GRANT INSERT (id, code, name_zh, name_en, address_zh, address_en, country_code, timezone, active)
    ON portal.locations TO portal_runtime;
GRANT UPDATE (code, name_zh, name_en, address_zh, address_en, country_code, timezone, active)
    ON portal.locations TO portal_runtime;
GRANT INSERT (id, type, sort_order, draft_content) ON portal.content_blocks TO portal_runtime;
GRANT UPDATE (type, sort_order, draft_content, version) ON portal.content_blocks TO portal_runtime;
DO $$
DECLARE target_table text;
BEGIN
    FOREACH target_table IN ARRAY ARRAY['departments', 'locations', 'content_blocks']
    LOOP
        EXECUTE format(
            'CREATE POLICY admin_create ON portal.%I FOR INSERT TO portal_runtime '
            'WITH CHECK ((SELECT portal_private.current_staff_role()) = ''ADMIN'')', target_table
        );
        EXECUTE format(
            'CREATE POLICY admin_edit ON portal.%I FOR UPDATE TO portal_runtime '
            'USING ((SELECT portal_private.current_staff_role()) = ''ADMIN'') '
            'WITH CHECK ((SELECT portal_private.current_staff_role()) = ''ADMIN'')', target_table
        );
    END LOOP;
END;
$$;

COMMIT;
