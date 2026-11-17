import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  warmPublicPaths,
  assertPublicationSync,
} from "../../helpers/publishing-sync.mjs";
import pg from "pg";
import {
  loadAuthTestEnvironment,
  connectAuthTestDatabase,
} from "../../../scripts/auth/test-env.mjs";
loadAuthTestEnvironment();
const { authAdminClient } =
  await import("../../../src/server/adapters/auth/admin.ts");
const { identityClient } =
  await import("../../../src/server/adapters/auth/config.ts");

test(
  "Built job APIs and Cron with real restricted connections",
  { timeout: 360000 },
  async (t) => {
    assert.ok(existsSync(".next/BUILD_ID"), "Build first");
    assert.ok(
      process.env.JOBS_WORKER_DATABASE_URL && process.env.CRON_SECRET,
      "Run jobs:setup:local -- --apply first",
    );
    const db = await connectAuthTestDatabase(
      () =>
        new pg.Client({
          connectionString: process.env.DIRECT_URL,
          connectionTimeoutMillis: 15000,
          statement_timeout: 15000,
        }),
    );
    const admin = authAdminClient(),
      users = [];
    let child, department, location;
    t.after(async () => {
      if (child && child.exitCode === null) {
        const stopped = new Promise((resolve) => child.once("exit", resolve));
        child.kill();
        await stopped;
      }
      try {
        await db.query("BEGIN");
        const ids = (
          await db.query(
            "SELECT id FROM portal.jobs WHERE owner_id=ANY($1::uuid[])",
            [users.map((u) => u.id)],
          )
        ).rows.map((r) => r.id);
        await db.query(
          "DELETE FROM portal.outbox_events WHERE aggregate_id=ANY($1::uuid[])",
          [ids],
        );
        await db.query(
          "DELETE FROM portal.audit_logs WHERE object_id=ANY($1::uuid[]) OR actor_id=ANY($2::uuid[])",
          [ids, users.map((u) => u.id)],
        );
        await db.query("DELETE FROM portal.jobs WHERE id=ANY($1::uuid[])", [
          ids,
        ]);
        if (location)
          await db.query("DELETE FROM portal.locations WHERE id=$1", [
            location,
          ]);
        if (department)
          await db.query("DELETE FROM portal.departments WHERE id=$1", [
            department,
          ]);
        await db.query(
          "DELETE FROM portal.staff_profiles WHERE id=ANY($1::uuid[])",
          [users.map((u) => u.id)],
        );
        await db.query("COMMIT");
      } finally {
        await db.end();
      }
      for (const user of users)
        assert.equal(
          (await admin.auth.admin.deleteUser(user.id)).error,
          null,
          "Synthetic identity cleanup failed",
        );
    });
    for (const role of ["ADMIN", "HR", "READ_ONLY"]) {
      const email = `be03-http-${randomUUID()}@example.invalid`;
      const result = await admin.auth.admin.createUser({
        email,
        password: randomBytes(32).toString("base64url"),
        email_confirm: true,
      });
      assert.equal(result.error, null);
      const user = { ...result.data.user, role };
      users.push(user);
      await db.query(
        "INSERT INTO portal.staff_profiles(id,display_name,role,active) VALUES($1,'BE03 HTTP fixture',$2,true)",
        [user.id, role],
      );
      const link = await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
      });
      assert.equal(link.error, null);
      const verified = await identityClient().auth.verifyOtp({
        type: "magiclink",
        token_hash: link.data.properties.hashed_token,
      });
      assert.equal(verified.error, null);
      user.token = verified.data.session.access_token;
      user.cookie = `sb-${process.env.AUTH_TEST_PROJECT_REF}-auth-token=base64-${Buffer.from(JSON.stringify(verified.data.session)).toString("base64url")}`;
      const session = JSON.parse(
        Buffer.from(user.token.split(".")[1], "base64url").toString(),
      ).session_id;
      await db.query(
        "INSERT INTO portal_private.staff_session_admissions(session_id,subject_id,expires_at) VALUES($1,$2,statement_timestamp()+interval '1 hour')",
        [session, user.id],
      );
    }
    const [lead, hr, reader] = users;
    department = (
      await db.query(
        "INSERT INTO portal.departments(code,name_en,name_zh) VALUES($1,'BE03 HTTP','BE03 HTTP ZH') RETURNING id",
        [`BE03_${randomUUID()}`],
      )
    ).rows[0].id;
    location = (
      await db.query(
        "INSERT INTO portal.locations(code,name_en,name_zh,country_code,timezone) VALUES($1,'BE03 HTTP','BE03 HTTP ZH','RW','Africa/Kigali') RETURNING id",
        [`BE03_${randomUUID()}`],
      )
    ).rows[0].id;
    const probe = createServer();
    await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    const origin = `http://127.0.0.1:${port}`;
    child = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "-H",
        "127.0.0.1",
        "-p",
        String(port),
      ],
      {
        env: {
          ...process.env,
          AUTH_APP_ORIGIN: origin,
          PUBLIC_SITE_URL: origin,
          PUBLIC_JOBS_SOURCE: "database",
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    child.stdout.on("data", () => {});
    child.stderr.on("data", () => {});
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        const r = await fetch(origin + "/api/admin/jobs", {
          signal: AbortSignal.timeout(1000),
        });
        await r.body?.cancel();
        if (r.status === 401) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.ok(ready, "Built server did not start");
    async function call(
      path,
      {
        user = lead,
        method = "GET",
        body,
        cookie = false,
        cross = false,
        cron = false,
      } = {},
    ) {
      const headers = {};
      if (user)
        headers[cookie ? "cookie" : "authorization"] = cookie
          ? user.cookie
          : `Bearer ${user.token}`;
      if (cron) headers.authorization = `Bearer ${process.env.CRON_SECRET}`;
      if (method !== "GET") {
        headers["content-type"] = "application/json";
        headers.origin = cross ? "https://attacker.invalid" : origin;
      }
      return fetch(origin + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
      });
    }
    const prefix = `be03-http-${randomUUID()}`,
      id = randomUUID(),
      slug = `job-${id}`;
    const draft = {
      en: {
        title: prefix,
        responsibilities: ["Help people"],
        requirements: ["Experience"],
      },
      zh: {
        title: `${prefix} ZH`,
        responsibilities: ["Help ZH"],
        requirements: ["Experience ZH"],
      },
      settings: {
        departmentId: department,
        locationIds: [location],
        jobType: "FULL_TIME",
        experience: "ANY",
        salary: null,
        showSalary: false,
        publishAt: null,
        closeAt: null,
      },
    };
    let job;
    const publicPaths = [
      `/api/jobs/${slug}`,
      `/api/jobs?q=${prefix}`,
      ...["en", "zh"].flatMap((locale) => [
        `/${locale}/careers?q=${prefix}`,
        `/${locale}/jobs/${slug}`,
      ]),
    ];
    const action = async (name, user = lead, extra = {}) => {
      const checksPublication = [
        "publish",
        "pause",
        "resume",
        "close",
      ].includes(name);
      if (checksPublication) await warmPublicPaths(origin, publicPaths);
      const r = await call(`/api/admin/jobs/${id}/actions`, {
        user,
        method: "POST",
        body: {
          action: name,
          requestId: randomUUID(),
          expectedVersion: job.version,
          ...extra,
        },
      });
      const acknowledgedAt = performance.now();
      assert.equal(r.status, 200, `Action ${name} must commit`);
      job = (await r.json()).job;
      if (checksPublication) {
        const visible = name === "publish" || name === "resume";
        await assertPublicationSync(t, origin, `job ${name}`, acknowledgedAt, [
          {
            path: publicPaths[0],
            matches: async (response) => {
              if (!visible) {
                await response.text();
                return response.status === 404;
              }
              if (response.status !== 200) {
                await response.text();
                return false;
              }
              const current = (await response.json()).job;
              return (
                current.id === id &&
                current.title.en === job.draft.en.title &&
                current.title.zh === job.draft.zh.title
              );
            },
          },
          {
            path: publicPaths[1],
            matches: async (response) => {
              if (response.status !== 200) {
                await response.text();
                return false;
              }
              const current = (await response.json()).jobs.find(
                (item) => item.id === id,
              );
              return visible
                ? current?.title.en === job.draft.en.title &&
                    current?.title.zh === job.draft.zh.title
                : !current;
            },
          },
          ...["en", "zh"].flatMap((locale) => [
            {
              path: `/${locale}/careers?q=${prefix}`,
              matches: async (response) => {
                const html = await response.text();
                return (
                  response.status === 200 &&
                  html.includes('class="careers-job-list"') &&
                  (visible
                    ? html.includes(job.draft[locale].title)
                    : !html.includes(`/jobs/${slug}`))
                );
              },
            },
            {
              path: `/${locale}/jobs/${slug}`,
              matches: async (response) => {
                const html = await response.text();
                return visible
                  ? response.status === 200 &&
                      html.includes(job.draft[locale].title)
                  : response.status === 404 ||
                      html.includes("NEXT_HTTP_ERROR_FALLBACK;404");
              },
            },
          ]),
        ]);
      }
      return job;
    };
    await t.test(
      "Authentication, CSRF, validation and role boundaries",
      async () => {
        assert.equal(
          (await call("/api/admin/jobs", { user: null })).status,
          401,
        );
        assert.equal((await call("/api/admin/jobs?status=bogus")).status, 400);
        assert.equal((await call("/api/admin/jobs/invalid")).status, 400);
        assert.equal(
          (await call(`/api/admin/jobs/${randomUUID()}`)).status,
          404,
        );
        assert.equal(
          (
            await call("/api/admin/jobs", {
              user: reader,
              method: "POST",
              body: { id, slug, draft, requestId: randomUUID() },
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await call("/api/admin/jobs", {
              cookie: true,
              cross: true,
              method: "POST",
              body: { id, slug, draft, requestId: randomUUID() },
            })
          ).status,
          403,
        );
        assert.equal(
          (await call("/api/internal/cron/close-expired-jobs", { user: null }))
            .status,
          401,
        );
        assert.equal(
          (
            await call("/api/internal/cron/close-expired-jobs", {
              cookie: true,
            })
          ).status,
          401,
        );
      },
    );
    await t.test(
      "Stable create, multi-status filters, counts and server-rendered editor",
      async () => {
        const created = await call("/api/admin/jobs", {
          user: hr,
          method: "POST",
          body: { id, slug, draft, requestId: randomUUID() },
        });
        assert.equal(created.status, 201);
        job = (await created.json()).job;
        assert.equal(
          (
            await call("/api/admin/jobs", {
              method: "POST",
              body: { id, slug, draft, requestId: randomUUID() },
            })
          ).status,
          409,
        );
        const another = randomUUID();
        assert.equal(
          (
            await call("/api/admin/jobs", {
              method: "POST",
              body: {
                id: another,
                slug: `job-${another}`,
                draft,
                requestId: randomUUID(),
              },
            })
          ).status,
          201,
        );
        await action("submit", hr);
        assert.equal(
          (
            await call(`/api/admin/jobs/${id}/actions`, {
              user: hr,
              method: "POST",
              body: {
                action: "publish",
                expectedVersion: job.version,
                requestId: randomUUID(),
              },
            })
          ).status,
          403,
        );
        await action("publish");
        const list = await call(
          `/api/admin/jobs?q=${prefix}&status=draft&status=published&pageSize=1`,
          { user: reader },
        );
        assert.equal(list.status, 200);
        assert.match(list.headers.get("cache-control"), /private.*no-store/);
        const data = await list.json();
        assert.equal(data.total, 2);
        assert.equal(data.jobs.length, 1);
        assert.equal(data.statusCounts.draft, 1);
        assert.equal(data.statusCounts.published, 1);
        assert.equal(data.jobs[0].applications, null);
        const onlyDraft = await (
          await call(`/api/admin/jobs?q=${prefix}&status=draft`)
        ).json();
        assert.equal(onlyDraft.total, 1);
        assert.equal(onlyDraft.statusCounts.published, 1);
        const byId = await (
          await call(`/api/admin/jobs?q=${id.toUpperCase()}`)
        ).json();
        assert.equal(byId.total, 1);
        assert.equal(byId.jobs[0].id, id);
        const pageTwo = await (
          await call(
            `/api/admin/jobs?q=${prefix}&status=draft&status=published&pageSize=1&page=2`,
          )
        ).json();
        assert.notEqual(data.jobs[0].id, pageTwo.jobs[0].id);
        const page = await call(`/admin/jobs/${id}/edit?lang=en`, {
          cookie: true,
        });
        const html = await page.text();
        assert.equal(page.status, 200);
        assert.ok(html.includes(prefix));
        assert.ok(!html.includes("No changes will be saved"));
        const publicJob = await call(`/api/jobs/${slug}`, { user: null });
        assert.equal(publicJob.status, 200);
        assert.equal((await publicJob.json()).job.title.en, prefix);
      },
    );
    await t.test(
      "Draft isolation, overlapping saves and lifecycle writes",
      async () => {
        const changed = structuredClone(job.draft);
        changed.en.title = `${prefix} revised`;
        const saveBody = {
          slug,
          draft: changed,
          expectedVersion: job.version,
          requestId: randomUUID(),
        };
        const saves = await Promise.all([
          call(`/api/admin/jobs/${id}`, { method: "PATCH", body: saveBody }),
          call(`/api/admin/jobs/${id}`, {
            method: "PATCH",
            body: { ...saveBody, requestId: randomUUID() },
          }),
        ]);
        assert.deepEqual(saves.map((r) => r.status).sort(), [200, 409]);
        job = (await saves.find((r) => r.status === 200).json()).job;
        assert.equal(job.hasUnpublishedChanges, true);
        const pub = (
          await (await call(`/api/jobs/${slug}`, { user: null })).json()
        ).job;
        assert.equal(pub.title.en, prefix);
        assert.equal(pub.salary, undefined);
        await action("publish");
        assert.equal(job.hasUnpublishedChanges, false);
        await action("pause", hr);
        assert.equal(
          (await call(`/api/jobs/${slug}`, { user: null })).status,
          404,
        );
        await action("resume");
        assert.equal(
          (await call(`/api/jobs/${slug}`, { user: null })).status,
          200,
        );
        await action("close", hr);
        assert.equal(
          (await call(`/api/jobs/${slug}`, { user: null })).status,
          404,
        );
        const copy = randomUUID();
        assert.equal(
          (
            await call(`/api/admin/jobs/${id}/duplicate`, {
              user: hr,
              method: "POST",
              body: {
                id: copy,
                expectedVersion: job.version,
                requestId: randomUUID(),
              },
            })
          ).status,
          201,
        );
      },
    );
    await t.test(
      "BE04 field errors, bilingual round trips and publication schedules",
      async () => {
        const editor = randomUUID(),
          editorSlug = `job-${editor}`;
        const value = structuredClone(draft);
        value.zh.title = "　中文编辑器　";
        value.zh.responsibilities = [
          "　第一条　",
          "",
          "\t",
          "第二  条",
          "第二  条",
        ];
        value.en.title = "<script>plain text</script>";
        let response = await call("/api/admin/jobs", {
          user: hr,
          method: "POST",
          body: {
            id: editor,
            slug: editorSlug,
            draft: value,
            requestId: randomUUID(),
          },
        });
        assert.equal(response.status, 201);
        let current = (await response.json()).job;
        assert.deepEqual(current.draft.zh.responsibilities, [
          "第一条",
          "第二  条",
          "第二  条",
        ]);
        assert.equal(current.draft.en.title, value.en.title);
        const invalid = structuredClone(value);
        invalid.settings.salary = {
          min: 0.001,
          max: 1,
          currency: "USD",
          period: "MONTH",
        };
        response = await call(`/api/admin/jobs/${editor}`, {
          method: "PATCH",
          body: {
            draft: invalid,
            slug: editorSlug,
            expectedVersion: current.version,
            requestId: randomUUID(),
          },
        });
        assert.equal(response.status, 400);
        const error = await response.json();
        assert.equal(error.error, "validation_failed");
        assert.deepEqual(error.issues, [
          { field: "draft.settings.salary.min", code: "precision" },
        ]);
        assert.ok(!JSON.stringify(error).includes(value.en.title));
        assert.equal(
          (await (await call(`/api/admin/jobs/${editor}`)).json()).job.version,
          current.version,
        );
        const step = async (action, extra = {}) => {
          const r = await call(`/api/admin/jobs/${editor}/actions`, {
            method: "POST",
            body: {
              action,
              expectedVersion: current.version,
              requestId: randomUUID(),
              ...extra,
            },
          });
          assert.equal(r.status, 200);
          current = (await r.json()).job;
        };
        await step("submit");
        await step("publish");
        const published = current.draft.settings.publishAt;
        assert.ok(published);
        const html = await (
          await call(`/en/jobs/${editorSlug}`, { user: null })
        ).text();
        assert.ok(!html.includes("<script>plain text</script>"));
        assert.ok(html.includes("&lt;script&gt;plain text&lt;/script&gt;"));
        const edit = structuredClone(current.draft);
        edit.en.requirements = [];
        response = await call(`/api/admin/jobs/${editor}`, {
          method: "PATCH",
          body: {
            draft: edit,
            slug: editorSlug,
            expectedVersion: current.version,
            requestId: randomUUID(),
          },
        });
        assert.equal(response.status, 200);
        current = (await response.json()).job;
        response = await call(`/api/admin/jobs/${editor}/actions`, {
          method: "POST",
          body: {
            action: "publish",
            expectedVersion: current.version,
            requestId: randomUUID(),
          },
        });
        assert.equal(response.status, 400);
        assert.deepEqual((await response.json()).issues, [
          { field: "draft.en.requirements", code: "required" },
        ]);
        const englishVersion = structuredClone(current.draft.en);
        const chineseOnly = structuredClone(current.draft);
        chineseOnly.en = { title: "", responsibilities: [], requirements: [] };
        response = await call(`/api/admin/jobs/${editor}`, {
          method: "PATCH",
          body: {
            draft: chineseOnly,
            slug: editorSlug,
            expectedVersion: current.version,
            requestId: randomUUID(),
          },
        });
        assert.equal(response.status, 200);
        current = (await response.json()).job;
        await step("publish");
        assert.equal(current.draft.settings.publishAt, published);
        assert.equal(current.approvedChineseFallback, true);
        assert.deepEqual(current.draft.en.requirements, []);
        const publicJob = (
          await (await call(`/api/jobs/${editorSlug}`, { user: null })).json()
        ).job;
        assert.equal(publicJob.contentLanguage, "zh");
        assert.equal(publicJob.salary, undefined);
        const future = structuredClone(current.draft);
        future.en = { ...englishVersion, requirements: ["Complete English"] };
        future.settings.publishAt = "2098-01-01T10:00:00+02:00";
        future.settings.closeAt = "2098-01-02T08:00:00Z";
        response = await call(`/api/admin/jobs/${editor}`, {
          method: "PATCH",
          body: {
            draft: future,
            slug: editorSlug,
            expectedVersion: current.version,
            requestId: randomUUID(),
          },
        });
        assert.equal(response.status, 400);
        assert.deepEqual((await response.json()).issues, [
          { field: "draft.settings.publishAt", code: "locked" },
        ]);
        assert.equal(
          (await call(`/api/jobs/${editorSlug}`, { user: null })).status,
          200,
          "Rejected schedule leaves the published job unchanged",
        );
        await step("publish");
        assert.equal(
          (await call(`/api/jobs/${editorSlug}`, { user: null })).status,
          200,
        );
      },
    );
    await t.test(
      "Overlapping Cron calls drain bounded backlog and do not duplicate expiry events",
      async () => {
        const ids = Array.from({ length: 105 }, () => randomUUID());
        await db.query(
          `INSERT INTO portal.jobs(id,canonical_slug,draft_content,published_content,status,version,published_version,owner_id,approved_by,approved_at,department_id,job_type,experience,publish_at,close_at)
      SELECT id,'job-'||id::text,$2::jsonb,$2::jsonb,'PUBLISHED',1,1,$3,$3,statement_timestamp(),$4,'FULL_TIME','ANY',statement_timestamp()-interval '2 days',statement_timestamp()-interval '1 day'
      FROM unnest($1::uuid[]) id`,
          [ids, JSON.stringify(draft), lead.id, department],
        );
        // Hold one eligible row. SKIP LOCKED must leave it retryable and report backlog.
        const lock = await connectAuthTestDatabase(
          () =>
            new pg.Client({
              connectionString: process.env.DIRECT_URL,
              connectionTimeoutMillis: 15000,
            }),
        );
        try {
          await lock.query("BEGIN");
          await lock.query(
            "SELECT id FROM portal.jobs WHERE id=$1 FOR UPDATE",
            [ids[0]],
          );
          const results = await Promise.all([
            call("/api/internal/cron/close-expired-jobs", {
              user: null,
              cron: true,
            }),
            call("/api/internal/cron/close-expired-jobs", {
              user: null,
              cron: true,
            }),
          ]);
          for (const result of results) {
            assert.equal(result.status, 200);
            const data = await result.json();
            assert.ok(data.processed <= 1000);
            assert.equal(data.remaining, true);
          }
          assert.equal(
            (
              await db.query(
                "SELECT count(*)::int n FROM portal.jobs WHERE id=ANY($1::uuid[]) AND status='CLOSED'",
                [ids],
              )
            ).rows[0].n,
            104,
          );
          // Extend the held deadline before committing; the worker must use its new value.
          await lock.query(
            "UPDATE portal.jobs SET close_at=statement_timestamp()+interval '1 day',version=version+1 WHERE id=$1",
            [ids[0]],
          );
          await lock.query("COMMIT");
          const final = await call("/api/internal/cron/close-expired-jobs", {
            user: null,
            cron: true,
          });
          assert.equal(final.status, 200);
          assert.equal((await final.json()).remaining, false);
          const state = (
            await db.query("SELECT status FROM portal.jobs WHERE id=$1", [
              ids[0],
            ])
          ).rows[0];
          assert.equal(state.status, "PUBLISHED");
          const counts = (
            await db.query(
              "SELECT (SELECT count(*) FROM portal.audit_logs WHERE object_id=ANY($1::uuid[]) AND safe_changes->>'reason'='EXPIRED')::int a,(SELECT count(*) FROM portal.outbox_events WHERE aggregate_id=ANY($1::uuid[]) AND safe_references->>'reason'='EXPIRED')::int e",
              [ids],
            )
          ).rows[0];
          assert.deepEqual(counts, { a: 104, e: 104 });
        } finally {
          await lock.query("ROLLBACK").catch(() => {});
          await lock.end();
        }
      },
    );
  },
);
