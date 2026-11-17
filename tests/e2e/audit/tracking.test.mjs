import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import pg from "pg";
import {
  loadAuthTestEnvironment,
  connectAuthTestDatabase,
} from "../../../scripts/auth/test-env.mjs";
loadAuthTestEnvironment();
const { createStaffSession } = await import("../../helpers/staff-session.mjs");

test(
  "Built audit API and EN/ZH console expose only safe ADMIN-scoped events",
  { timeout: 180000 },
  async (t) => {
    const db = await connectAuthTestDatabase(
      () =>
        new pg.Client({
          connectionString: process.env.DIRECT_URL,
          connectionTimeoutMillis: 15000,
          statement_timeout: 15000,
        }),
    );
    const users = [],
      ids = [],
      target = randomUUID(),
      contentId = randomUUID(),
      request = randomUUID();
    let child;
    t.after(async () => {
      if (child && child.exitCode === null) {
        const stopped = new Promise((r) => child.once("exit", r));
        child.kill();
        await stopped;
      }
      try {
        await db.query(
          "DELETE FROM portal.audit_logs WHERE id=ANY($1::uuid[])",
          [ids],
        );
        await db.query("DELETE FROM portal.jobs WHERE id=$1", [target]);
        await db.query("DELETE FROM portal.content_blocks WHERE id=$1", [
          contentId,
        ]);
        await db.query(
          "DELETE FROM portal_private.staff_session_admissions WHERE subject_id=ANY($1::uuid[])",
          [users.map((u) => u.id)],
        );
        await db.query(
          "DELETE FROM portal.staff_profiles WHERE id=ANY($1::uuid[])",
          [users.map((u) => u.id)],
        );
      } finally {
        await db.end();
        for (const u of users) await u.remove();
      }
    });
    for (const role of ["ADMIN", "HR", "READ_ONLY"])
      users.push(await createStaffSession(db, role));
    const [admin, hr, reader] = users;
    await db.query(
      "UPDATE portal.staff_profiles SET display_name='Private Actor Canary' WHERE id=$1",
      [hr.id],
    );
    await db.query(
      "INSERT INTO portal.jobs(id,canonical_slug,draft_content,owner_id) VALUES($1,$2,$3::jsonb,$4)",
      [
        target,
        `audit-display-${target}`,
        JSON.stringify({
          en: { title: "Readable Job Canary" },
          zh: { title: "可读职位测试" },
        }),
        hr.id,
      ],
    );
    await db.query(
      "INSERT INTO portal.content_blocks(id,type,draft_content) VALUES($1,'BANNER','{}')",
      [contentId],
    );
    for (let i = 0; i < 5; i++) {
      const id = randomUUID();
      ids.push(id);
      await db.query(
        "INSERT INTO portal.audit_logs(id,actor_id,object_type,object_id,action,safe_changes,request_id,created_at) VALUES($1,$2,'JOB',$3,'JOB_SAVE',$4::jsonb,$5,'2026-10-26T09:00:00Z')",
        [id, hr.id, target, JSON.stringify({ version: i + 1 }), request],
      );
    }
    const contentAudit = randomUUID();
    ids.push(contentAudit);
    await db.query(
      "INSERT INTO portal.audit_logs(id,actor_id,object_type,object_id,action,request_id) VALUES($1,$2,'CONTENT',$3,'CONTENT_SEEDED',$4)",
      [contentAudit, hr.id, contentId, request],
    );
    const probe = createServer();
    await new Promise((r) => probe.listen(0, "127.0.0.1", r));
    const port = probe.address().port;
    await new Promise((r) => probe.close(r));
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
        env: { ...process.env, AUTH_APP_ORIGIN: origin },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    child.stdout.on("data", () => {});
    child.stderr.on("data", () => {});
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try {
        const r = await fetch(origin + "/api/admin/audit", {
          signal: AbortSignal.timeout(1000),
        });
        await r.body?.cancel();
        if (r.status === 401) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(ready, "Build the app before running the audit HTTP suite.");
    function call(path, user = admin, cookie = false) {
      return fetch(origin + path, {
        headers: user
          ? cookie
            ? { Cookie: user.cookie }
            : { Authorization: `Bearer ${user.token}` }
          : {},
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
      });
    }
    const base = `/api/admin/audit?actorId=${hr.id}&objectId=${target}&action=JOB_SAVE&objectType=JOB&requestId=${request}&pageSize=2&from=2026-10-26T08:59:00Z&to=2026-10-26T09:01:00Z`;
    await t.test(
      "anonymous/HR/READ_ONLY are denied and responses are private",
      async () => {
        for (const [user, status] of [
          [null, 401],
          [hr, 403],
          [reader, 403],
        ]) {
          const r = await call("/api/admin/audit", user);
          assert.equal(r.status, status);
          assert.match(r.headers.get("cache-control"), /no-store/);
        }
      },
    );
    await t.test(
      "exact filters paginate with current staff/job labels while stored events exclude names",
      async () => {
        const sorted = ids.slice(0, 5).sort().reverse();
        for (const page of [1, 2, 3]) {
          const r = await call(`${base}&page=${page}`);
          assert.equal(r.status, 200);
          assert.match(r.headers.get("cache-control"), /private.*no-store/);
          const data = await r.json();
          assert.deepEqual(
            data.entries.map((e) => e.id),
            sorted.slice((page - 1) * 2, page * 2),
          );
          assert.equal(data.hasMore, page < 3);
          assert.ok(
            data.entries.every(
              (e) =>
                e.actorId === hr.id &&
                e.objectId === target &&
                e.detailsAvailable,
            ),
          );
          assert.ok(
            data.entries.every(
              (e) =>
                e.actorName === "Private Actor Canary" &&
                e.objectLabel.en === "Readable Job Canary",
            ),
          );
        }
        assert.equal(
          (
            await (
              await call(`/api/admin/audit?actorId=${hr.id}&action=JOB_CLOSE`)
            ).json()
          ).entries.length,
          0,
        );
        const stored = (
          await db.query(
            "SELECT safe_changes FROM portal.audit_logs WHERE id=ANY($1::uuid[])",
            [ids],
          )
        ).rows;
        assert.ok(!JSON.stringify(stored).includes("Private Actor Canary"));
        assert.ok(!JSON.stringify(stored).includes("Readable Job Canary"));
        const content = await (
          await call(`/api/admin/audit?objectId=${contentId}`)
        ).json();
        assert.equal(content.entries[0].objectLabel.en, "Home banner");
      },
    );
    await t.test(
      "malformed/duplicate/free-text query fields fail safely and no audit insert endpoint exists",
      async () => {
        for (const query of [
          "page=0",
          "pageSize=101",
          "page=1&page=2",
          "actorId=private@example.invalid",
          "search=private@example.invalid",
          "action=private@example.invalid",
        ]) {
          const r = await call("/api/admin/audit?" + query);
          assert.equal(r.status, 400);
          assert.ok(!(await r.text()).includes("private@example.invalid"));
        }
        assert.equal(
          (
            await fetch(origin + "/api/admin/audit", {
              method: "POST",
              headers: { Authorization: `Bearer ${admin.token}` },
            })
          ).status,
          405,
        );
      },
    );
    await t.test(
      "both console translations use real filtered audit data and safe details",
      async () => {
        for (const lang of ["en", "zh"]) {
          const r = await call(
            `/admin/log?lang=${lang}&actorId=${hr.id}&objectId=${target}&pageSize=2`,
            admin,
            true,
          );
          assert.equal(r.status, 200);
          const html = await r.text();
          assert.ok(html.includes(target) && html.includes("JOB_SAVE"));
          assert.ok(html.includes("Private Actor Canary"));
          assert.ok(
            html.includes(lang === "en" ? "Job draft saved" : "保存职位草稿"),
          );
          assert.ok(
            html.includes(
              lang === "en" ? "Readable Job Canary" : "可读职位测试",
            ),
          );
          assert.ok(html.includes(lang === "en" ? "Next" : "下一页"));
        }
      },
    );
  },
);
