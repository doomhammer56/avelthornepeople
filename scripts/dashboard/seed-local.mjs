import { randomUUID } from "node:crypto";

// Called only after setup-local verifies the dedicated test project and origins.
export async function seedLocalJob(db) {
  const {
    rows: [owner],
  } = await db.query(
    "SELECT id FROM portal.staff_profiles WHERE active AND role='ADMIN' ORDER BY created_at,id LIMIT 1",
  );
  if (!owner)
    throw new Error(
      "An active administrator is required for the development seed",
    );
  const slug = "dev-pv-test-vacancy";
  const {
    rows: [existing],
  } = await db.query(
    "SELECT id,published_content FROM portal.jobs WHERE canonical_slug=$1",
    [slug],
  );
  if (existing) {
    if (existing.published_content?.developmentFixture !== "pv-local-v1")
      throw new Error("Seed slug is already in use");
    return slug;
  }
  const code = "DEV_PV_TEST";
  const department =
    (
      await db.query(
        `INSERT INTO portal.departments(code,name_en,name_zh)
    VALUES($1,'Development test','开发测试') ON CONFLICT(code) DO NOTHING RETURNING id`,
        [code],
      )
    ).rows[0] ??
    (
      await db.query(
        "SELECT id FROM portal.departments WHERE code=$1 AND name_en='Development test'",
        [code],
      )
    ).rows[0];
  const location =
    (
      await db.query(
        `INSERT INTO portal.locations(code,name_en,name_zh,country_code,timezone)
    VALUES($1,'Development test location','开发测试地点','RW','Africa/Kigali') ON CONFLICT(code) DO NOTHING RETURNING id`,
        [code],
      )
    ).rows[0] ??
    (
      await db.query(
        "SELECT id FROM portal.locations WHERE code=$1 AND name_en='Development test location'",
        [code],
      )
    ).rows[0];
  if (!department || !location)
    throw new Error("Seed lookup code is already in use");
  const content = {
    settings: {
      departmentId: department.id,
      locationIds: [location.id],
      jobType: "FULL_TIME",
      experience: "ANY",
      salary: null,
      showSalary: false,
      publishAt: null,
      closeAt: null,
    },
    developmentFixture: "pv-local-v1",
    en: {
      title: "[DEV TEST] Page-view verification vacancy",
      responsibilities: [
        "Development fixture for verifying job-detail page views. This is not a real vacancy.",
      ],
      requirements: [
        "Do not submit an application. Use this page only to test analytics.",
      ],
    },
    zh: {
      title: "[开发测试] 浏览量验证职位",
      responsibilities: [
        "用于验证职位详情页浏览量的开发测试数据，并非真实招聘职位。",
      ],
      requirements: ["请勿投递申请，此页面仅用于测试浏览量统计。"],
    },
  };
  const {
    rows: [job],
  } = await db.query(
    `INSERT INTO portal.jobs(canonical_slug,status,draft_content,published_content,
    published_version,department_id,job_type,experience,owner_id,approved_by,approved_at,publish_at,first_published_at)
    VALUES($1,'PUBLISHED',$2::jsonb,$2::jsonb,1,$3,'FULL_TIME','ANY',$4,$4,statement_timestamp(),statement_timestamp(),statement_timestamp()) RETURNING id`,
    [slug, JSON.stringify(content), department.id, owner.id],
  );
  await db.query(
    "INSERT INTO portal.job_locations(job_id,location_id) VALUES($1,$2)",
    [job.id, location.id],
  );
  await db.query(
    `INSERT INTO portal.audit_logs(actor_id,object_type,object_id,action,safe_changes,request_id)
      VALUES(NULL,'JOB',$1,'DEV_FIXTURE_SEEDED','{"fixture":"pv-local-v1"}',$2)`,
    [job.id, randomUUID()],
  );
  return slug;
}
