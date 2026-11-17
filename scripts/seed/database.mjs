import { randomUUID } from "node:crypto";
import { jobDraftSchema } from "../../src/server/jobs/management-contract.ts";
import { seedCompanyContent } from "../content/seed-data.mjs";
import { departments, locations, vacancies } from "./data.mjs";
import {
  employmentTypes,
  experienceLabels,
} from "../../src/lib/jobOptionDefaults.ts";

export const businessTables = [
  "applications",
  "audit_logs",
  "candidates",
  "contact_messages",
  "content_blocks",
  "content_images",
  "daily_metrics",
  "deletion_requests",
  "departments",
  "job_imports",
  "job_locations",
  "job_options",
  "jobs",
  "locations",
  "outbox_events",
  "uploads",
];

export function vacancyDraft(vacancy, departmentId, locationId, now) {
  const [min, max, currency, period] = vacancy.salary;
  const draft = jobDraftSchema.parse({
    en: vacancy.en,
    zh: vacancy.zh,
    settings: {
      departmentId,
      locationIds: [locationId],
      jobType: vacancy.jobType ?? "FULL_TIME",
      experience: vacancy.experience,
      salary: { min, max, currency, period },
      showSalary: true,
      publishAt: new Date(now.getTime() - 60000).toISOString(),
      closeAt: new Date(
        now.getTime() + vacancy.closingDays * 86400000,
      ).toISOString(),
    },
  });
  for (const lang of ["en", "zh"])
    if (
      !draft[lang].title ||
      !draft[lang].responsibilities.length ||
      !draft[lang].requirements.length
    )
      throw new Error("Incomplete vacancy translation");
  return draft;
}

export async function resetBusinessData(db, keepStaffIds) {
  const actual = (
    await db.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='portal' ORDER BY tablename",
    )
  ).rows.map((r) => r.tablename);
  const expected = [...businessTables, "staff_profiles"].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      "Unknown portal tables: review the reset allowlist before proceeding.",
    );
  await db.query("SELECT id FROM portal.staff_profiles ORDER BY id FOR UPDATE");
  await db.query(
    `LOCK TABLE ${businessTables.map((name) => `portal.${name}`).join(", ")} IN ACCESS EXCLUSIVE MODE`,
  );
  // Attached objects require the existing Storage lifecycle, not blind DB deletion.
  const files = (
    await db.query(
      "SELECT (SELECT count(*) FROM portal.uploads)+(SELECT count(*) FROM portal.content_images) AS n",
    )
  ).rows[0];
  if (Number(files.n))
    throw new Error(
      "Reset refused: remove attached CV/content files through Storage cleanup first. No database changes committed.",
    );
  const removed = (
    await db.query(
      "SELECT id FROM portal.staff_profiles WHERE role<>'ADMIN' AND NOT(id=ANY($1::uuid[])) ORDER BY id",
      [keepStaffIds],
    )
  ).rows.map((r) => r.id);
  // An explicit list, without CASCADE, keeps schema, RLS, migrations and Auth intact.
  await db.query(
    `TRUNCATE TABLE ${businessTables.map((name) => `portal.${name}`).join(", ")} RESTRICT`,
  );
  for (const table of [
    "content_commands",
    "recruitment_commands",
    "team_commands",
    "metric_traffic",
    "reference_commands",
    "intake_traffic",
  ])
    await db.query(`DELETE FROM portal_private.${table}`);
  await db.query(
    "DELETE FROM portal_private.staff_invitation_requests WHERE actor_id=ANY($1::uuid[]) OR profile_id=ANY($1::uuid[])",
    [removed],
  );
  for (const [table, column] of [
    ["staff_provider_operations", "profile_id"],
    ["staff_session_cutoffs", "profile_id"],
    ["staff_session_admissions", "subject_id"],
    ["password_grants", "subject_id"],
  ])
    await db.query(
      `DELETE FROM portal_private.${table} WHERE ${column}=ANY($1::uuid[])`,
      [removed],
    );
  await db.query(
    "DELETE FROM portal.staff_profiles WHERE id=ANY($1::uuid[]) AND role<>'ADMIN'",
    [removed],
  );
  await db.query(
    "UPDATE portal_private.analytics_state SET started_at=statement_timestamp() WHERE singleton AND started_at IS NOT NULL",
  );
  return removed;
}

export async function seedVacancies(db, adminId) {
  for (const [kind, options] of [
    ["jobType", employmentTypes],
    ["experience", experienceLabels],
  ])
    for (const [code, label] of Object.entries(options))
      await db.query(
        "INSERT INTO portal.job_options(kind,code,name_en,name_zh) VALUES($1,$2,$3,$4) ON CONFLICT(kind,code) DO NOTHING",
        [kind, code, label.en, label.zh],
      );
  const admin = (
    await db.query(
      "SELECT id FROM portal.staff_profiles WHERE id=$1 AND role='ADMIN' AND active FOR SHARE",
      [adminId],
    )
  ).rows[0];
  if (!admin) throw new Error("An active Admin is required.");
  const now = (await db.query("SELECT statement_timestamp() AS now")).rows[0]
    .now;
  const departmentIds = new Map(),
    locationIds = new Map();
  for (const d of departments) {
    await db.query(
      "INSERT INTO portal.departments(code,name_en,name_zh) VALUES($1,$2,$3) ON CONFLICT(code) DO NOTHING",
      [d.code, d.en, d.zh],
    );
    const row = (
      await db.query(
        "SELECT id FROM portal.departments WHERE code=$1 AND active AND btrim(coalesce(name_en,''))<>'' AND btrim(name_zh)<>''",
        [d.code],
      )
    ).rows[0];
    if (!row)
      throw new Error(
        "A seed department is inactive or missing a translation.",
      );
    departmentIds.set(d.code, row.id);
  }
  for (const l of locations) {
    await db.query(
      "INSERT INTO portal.locations(code,name_en,name_zh,country_code,timezone) VALUES($1,$2,$3,$4,$5) ON CONFLICT(code) DO NOTHING",
      [l.code, l.en, l.zh, l.country, l.timeZone],
    );
    const row = (
      await db.query(
        "SELECT id FROM portal.locations WHERE code=$1 AND active AND btrim(coalesce(name_en,''))<>'' AND btrim(name_zh)<>''",
        [l.code],
      )
    ).rows[0];
    if (!row)
      throw new Error("A seed location is inactive or missing a translation.");
    locationIds.set(l.code, row.id);
  }
  const result = [];
  for (const vacancy of vacancies) {
    const current = (
      await db.query("SELECT id FROM portal.jobs WHERE canonical_slug=$1", [
        vacancy.slug,
      ])
    ).rows[0];
    if (current) {
      result.push({ slug: vacancy.slug, action: "preserve", id: current.id });
      continue;
    }
    const draft = vacancyDraft(
      vacancy,
      departmentIds.get(vacancy.department),
      locationIds.get(vacancy.location),
      now,
    );
    const s = draft.settings,
      id = randomUUID();
    await db.query(
      `INSERT INTO portal.jobs(id,canonical_slug,status,draft_content,published_content,version,published_version,
      department_id,job_type,experience,salary_min,salary_max,salary_currency,salary_period,show_salary,
      owner_id,approved_by,approved_at,publish_at,close_at,first_published_at)
      VALUES($1,$2,'PUBLISHED',$3::jsonb,$4::jsonb,1,1,$5,$6,$7,$8,$9,$10,$11,true,$12,$12,$13,$14,$15,$14)`,
      [
        id,
        vacancy.slug,
        JSON.stringify(draft),
        JSON.stringify({ ...draft, englishFallback: false }),
        s.departmentId,
        s.jobType,
        s.experience,
        s.salary.min,
        s.salary.max,
        s.salary.currency,
        s.salary.period,
        adminId,
        now,
        s.publishAt,
        s.closeAt,
      ],
    );
    await db.query(
      "INSERT INTO portal.job_locations(job_id,location_id) VALUES($1,$2)",
      [id, s.locationIds[0]],
    );
    await db.query(
      "INSERT INTO portal.audit_logs(actor_id,object_type,object_id,action,safe_changes,request_id) VALUES($1,'JOB',$2,'JOB_PUBLISH','{\"version\":1,\"status\":\"PUBLISHED\"}',$3)",
      [adminId, id, randomUUID()],
    );
    await db.query(
      "INSERT INTO portal.outbox_events(event_type,aggregate_id,delivery_key,safe_references) VALUES('JOB_PUBLISH',$1,$2,$3::jsonb)",
      [id, `seed-job:${id}`, JSON.stringify({ id, version: 1 })],
    );
    result.push({ slug: vacancy.slug, action: "create-published", id });
  }
  const content = await seedCompanyContent(db, { adminId, apply: true });
  return { jobs: result, content };
}
