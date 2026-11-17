import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  loadAuthTestEnvironment,
  connectAuthTestDatabase,
} from "../../../scripts/auth/test-env.mjs";
import { createStaffFixture } from "../database/helpers.mjs";
import { verifiedDatabaseConfig } from "../../../src/server/database/tls.ts";
import { publishedJobPage } from "../../../src/server/jobs/public.ts";
import { publicJobQuery } from "../../../src/lib/publicJobQuery.ts";

const project = loadAuthTestEnvironment();
const publicUrl = new URL(process.env.PUBLIC_DATABASE_URL ?? "");
assert.ok(
  publicUrl.hostname === `db.${project}.supabase.co` ||
    (publicUrl.hostname.endsWith(".pooler.supabase.com") &&
      decodeURIComponent(publicUrl.username).endsWith(`.${project}`)),
  "Public reader must target the dedicated test project",
);

test(
  "hosted public listings put newly added backdated jobs first across filtered pages",
  { timeout: 90000 },
  async (t) => {
    const db = await connectAuthTestDatabase(
      () =>
        new pg.Client(
          verifiedDatabaseConfig({
            connectionString: process.env.DIRECT_URL,
            connectionTimeoutMillis: 15000,
            statement_timeout: 15000,
          }),
        ),
    );
    const prefix = `newest-${randomUUID()}`,
      ids = [randomUUID(), randomUUID()];
    let department,
      location,
      createdProfile = false;
    t.after(async () => {
      try {
        await db.query("ROLLBACK");
        await db.query("BEGIN");
        await db.query("DELETE FROM portal.jobs WHERE id=ANY($1::uuid[])", [
          ids,
        ]);
        if (department)
          await db.query("DELETE FROM portal.departments WHERE id=$1", [
            department,
          ]);
        if (location)
          await db.query("DELETE FROM portal.locations WHERE id=$1", [
            location,
          ]);
        if (createdProfile)
          await db.query("DELETE FROM portal.staff_profiles WHERE id=$1", [
            process.env.TEST_STAFF_USER_ID,
          ]);
        await db.query("COMMIT");
      } finally {
        await db.end();
      }
    });
    await db.query("BEGIN");
    createdProfile = !(
      await db.query(
        "SELECT EXISTS(SELECT 1 FROM portal.staff_profiles WHERE id=$1) present",
        [process.env.TEST_STAFF_USER_ID],
      )
    ).rows[0].present;
    const staff = await createStaffFixture(db);
    department = (
      await db.query(
        "INSERT INTO portal.departments(code,name_en,name_zh) VALUES($1,$1,'排序测试') RETURNING id",
        [prefix],
      )
    ).rows[0].id;
    location = (
      await db.query(
        "INSERT INTO portal.locations(code,name_en,name_zh,country_code,timezone) VALUES($1,$1,'排序地点','RW','Africa/Kigali') RETURNING id",
        [prefix],
      )
    ).rows[0].id;
    const content = {
      en: {
        title: prefix,
        responsibilities: ["Work"],
        requirements: ["Skill"],
      },
      zh: {
        title: "排序职位",
        responsibilities: ["工作"],
        requirements: ["技能"],
      },
    };
    for (const [i, age, postedAge] of [
      [0, "2 minutes", "1 day"],
      [1, "1 minute", "10 days"],
    ]) {
      await db.query(
        `INSERT INTO portal.jobs(id,canonical_slug,status,draft_content,published_content,published_version,department_id,
      job_type,experience,owner_id,approved_by,approved_at,publish_at,created_at)
      VALUES($1,$2,'PUBLISHED',$3,$3,1,$4,'FULL_TIME','ANY',$5,$5,now(),now()-$6::interval,now()-$7::interval)`,
        [
          ids[i],
          `${prefix}-${i}`,
          JSON.stringify(content),
          department,
          staff,
          postedAge,
          age,
        ],
      );
      await db.query(
        "INSERT INTO portal.job_locations(job_id,location_id) VALUES($1,$2)",
        [ids[i], location],
      );
    }
    await db.query("COMMIT");
    for (const page of [1, 2]) {
      const result = await publishedJobPage(
        publicJobQuery(
          new URLSearchParams({
            q: prefix,
            department: prefix,
            pageSize: "1",
            page: String(page),
          }),
        ),
      );
      assert.equal(result.total, 2);
      assert.equal(result.page, page);
      assert.equal(result.jobs[0].id, ids[page === 1 ? 1 : 0]);
      assert.ok(!Object.hasOwn(result.jobs[0], "createdAt"));
    }
  },
);
