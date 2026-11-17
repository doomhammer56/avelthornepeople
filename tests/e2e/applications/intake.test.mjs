import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import pg from "pg";
import { settingsContent } from "../../../src/lib/admin/settingsContent.ts";
import {
  loadAuthTestEnvironment,
  connectAuthTestDatabase,
} from "../../../scripts/auth/test-env.mjs";
const project = loadAuthTestEnvironment();
const publicUrl = new URL(process.env.PUBLIC_DATABASE_URL ?? "");
assert.ok(
  publicUrl.hostname === `db.${project}.supabase.co` ||
    (publicUrl.hostname.endsWith(".pooler.supabase.com") &&
      decodeURIComponent(publicUrl.username).endsWith(`.${project}`)),
  "Public reader must also target the dedicated test project",
);
process.env.CANDIDATE_ENCRYPTION_KEYS = JSON.stringify({
  1: randomBytes(32).toString("base64"),
});
process.env.CANDIDATE_MATCH_KEYS = JSON.stringify({
  1: randomBytes(32).toString("base64"),
});
process.env.CANDIDATE_ACTIVE_KEY_VERSION = "1";
const { createStaffSession } = await import("../../helpers/staff-session.mjs");
const { storageAdminClient } =
  await import("../../../src/server/adapters/storage/config.ts");
const { configureCvBuckets } =
  await import("../../../src/server/adapters/storage/buckets.ts");

test(
  "Built public intake uploads private unscanned CVs and Admin can edit all job reference lists",
  { timeout: 360000 },
  async (t) => {
    const db = await connectAuthTestDatabase(
      () =>
        new pg.Client({
          connectionString: process.env.DIRECT_URL,
          connectionTimeoutMillis: 15000,
          statement_timeout: 15000,
        }),
    );
    const storage = storageAdminClient(),
      users = [],
      refs = [],
      jobId = randomUUID();
    let child;
    t.after(async () => {
      if (child && child.exitCode === null) {
        const stopped = new Promise((resolve) => child.once("exit", resolve));
        child.kill();
        await stopped;
      }
      const uploads = (
        await db.query(
          "SELECT object_key FROM portal.uploads WHERE intake_job_id=$1",
          [jobId],
        )
      ).rows;
      let storageError = null;
      if (uploads.length)
        storageError = (
          await storage.storage
            .from("cv-quarantine")
            .remove(uploads.map((row) => row.object_key))
        ).error;
      try {
        await db.query("BEGIN");
        const apps = (
          await db.query(
            "SELECT id,candidate_id FROM portal.applications WHERE job_id=$1",
            [jobId],
          )
        ).rows;
        const ids = [jobId, ...refs.map((r) => r.id), ...apps.map((a) => a.id)];
        await db.query(
          "DELETE FROM portal.outbox_events WHERE aggregate_id=ANY($1::uuid[])",
          [ids],
        );
        await db.query(
          "DELETE FROM portal.audit_logs WHERE actor_id=ANY($1::uuid[]) OR object_id=ANY($2::uuid[])",
          [users.map((u) => u.id), ids],
        );
        await db.query("DELETE FROM portal.applications WHERE job_id=$1", [
          jobId,
        ]);
        await db.query(
          "DELETE FROM portal.candidates WHERE id=ANY($1::uuid[])",
          [apps.map((a) => a.candidate_id)],
        );
        await db.query("DELETE FROM portal.uploads WHERE intake_job_id=$1", [
          jobId,
        ]);
        await db.query("DELETE FROM portal.daily_metrics WHERE job_id=$1", [
          jobId,
        ]);
        await db.query("DELETE FROM portal.jobs WHERE id=$1", [jobId]);
        for (const table of ["departments", "locations", "job_options"])
          await db.query(
            `DELETE FROM portal.${table} WHERE id=ANY($1::uuid[])`,
            [refs.map((r) => r.id)],
          );
        await db.query(
          "DELETE FROM portal_private.reference_commands WHERE actor_id=ANY($1::uuid[])",
          [users.map((u) => u.id)],
        );
        await db.query(
          "DELETE FROM portal_private.staff_session_admissions WHERE subject_id=ANY($1::uuid[])",
          [users.map((u) => u.id)],
        );
        await db.query(
          "DELETE FROM portal.staff_profiles WHERE id=ANY($1::uuid[])",
          [users.map((u) => u.id)],
        );
        await db.query("COMMIT");
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        await db.end();
        for (const user of users) await user.remove();
      }
      assert.equal(
        storageError,
        null,
        "Synthetic storage objects must be removed",
      );
    });
    await configureCvBuckets(storage, true);
    for (const role of ["ADMIN", "HR", "READ_ONLY"])
      users.push(await createStaffSession(db, role));
    const [admin, hr, reader] = users;
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
          AUTH_TRUSTED_IP_HEADER: "x-vercel-forwarded-for",
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
        const r = await fetch(origin + "/api/admin/settings", {
          method: "POST",
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
    assert.ok(ready, "Built server must start");
    const testIp = `192.0.2.${Math.floor(Math.random() * 200) + 1}`;
    async function call(
      path,
      { body, user, method = body ? "POST" : "GET", key, cross = false } = {},
    ) {
      return fetch(origin + path, {
        method,
        headers: {
          Origin: cross ? "https://outside.invalid" : origin,
          "Content-Type": "application/json",
          "x-vercel-forwarded-for": testIp,
          ...(user ? { Authorization: `Bearer ${user.token}` } : {}),
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      });
    }
    for (const category of [
      "department",
      "location",
      "jobType",
      "experience",
    ]) {
      const item = {
        id: randomUUID(),
        category,
        code: `TEST_${randomUUID().replaceAll("-", "").toUpperCase()}`,
      };
      refs.push(item);
      const command = {
        category,
        id: item.id,
        expectedVersion: 0,
        requestId: randomUUID(),
        value: {
          code: item.code,
          nameEn: `HTTP ${category}`,
          nameZh: `测试 ${category}`,
          active: true,
          ...(category === "location"
            ? { countryCode: "MY", timeZone: "Asia/Kuala_Lumpur" }
            : {}),
        },
      };
      for (const user of [hr, reader])
        assert.equal(
          (await call("/api/admin/settings", { body: command, user })).status,
          403,
        );
      const created = await call("/api/admin/settings", {
        body: command,
        user: admin,
      });
      assert.equal(created.status, 200);
      assert.equal((await created.json()).item.version, 1);
      const edit = {
        ...command,
        expectedVersion: 1,
        requestId: randomUUID(),
        value: { ...command.value, nameEn: `Updated ${category}` },
      };
      assert.equal(
        (await call("/api/admin/settings", { body: edit, user: admin })).status,
        200,
      );
      assert.equal(
        (
          await call("/api/admin/settings", {
            body: { ...edit, requestId: randomUUID() },
            user: admin,
          })
        ).status,
        409,
      );
    }
    const draft = {
      en: {
        title: "Intake HTTP role",
        responsibilities: ["Support applicants"],
        requirements: ["Relevant experience"],
      },
      zh: {
        title: "测试职位",
        responsibilities: ["支持申请人"],
        requirements: ["相关经验"],
      },
      settings: {
        departmentId: refs[0].id,
        locationIds: [refs[1].id],
        jobType: refs[2].code,
        experience: refs[3].code,
        salary: null,
        showSalary: false,
        publishAt: null,
        closeAt: null,
      },
    };
    const slug = `intake-http-${randomUUID()}`;
    const created = await call("/api/admin/jobs", {
      user: admin,
      body: { id: jobId, requestId: randomUUID(), slug, draft },
    });
    assert.equal(created.status, 201);
    let job = (await created.json()).job;
    for (const action of ["submit", "publish"]) {
      const r = await call(`/api/admin/jobs/${jobId}/actions`, {
        user: admin,
        body: { requestId: randomUUID(), expectedVersion: job.version, action },
      });
      assert.equal(r.status, 200);
      job = (await r.json()).job;
    }
    const publicJobs = await call("/api/jobs");
    assert.equal(publicJobs.status, 200);
    assert.equal(
      (await publicJobs.json()).jobs.find((j) => j.id === jobId).type.en,
      "Updated jobType",
    );
    const page = await call(`/en/jobs/${slug}`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes('"employmentType":"OTHER"'));
    assert.ok(html.includes("/api/applications/uploads"));
    const settingsPage = await fetch(origin + "/admin/settings?lang=en", {
      headers: { Cookie: admin.cookie },
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(settingsPage.status, 200);
    const settingsHtml = await settingsPage.text();
    assert.ok(settingsHtml.includes("Updated department"));
    assert.ok(settingsHtml.includes(settingsContent.en.adding));
    const editorPage = await fetch(
      origin + `/admin/jobs/${jobId}/edit?lang=en`,
      { headers: { Cookie: admin.cookie }, signal: AbortSignal.timeout(30000) },
    );
    assert.equal(editorPage.status, 200);
    const editorHtml = await editorPage.text();
    // The wizard initially renders content step 1; settings arrive as props for step 2.
    assert.ok(editorHtml.includes(refs[2].code));
    assert.ok(editorHtml.includes("Updated jobType"));
    const requestId = randomUUID(),
      file = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF");
    const uploadBody = {
      jobId,
      fileName: "synthetic.pdf",
      contentType: "application/pdf",
      size: file.length,
    };
    assert.equal(
      (
        await call("/api/applications/uploads", {
          body: uploadBody,
          key: requestId,
          cross: true,
        })
      ).status,
      403,
    );
    const upload = await call("/api/applications/uploads", {
      body: uploadBody,
      key: requestId,
    });
    assert.equal(upload.status, 201);
    const grant = await upload.json();
    const put = await fetch(grant.uploadUrl, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": "application/pdf" },
      signal: AbortSignal.timeout(20000),
    });
    assert.ok(put.ok);
    const body = {
      jobId,
      locale: "en",
      name: "Synthetic applicant",
      email: `intake-${randomUUID()}@example.invalid`,
      phone: "+250788123456",
      coverLetter: "Synthetic cover letter",
      resumeToken: grant.resumeToken,
      consent: true,
      consentVersion: "recruitment-24-months-v1",
      captchaToken: "e2e-turnstile-placeholder",
    };
    const accepted = await call("/api/applications", { body, key: requestId });
    assert.equal(accepted.status, 201);
    assert.deepEqual(await accepted.json(), {
      status: "accepted",
      confirmationEmailSent: false,
    });
    const retry = await call("/api/applications", { body, key: requestId });
    assert.equal(retry.status, 201);
    assert.equal((await retry.json()).status, "duplicate");
    assert.equal(
      (
        await call("/api/applications", {
          body: { ...body, name: "Changed" },
          key: requestId,
        })
      ).status,
      409,
    );
    const list = await call(`/api/admin/applications?jobId=${jobId}`, {
      user: hr,
    });
    assert.equal(list.status, 200);
    const applications = (await list.json()).applications;
    assert.equal(applications.length, 1);
    assert.equal(applications[0].name, body.name);
    assert.equal(applications[0].cvAvailable, true);
    assert.equal(applications[0].cvUnscanned, true);
    const details = await call(
      `/api/admin/applications/${applications[0].id}`,
      { user: hr },
    );
    assert.equal((await details.json()).coverLetter, body.coverLetter);
    const cvPath = `/api/admin/applications/${applications[0].id}/cv-url?mode=preview`;
    assert.equal(
      (await call(cvPath, { method: "POST", user: reader })).status,
      403,
    );
    const download = await call(cvPath, { method: "POST", user: hr });
    assert.equal(download.status, 200);
    const signed = await download.json();
    assert.equal(signed.disposition, "inline");
    const bytes = await fetch(signed.url);
    assert.ok(bytes.ok);
    assert.deepEqual(Buffer.from(await bytes.arrayBuffer()), file);
    assert.ok(
      !bytes.headers.get("content-disposition")?.includes("attachment"),
    );
    const explicitDownload = await call(
      `/api/admin/applications/${applications[0].id}/cv-url?mode=download`,
      { method: "POST", user: hr },
    );
    assert.equal(explicitDownload.status, 200);
    const attachment = await explicitDownload.json();
    assert.equal(attachment.disposition, "attachment");
    const downloaded = await fetch(attachment.url);
    assert.ok(downloaded.ok);
    assert.ok(
      downloaded.headers.get("content-disposition")?.includes("attachment"),
    );
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), file);
    const badKey = randomUUID(),
      badBytes = Buffer.from("<script>");
    const badGrantResponse = await call("/api/applications/uploads", {
      body: { ...uploadBody, size: badBytes.length },
      key: badKey,
    });
    assert.equal(badGrantResponse.status, 201);
    const badGrant = await badGrantResponse.json();
    assert.ok(
      (
        await fetch(badGrant.uploadUrl, {
          method: "PUT",
          body: badBytes,
          headers: { "Content-Type": "application/pdf" },
          signal: AbortSignal.timeout(20000),
        })
      ).ok,
    );
    assert.equal(
      (
        await call("/api/applications", {
          body: { ...body, resumeToken: badGrant.resumeToken },
          key: badKey,
        })
      ).status,
      400,
    );
    assert.equal(
      (await call("/api/internal/cron/cleanup-application-uploads")).status,
      401,
    );
    await db.query("UPDATE portal.locations SET active=false WHERE id=$1", [
      refs[1].id,
    ]);
    assert.equal(
      (
        await call("/api/applications/uploads", {
          body: uploadBody,
          key: randomUUID(),
        })
      ).status,
      410,
    );
    const hidden = await call("/api/jobs");
    assert.equal(hidden.status, 200);
    assert.equal(
      (await hidden.json()).jobs.some((j) => j.id === jobId),
      false,
    );
    await db.query("UPDATE portal.locations SET active=true WHERE id=$1", [
      refs[1].id,
    ]);
    await db.query("UPDATE portal.jobs SET status='CLOSED' WHERE id=$1", [
      jobId,
    ]);
    assert.equal(
      (
        await call("/api/applications/uploads", {
          body: uploadBody,
          key: randomUUID(),
        })
      ).status,
      410,
    );
  },
);
