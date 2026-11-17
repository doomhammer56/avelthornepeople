import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { withPublicReader } from "../../../src/server/database/public.ts";
import {
  findPublishedJob,
  publishedJobPage,
  publishedJobLinks,
} from "../../../src/server/jobs/public.ts";
import { parsePublicJobs } from "../../../src/lib/publicJobSchema.ts";
import {
  emptyJobFilters,
  filterPublicJobs,
  getJobOptions,
  paginatePublicJobs,
} from "../../../src/lib/publicJobs.ts";
import {
  publicJobQuery,
  previewPublicJobPage,
  parsePublicJobPage,
} from "../../../src/lib/publicJobQuery.ts";

// Executes the production queries through the actual checked read-only wrapper.
// Only fixture data is synthetic; public views/policies below come from the
// existing migrations. This is single-session PostgreSQL, not a hosted test.
describe("Public summary projections (isolated PostgreSQL)", () => {
  let db;
  const content = {
    en: {
      title: "Engineer",
      responsibilities: ["Build"],
      requirements: ["SQL"],
    },
    zh: {
      title: "工程师",
      responsibilities: ["开发"],
      requirements: ["数据库"],
    },
    privateMetadata: "must not leave PostgreSQL",
  };
  before(async () => {
    db = new PGlite();
    await db.exec(`CREATE SCHEMA portal;
      CREATE ROLE portal_public_reader NOLOGIN NOINHERIT;
      CREATE ROLE portal_public_view_owner NOLOGIN NOINHERIT;
      CREATE ROLE portal_runtime NOLOGIN NOINHERIT;
      CREATE ROLE portal_metrics_writer NOLOGIN NOINHERIT;
      CREATE ROLE summary_reader LOGIN NOINHERIT;
      GRANT portal_public_reader TO summary_reader;
      GRANT USAGE ON SCHEMA portal TO portal_public_reader,portal_public_view_owner;
      CREATE TABLE portal.jobs(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),canonical_slug text UNIQUE,
        status text DEFAULT 'PUBLISHED',published_content jsonb,published_version integer DEFAULT 1,
        approved_at timestamptz DEFAULT now(),publish_at timestamptz DEFAULT now()-interval '1 day',
        close_at timestamptz,department_id integer DEFAULT 1,job_type text DEFAULT 'FULL_TIME',
        experience text DEFAULT 'MID',show_salary boolean DEFAULT false,
        salary_min numeric DEFAULT 100,salary_max numeric DEFAULT 200,
        salary_currency text DEFAULT 'USD',salary_period text DEFAULT 'MONTH',created_at timestamptz DEFAULT now()
      );
      CREATE TABLE portal.departments(id integer PRIMARY KEY,code text,name_en text,name_zh text,active boolean DEFAULT true);
      CREATE TABLE portal.locations(id integer PRIMARY KEY,code text,name_en text,name_zh text,active boolean DEFAULT true,
        address_en text,address_zh text,country_code text,timezone text);
      CREATE TABLE portal.job_locations(job_id uuid,location_id integer,PRIMARY KEY(job_id,location_id));
      CREATE TABLE portal.content_blocks(id uuid,type text,sort_order integer,published_content jsonb,published_at timestamptz);
      CREATE TABLE portal.job_options(kind text,code text,name_en text,name_zh text,active boolean DEFAULT true,PRIMARY KEY(kind,code));
      ALTER TABLE portal.jobs ENABLE ROW LEVEL SECURITY;
      ALTER TABLE portal.departments ENABLE ROW LEVEL SECURITY;
      ALTER TABLE portal.locations ENABLE ROW LEVEL SECURITY;
      ALTER TABLE portal.job_locations ENABLE ROW LEVEL SECURITY;
      ALTER TABLE portal.content_blocks ENABLE ROW LEVEL SECURITY;
      ALTER TABLE portal.job_options ENABLE ROW LEVEL SECURITY;
    `);
    const boundary = readFileSync(
      "prisma/migrations/20261019000100_rls_query_boundaries/migration.sql",
      "utf8",
    );
    const start = boundary.indexOf("GRANT SELECT (id, canonical_slug");
    const end = boundary.indexOf("-- Generic authenticated/provider roles");
    assert.ok(start > 0 && end > start);
    await db.exec(boundary.slice(start, end));
    await db.exec(
      readFileSync(
        "prisma/migrations/20261029000300_public_jobs_newest_first/migration.sql",
        "utf8",
      ),
    );
    const references = readFileSync(
      "prisma/migrations/20261026000500_job_reference_management/migration.sql",
      "utf8",
    );
    const policy = references.match(
      /CREATE POLICY reference_public_labels[^;]+;/,
    )?.[0];
    const view = references.match(
      /CREATE VIEW portal\.public_job_options[^;]+;/,
    )?.[0];
    assert.ok(policy && view);
    await db.exec(`GRANT SELECT ON portal.job_options TO portal_public_view_owner;
      ${policy}
      GRANT CREATE ON SCHEMA portal TO portal_public_view_owner;
      ${view}
      ALTER VIEW portal.public_job_options OWNER TO portal_public_view_owner;
      REVOKE CREATE ON SCHEMA portal FROM portal_public_view_owner;
      GRANT SELECT ON portal.public_job_options TO portal_public_reader;
    `);
  });
  after(async () => db?.close());
  beforeEach(async () => {
    await db.exec(`ROLLBACK; SET SESSION AUTHORIZATION postgres;
      TRUNCATE portal.jobs,portal.job_locations,portal.departments,portal.locations,portal.job_options;
      INSERT INTO portal.departments(id,code,name_en,name_zh) VALUES(1,'ENG','Engineering','工程');
      INSERT INTO portal.locations(id,code,name_en,name_zh) VALUES(1,'RW','Kigali','基加利'),(2,'CN','Shanghai','上海');
      INSERT INTO portal.job_options(kind,code,name_en,name_zh) VALUES
        ('jobType','FULL_TIME','Full-time','全职'),('experience','MID','Mid level','中级');
    `);
    await db.query(
      "INSERT INTO portal.jobs(canonical_slug,published_content) VALUES('engineer',$1)",
      [JSON.stringify(content)],
    );
    await db.exec(
      "INSERT INTO portal.job_locations SELECT id,1 FROM portal.jobs;",
    );
  });

  async function asOwner(action) {
    await db.exec("SET SESSION AUTHORIZATION postgres;");
    return action();
  }
  async function reader() {
    await db.exec("SET SESSION AUTHORIZATION summary_reader;");
    const calls = [];
    let releases = 0;
    return {
      calls,
      get releases() {
        return releases;
      },
      connect: async () => ({
        query: async (sql, values) => {
          const result =
            !values && sql.trim().startsWith("BEGIN READ ONLY;")
              ? await db.exec(sql)
              : await db.query(sql, values);
          calls.push({ sql, values, result });
          return result;
        },
        release: () => {
          releases++;
        },
      }),
    };
  }
  function summaryRows(pool) {
    return pool.calls.flatMap((call) => call.result?.rows?.[0]?.jobs ?? []);
  }
  // Only this test harness collects whole summary exports. Production listings
  // always request a bounded page; sitemap uses its separate link projection.
  async function listPublishedJobs(pool) {
    const first = await publishedJobPage(
      publicJobQuery(new URLSearchParams({ pageSize: "100" })),
      pool,
    );
    const jobs = [...first.jobs];
    for (let page = 2; page <= first.totalPages; page++)
      jobs.push(
        ...(
          await publishedJobPage(
            publicJobQuery(
              new URLSearchParams({ pageSize: "100", page: String(page) }),
            ),
            pool,
          )
        ).jobs,
      );
    return jobs;
  }

  test("Summary query returns only summary inputs and matches detail-derived public fields", async () => {
    const pool = await reader();
    const summaries = await listPublishedJobs(pool);
    const [raw] = summaryRows(pool);
    assert.deepEqual(Object.keys(raw).sort(), [
      "canonical_slug",
      "department_en",
      "department_zh",
      "english_fallback",
      "experience_label",
      "id",
      "locations",
      "publish_at",
      "title_en",
      "title_zh",
      "type_label",
    ]);
    assert.equal(
      pool.calls.length,
      3,
      "one setup, one summary SELECT and commit",
    );
    assert.equal(pool.releases, 1);
    const detail = await findPublishedJob("engineer", pool);
    assert.deepEqual(summaries, parsePublicJobs({ jobs: [detail] }));
    assert.deepEqual(detail.responsibilities.en, ["Build"]);
    assert.equal(detail.salary, undefined);
    assert.equal(await findPublishedJob("missing-job", pool), null);
    const before = pool.calls.length;
    assert.equal(await findPublishedJob("engineer'; SELECT 1;--", pool), null);
    assert.equal(
      pool.calls.length,
      before,
      "invalid slug rejected without a query",
    );
  });

  test("Malformed detail-only content and visible salary do not break the summary collection", async () => {
    const damaged = {
      en: {
        title: "Engineer",
        responsibilities: [],
        requirements: { invalid: true },
      },
      zh: { title: "工程师", responsibilities: [], requirements: [] },
    };
    await db.query(
      "UPDATE portal.jobs SET published_content=$1,show_salary=true,salary_min=500,salary_max=100",
      [JSON.stringify(damaged)],
    );
    const pool = await reader();
    const jobs = await listPublishedJobs(pool);
    assert.equal(jobs[0].title.en, "Engineer");
    assert.equal(jobs[0].salary, undefined);
    assert.equal(jobs[0].responsibilities, undefined);
    await assert.rejects(() => findPublishedJob("engineer", pool));
  });

  test("Publication and active-reference visibility remain fresh and equal for list and detail", async () => {
    const changes = [
      [
        "UPDATE portal.jobs SET status='DRAFT'",
        "UPDATE portal.jobs SET status='PUBLISHED'",
      ],
      [
        "UPDATE portal.jobs SET approved_at=NULL",
        "UPDATE portal.jobs SET approved_at=now()",
      ],
      [
        "UPDATE portal.jobs SET published_version=NULL",
        "UPDATE portal.jobs SET published_version=1",
      ],
      [
        "UPDATE portal.jobs SET publish_at=now()+interval '1 day'",
        "UPDATE portal.jobs SET publish_at=now()-interval '1 day'",
      ],
      [
        "UPDATE portal.jobs SET close_at=statement_timestamp()",
        "UPDATE portal.jobs SET close_at=NULL",
      ],
      [
        "UPDATE portal.departments SET active=false",
        "UPDATE portal.departments SET active=true",
      ],
      [
        "UPDATE portal.locations SET active=false",
        "UPDATE portal.locations SET active=true",
      ],
      [
        "UPDATE portal.jobs SET job_type='UNKNOWN'",
        "UPDATE portal.jobs SET job_type='FULL_TIME'",
      ],
      [
        "DELETE FROM portal.job_locations",
        "INSERT INTO portal.job_locations SELECT id,1 FROM portal.jobs",
      ],
    ];
    for (const [hide, restore] of changes) {
      await asOwner(() => db.exec(hide));
      const pool = await reader();
      assert.deepEqual(await listPublishedJobs(pool), [], hide);
      assert.equal(await findPublishedJob("engineer", pool), null, hide);
      await asOwner(() => db.exec(restore));
    }
    const pool = await reader();
    assert.equal((await listPublishedJobs(pool)).length, 1);
    await asOwner(() =>
      db.exec(
        "UPDATE portal.departments SET name_en='New team'; UPDATE portal.locations SET name_en='New city'; UPDATE portal.job_options SET name_en='New type' WHERE kind='jobType';",
      ),
    );
    const [updated] = await listPublishedJobs(await reader());
    assert.equal(updated.department.en, "New team");
    assert.equal(updated.location.en, "New city");
    assert.equal(updated.type.en, "New type");
    await assert.rejects(
      () => db.query("SELECT published_content FROM portal.jobs"),
      { code: "42501" },
    );
  });

  test("English-only jobs remain searchable and match detail fallback through the actual public SQL", async () => {
    await asOwner(() =>
      db.query("UPDATE portal.jobs SET published_content=$1", [
        JSON.stringify({
          ...content,
          zh: { title: "", responsibilities: [], requirements: [] },
          englishFallback: false,
        }),
      ]),
    );
    const [summary] = await listPublishedJobsReader();
    const detail = await findPublishedJob("engineer", await reader());
    assert.equal(summary.contentLanguage, "en");
    assert.equal(detail.contentLanguage, "en");
    assert.equal(summary.title.zh, summary.title.en);
    assert.deepEqual(summary.title, detail.title);
    assert.deepEqual(detail.requirements.zh, content.en.requirements);
    const page = await publishedJobPage(
      publicJobQuery(new URLSearchParams({ q: "Engineer" })),
      await reader(),
    );
    assert.equal(page.total, 1);
  });

  test("JSON title types and strict boolean fallback survive SQL extraction", async () => {
    for (const title of [42, ["Engineer"], { title: "Engineer" }, null]) {
      await asOwner(() =>
        db.query("UPDATE portal.jobs SET published_content=$1", [
          JSON.stringify({ ...content, en: { ...content.en, title } }),
        ]),
      );
      await assert.rejects(() => listPublishedJobsReader());
    }
    await asOwner(() =>
      db.query("UPDATE portal.jobs SET published_content=$1", [
        JSON.stringify({ zh: content.zh, englishFallback: "true" }),
      ]),
    );
    await assert.rejects(() => listPublishedJobsReader());
    await asOwner(() =>
      db.query("UPDATE portal.jobs SET published_content=$1", [
        JSON.stringify({ zh: content.zh, englishFallback: true }),
      ]),
    );
    await asOwner(() =>
      db.exec(
        "UPDATE portal.departments SET name_en=NULL; UPDATE portal.locations SET name_en=NULL WHERE id=1;",
      ),
    );
    const [fallback] = await listPublishedJobsReader();
    assert.equal(fallback.contentLanguage, "zh");
    assert.equal(fallback.title.en, "工程师");
    assert.equal(fallback.department.en, "工程");
    assert.equal(fallback.location.en, "基加利");
  });
  async function listPublishedJobsReader() {
    return listPublishedJobs(await reader());
  }

  test("Location ordering, filters, facet values and pagination retain their current behavior", async () => {
    await db.exec(
      "INSERT INTO portal.job_locations SELECT id,2 FROM portal.jobs; UPDATE portal.jobs SET experience=NULL;",
    );
    const jobs = await listPublishedJobsReader();
    assert.equal(jobs[0].location.en, "Shanghai, Kigali");
    assert.equal(jobs[0].location.zh, "上海、基加利");
    assert.equal(jobs[0].experience, null);
    for (const query of ["ENGINEER", "工程师"])
      assert.equal(
        filterPublicJobs(jobs, { ...emptyJobFilters, query }).length,
        1,
      );
    assert.equal(
      filterPublicJobs(jobs, {
        ...emptyJobFilters,
        location: "Shanghai, Kigali",
      }).length,
      1,
    );
    assert.equal(
      filterPublicJobs(jobs, { ...emptyJobFilters, location: "Kigali" }).length,
      0,
    );
    assert.deepEqual(getJobOptions(jobs, "location", "zh"), [
      { value: "Shanghai, Kigali", label: "上海、基加利" },
    ]);
    assert.deepEqual(paginatePublicJobs(jobs, "999"), {
      page: 1,
      totalPages: 1,
      jobs,
    });
  });

  test("Database filtering and bounded pages agree with the existing public filters", async () => {
    const padded = {
      ...content,
      en: { ...content.en, title: "\t Engineer \u00a0" },
      zh: { ...content.zh, title: " 工程师 " },
    };
    await db.query(
      `INSERT INTO portal.jobs(canonical_slug,published_content,publish_at)
      SELECT 'extra-'||i,$1::jsonb,now()-interval '2 days' FROM generate_series(1,122) i`,
      [JSON.stringify(padded)],
    );
    await db.exec(
      "INSERT INTO portal.job_locations SELECT id,1 FROM portal.jobs WHERE canonical_slug<>'engineer';",
    );
    // Preview fixtures only contain day-level posting dates; align their
    // creation dates for this filter/pagination parity test.
    await db.exec(
      "UPDATE portal.jobs SET created_at=date_trunc('day',publish_at)",
    );
    await db.exec(
      "UPDATE portal.departments SET name_en=' Engineering '; UPDATE portal.job_options SET name_en=' Full-time ' WHERE kind='jobType';",
    );
    const all = await listPublishedJobs(await reader());
    for (const params of [
      { page: "2" },
      { page: "999" },
      { page: "-1" },
      { q: "Engineer 工程师" },
      { q: "ＥＮＧＩＮＥＥＲ", department: "Engineering" },
      {
        q: "工程师",
        type: "Full-time",
        location: "Kigali",
        experience: "Mid level",
        page: "4",
        facets: "1",
      },
      { q: "'; DROP TABLE portal.jobs;--", facets: "1" },
      { q: "nothing", page: "99" },
      { pageSize: "100" },
    ]) {
      const query = publicJobQuery(new URLSearchParams(params));
      const page = await publishedJobPage(query, await reader());
      const expected = previewPublicJobPage(all, query);
      assert.deepEqual(page, expected, JSON.stringify(params));
      assert.deepEqual(parsePublicJobPage(page, query), page);
      assert.ok(page.jobs.length <= query.pageSize);
    }
    const page = await publishedJobPage(
      publicJobQuery(new URLSearchParams({ page: "2", pageSize: "6" })),
      await reader(),
    );
    assert.equal(page.jobs.length, 6);
    assert.equal(page.total, 123);
  });

  test("newly added jobs come first before pagination even with backdated posting dates", async () => {
    await db.exec("UPDATE portal.jobs SET created_at='2000-01-01T00:00:00Z'");
    const orderedContent = {
      ...content,
      en: { ...content.en, title: "Newest order fixture" },
    };
    await db.query(
      `INSERT INTO portal.jobs(id,canonical_slug,published_content,publish_at,created_at) VALUES
      ('00000000-0000-4000-8000-000000000001','old-role',$1,now()-interval '1 day','2020-01-01T09:00:00Z'),
      ('ffffffff-ffff-4fff-8fff-fffffffffff1','new-role',$1,now()-interval '8 days','2020-01-02T09:00:00.000001Z'),
      ('ffffffff-ffff-4fff-8fff-fffffffffff2','newest-role',$1,now()-interval '9 days','2020-01-02T09:00:00.000002Z'),
      ('ffffffff-ffff-4fff-8fff-fffffffffff3','tied-role',$1,now()-interval '9 days','2020-01-02T09:00:00.000002Z')`,
      [JSON.stringify(orderedContent)],
    );
    await db.exec(
      "INSERT INTO portal.job_locations SELECT id,1 FROM portal.jobs WHERE canonical_slug<>'engineer'",
    );
    const newest = await publishedJobPage(
      publicJobQuery(new URLSearchParams({ pageSize: "1" })),
      await reader(),
    );
    assert.equal(newest.jobs[0].slug, "newest-role");
    const slugs = [];
    for (let page = 1; page <= 4; page++) {
      const query = publicJobQuery(
        new URLSearchParams({
          q: "Newest order",
          department: "Engineering",
          pageSize: "1",
          page: String(page),
        }),
      );
      const result = await publishedJobPage(query, await reader());
      assert.equal(result.total, 4);
      assert.equal(result.page, page);
      slugs.push(result.jobs[0].slug);
      assert.ok(!Object.hasOwn(result.jobs[0], "createdAt"));
    }
    assert.deepEqual(slugs, [
      "newest-role",
      "tied-role",
      "new-role",
      "old-role",
    ]);
  });

  test("Facet options cover all jobs and are independently paged without silent truncation", async () => {
    await db.exec(`INSERT INTO portal.departments(id,code,name_en,name_zh)
      SELECT i,'D'||i,'Team '||lpad(i::text,3,'0'),'部门 '||lpad(i::text,3,'0') FROM generate_series(2,205) i;`);
    await db.query(
      `INSERT INTO portal.jobs(canonical_slug,published_content,department_id)
      SELECT 'team-'||i,$1::jsonb,i FROM generate_series(2,205) i`,
      [JSON.stringify(content)],
    );
    await db.exec(
      "INSERT INTO portal.job_locations SELECT id,1 FROM portal.jobs WHERE canonical_slug<>'engineer';",
    );
    const seen = new Set();
    for (let page = 1; page <= 3; page++) {
      const query = publicJobQuery(
        new URLSearchParams({
          q: "no matches",
          facets: "1",
          departmentPage: String(page),
        }),
      );
      const data = await publishedJobPage(query, await reader());
      assert.equal(data.total, 0);
      assert.equal(data.facets.department.totalPages, 3);
      assert.equal(data.facets.department.page, page);
      assert.ok(data.facets.department.options.length <= 100);
      for (const value of data.facets.department.options) seen.add(value.en);
      assert.equal(data.facets.location.options[0].en, "Kigali");
      assert.deepEqual(parsePublicJobPage(data, query), data);
    }
    assert.equal(seen.size, 205);
  });

  test("10/100/1000 long-description jobs transfer compact summary rows with stable ordering", async (t) => {
    const long = "Long bilingual description. ".repeat(150);
    const largeContent = {
      ...content,
      en: { ...content.en, responsibilities: [long], requirements: [long] },
      zh: { ...content.zh, responsibilities: [long], requirements: [long] },
    };
    for (const size of [10, 100, 1000]) {
      await asOwner(async () => {
        await db.exec("TRUNCATE portal.jobs,portal.job_locations;");
        await db.query(
          `INSERT INTO portal.jobs(canonical_slug,published_content,publish_at)
          SELECT 'job-'||i,$1::jsonb,now()-interval '1 day'-(i%3)*interval '1 day' FROM generate_series(1,$2::integer) i`,
          [JSON.stringify(largeContent), size],
        );
        await db.exec(
          "INSERT INTO portal.job_locations SELECT id,1 FROM portal.jobs;",
        );
      });
      const pool = await reader();
      const jobs = await listPublishedJobs(pool);
      const raw = summaryRows(pool);
      const oldContent = await withPublicReader(
        async (client) =>
          (
            await client.query(
              "SELECT published_content FROM portal.visible_jobs ORDER BY publish_at DESC,id",
            )
          ).rows,
        pool,
      );
      const descriptionBytes = Buffer.byteLength(JSON.stringify(oldContent));
      const summaryBytes = Buffer.byteLength(JSON.stringify(raw));
      const bounded = await publishedJobPage(
        publicJobQuery(new URLSearchParams({ facets: "1" })),
        pool,
      );
      assert.equal(bounded.jobs.length, 10);
      assert.equal(jobs.length, size);
      const links = await publishedJobLinks(pool);
      assert.equal(links.length, size);
      assert.deepEqual(Object.keys(links[0]).sort(), ["postedAt", "slug"]);
      assert.ok(summaryBytes < descriptionBytes / 20);
      assert.ok(summaryBytes < 600 * size);
      assert.deepEqual(jobs, await listPublishedJobs(pool));
      assert.deepEqual(
        jobs.map((job) => job.id),
        await withPublicReader(
          async (client) =>
            (
              await client.query(
                "SELECT id FROM portal.visible_jobs ORDER BY created_at DESC,publish_at DESC,id",
              )
            ).rows.map((row) => row.id),
          pool,
        ),
      );
      assert.equal(paginatePublicJobs(jobs, "2").jobs.length, 10);
      t.diagnostic(
        JSON.stringify({
          size,
          descriptionBytes,
          summaryBytes,
          responseBytes: Buffer.byteLength(JSON.stringify({ jobs })),
          boundedResponseBytes: Buffer.byteLength(JSON.stringify(bounded)),
        }),
      );
    }
  });
});
