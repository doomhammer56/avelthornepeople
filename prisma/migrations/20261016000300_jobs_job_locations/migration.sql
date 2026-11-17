BEGIN;

CREATE TABLE portal.jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_slug text NOT NULL,
    status text NOT NULL DEFAULT 'DRAFT',
    draft_content jsonb NOT NULL,
    published_content jsonb,
    version integer NOT NULL DEFAULT 1,
    published_version integer,
    department_id uuid,
    job_type text,
    experience text,
    salary_min numeric(14, 2),
    salary_max numeric(14, 2),
    salary_currency text,
    salary_period text,
    show_salary boolean NOT NULL DEFAULT false,
    owner_id uuid NOT NULL,
    approved_by uuid,
    approved_at timestamptz(6),
    publish_at timestamptz(6),
    close_at timestamptz(6),
    first_published_at timestamptz(6),
    created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT jobs_slug_check CHECK (btrim(canonical_slug) <> ''),
    CONSTRAINT jobs_status_check CHECK (status IN ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'PAUSED', 'CLOSED')),
    CONSTRAINT jobs_draft_content_check CHECK (jsonb_typeof(draft_content) = 'object'),
    CONSTRAINT jobs_published_content_check CHECK (jsonb_typeof(published_content) = 'object'),
    CONSTRAINT jobs_version_check CHECK (version > 0),
    CONSTRAINT jobs_published_version_check CHECK (published_version > 0 AND published_version <= version),
    CONSTRAINT jobs_job_type_check CHECK (btrim(job_type) <> ''),
    CONSTRAINT jobs_experience_check CHECK (btrim(experience) <> ''),
    CONSTRAINT jobs_salary_min_check CHECK (salary_min >= 0 AND salary_min <> 'NaN'::numeric),
    CONSTRAINT jobs_salary_max_check CHECK (salary_max >= 0 AND salary_max <> 'NaN'::numeric),
    CONSTRAINT jobs_salary_currency_check CHECK (salary_currency ~ '^[A-Z]{3}$'),
    CONSTRAINT jobs_salary_period_check CHECK (salary_period IN ('HOUR', 'DAY', 'MONTH', 'YEAR')),
    CONSTRAINT jobs_salary_range_check CHECK (salary_min IS NULL OR salary_max IS NULL OR salary_min <= salary_max),
    CONSTRAINT jobs_salary_units_check CHECK (
        (salary_min IS NULL AND salary_max IS NULL) OR
        (salary_currency IS NOT NULL AND salary_period IS NOT NULL)
    ),
    CONSTRAINT jobs_salary_visibility_check CHECK (NOT show_salary OR (salary_min IS NOT NULL AND salary_max IS NOT NULL)),
    CONSTRAINT jobs_schedule_check CHECK (close_at IS NULL OR publish_at IS NULL OR close_at > publish_at),
    CONSTRAINT jobs_approval_snapshot_check CHECK (
        (published_content IS NULL AND published_version IS NULL AND approved_by IS NULL AND approved_at IS NULL) OR
        (published_content IS NOT NULL AND published_version IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    ),
    CONSTRAINT jobs_publication_check CHECK (status <> 'PUBLISHED' OR (
        published_content IS NOT NULL AND published_version IS NOT NULL
        AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND publish_at IS NOT NULL
        AND department_id IS NOT NULL AND job_type IS NOT NULL AND experience IS NOT NULL
    )),
    CONSTRAINT jobs_department_id_fkey FOREIGN KEY (department_id) REFERENCES portal.departments(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT jobs_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES portal.staff_profiles(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT jobs_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES portal.staff_profiles(id) ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE TABLE portal.job_locations (
    job_id uuid NOT NULL,
    location_id uuid NOT NULL,
    PRIMARY KEY (job_id, location_id),
    CONSTRAINT job_locations_job_id_fkey FOREIGN KEY (job_id) REFERENCES portal.jobs(id) ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT job_locations_location_id_fkey FOREIGN KEY (location_id) REFERENCES portal.locations(id) ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX jobs_canonical_slug_key ON portal.jobs(canonical_slug);
CREATE INDEX jobs_publish_idx ON portal.jobs(status, publish_at);
CREATE INDEX jobs_close_idx ON portal.jobs(status, close_at);
CREATE INDEX jobs_filters_idx ON portal.jobs(department_id, job_type, experience);
CREATE INDEX jobs_owner_idx ON portal.jobs(owner_id);
CREATE INDEX jobs_approver_idx ON portal.jobs(approved_by);
CREATE INDEX job_locations_location_idx ON portal.job_locations(location_id, job_id);

CREATE TRIGGER touch_updated_at
BEFORE UPDATE ON portal.jobs
FOR EACH ROW EXECUTE FUNCTION portal.touch_updated_at();

ALTER TABLE portal.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.job_locations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE portal.jobs, portal.job_locations FROM PUBLIC;

DO $$
DECLARE target_role text;
BEGIN
    FOREACH target_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
    LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = target_role) THEN
            EXECUTE format('REVOKE ALL ON TABLE portal.jobs, portal.job_locations FROM %I', target_role);
        END IF;
    END LOOP;
END;
$$;

COMMIT;
