BEGIN;
-- Represent pre-BE-03 settings in their draft/approved snapshots. This changes
-- neither the public fields nor lifecycle/version: it preserves existing values
-- when an older posting is edited or duplicated through the new command API.
WITH legacy AS (
  SELECT j.id,jsonb_build_object(
    'departmentId',j.department_id,
    'locationIds',ARRAY(SELECT jl.location_id::text FROM portal.job_locations jl WHERE jl.job_id=j.id ORDER BY jl.location_id),
    'jobType',coalesce(j.job_type,'FULL_TIME'),'experience',coalesce(j.experience,'ANY'),
    'salary',CASE WHEN j.salary_min IS NOT NULL AND j.salary_max IS NOT NULL THEN
      jsonb_build_object('min',j.salary_min,'max',j.salary_max,'currency',j.salary_currency,'period',j.salary_period) ELSE 'null'::jsonb END,
    'showSalary',j.show_salary,'publishAt',j.publish_at,'closeAt',j.close_at
  ) AS settings FROM portal.jobs j
  WHERE NOT (j.draft_content ? 'settings') OR (j.published_content IS NOT NULL AND NOT (j.published_content ? 'settings'))
)
UPDATE portal.jobs j SET
  draft_content=CASE WHEN j.draft_content ? 'settings' THEN j.draft_content ELSE j.draft_content || jsonb_build_object('settings',l.settings) END,
  published_content=CASE WHEN j.published_content IS NULL OR j.published_content ? 'settings' THEN j.published_content ELSE j.published_content || jsonb_build_object('settings',l.settings) END
FROM legacy l WHERE j.id=l.id;
COMMIT;
