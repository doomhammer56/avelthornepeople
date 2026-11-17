import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import pg from "pg";
import {
  loadAuthTestEnvironment,
  connectAuthTestDatabase,
} from "../../../scripts/auth/test-env.mjs";
loadAuthTestEnvironment();
process.env.CANDIDATE_ENCRYPTION_KEYS = JSON.stringify({
  1: randomBytes(32).toString("base64"),
  2: randomBytes(32).toString("base64"),
});
process.env.CANDIDATE_MATCH_KEYS = JSON.stringify({
  1: randomBytes(32).toString("base64"),
  2: randomBytes(32).toString("base64"),
});
process.env.CANDIDATE_ACTIVE_KEY_VERSION = "2";
const { encryptedCandidate, encryptProfileValue } =
  await import("../../../src/server/candidates/crypto.ts");
const { authAdminClient } =
  await import("../../../src/server/adapters/auth/admin.ts");
const { identityClient } =
  await import("../../../src/server/adapters/auth/config.ts");
test(
  "Built application/candidate APIs use restricted connections and real synthetic encrypted profiles",
  { timeout: 300000 },
  async (t) => {
    const db = await connectAuthTestDatabase(
      () =>
        new pg.Client({
          connectionString: process.env.DIRECT_URL,
          connectionTimeoutMillis: 15000,
          statement_timeout: 15000,
        }),
    );
    const admin = authAdminClient(),
      users = [],
      candidateIds = [],
      appIds = [],
      uploadIds = [];
    let child, job;
    t.after(async () => {
      if (child && child.exitCode === null) {
        const stopped = new Promise((resolve) => child.once("exit", resolve));
        child.kill();
        await stopped;
      }
      try {
        await db.query("BEGIN");
        await db.query(
          "DELETE FROM portal_private.recruitment_commands WHERE actor_id=ANY($1::uuid[])",
          [users.map((u) => u.id)],
        );
        await db.query(
          "DELETE FROM portal.outbox_events WHERE aggregate_id=ANY($1::uuid[])",
          [[...candidateIds, ...appIds]],
        );
        await db.query(
          "DELETE FROM portal.audit_logs WHERE actor_id=ANY($1::uuid[]) OR object_id=ANY($2::uuid[])",
          [users.map((u) => u.id), [...candidateIds, ...appIds]],
        );
        await db.query(
          "DELETE FROM portal.deletion_requests WHERE candidate_id=ANY($1::uuid[])",
          [candidateIds],
        );
        await db.query(
          "DELETE FROM portal.applications WHERE id=ANY($1::uuid[])",
          [appIds],
        );
        await db.query("DELETE FROM portal.uploads WHERE id=ANY($1::uuid[])", [
          uploadIds,
        ]);
        await db.query(
          "UPDATE portal.candidates SET merged_into_id=NULL WHERE id=ANY($1::uuid[])",
          [candidateIds],
        );
        await db.query(
          "DELETE FROM portal.candidates WHERE id=ANY($1::uuid[])",
          [candidateIds],
        );
        if (job) await db.query("DELETE FROM portal.jobs WHERE id=$1", [job]);
        await db.query(
          "DELETE FROM portal.staff_profiles WHERE id=ANY($1::uuid[])",
          [users.map((u) => u.id)],
        );
        await db.query("COMMIT");
      } finally {
        await db.end();
        for (const u of users)
          assert.equal((await admin.auth.admin.deleteUser(u.id)).error, null);
      }
    });
    for (const role of ["ADMIN", "HR", "READ_ONLY"]) {
      const email = `be05-http-${randomUUID()}@example.invalid`;
      const created = await admin.auth.admin.createUser({
        email,
        password: randomBytes(32).toString("base64url"),
        email_confirm: true,
      });
      assert.equal(created.error, null);
      const user = { ...created.data.user, role };
      users.push(user);
      await db.query(
        "INSERT INTO portal.staff_profiles(id,display_name,role,active) VALUES($1,'BE05 HTTP',$2,true)",
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
        "INSERT INTO portal_private.staff_session_admissions(session_id,subject_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
        [session, user.id],
      );
    }
    const [lead, hr, reader] = users;
    job = (
      await db.query(
        "INSERT INTO portal.jobs(canonical_slug,draft_content,owner_id) VALUES($1,$2,$3) RETURNING id",
        [
          `be05-http-${randomUUID()}`,
          JSON.stringify({
            zh: { title: "BE05 synthetic job" },
            en: { title: "BE05 synthetic job" },
          }),
          lead.id,
        ],
      )
    ).rows[0].id;
    const email = `match-${randomUUID()}@example.invalid`;
    async function candidate(profile, keyVersion = 2) {
      const id = randomUUID();
      process.env.CANDIDATE_ACTIVE_KEY_VERSION = String(keyVersion);
      const p = encryptedCandidate(id, profile);
      process.env.CANDIDATE_ACTIVE_KEY_VERSION = "2";
      await db.query(
        "INSERT INTO portal.candidates(id,name_encrypted,email_encrypted,phone_encrypted,email_hmac,phone_hmac,hmac_key_version) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          id,
          p.nameEncrypted,
          p.emailEncrypted,
          p.phoneEncrypted,
          p.emailHmac,
          p.phoneHmac,
          p.hmacKeyVersion,
        ],
      );
      candidateIds.push(id);
      return id;
    }
    async function application(
      candidateId,
      profile,
      status = "NEW",
      confirmed = true,
    ) {
      const upload = randomUUID(),
        id = randomUUID();
      await db.query(
        "INSERT INTO portal.uploads(id,storage_provider,bucket,object_key,declared_size_bytes,size_bytes,detected_type,sha256,scan_state,scanned_at,capability_hash,capability_expires_at) VALUES($1,'SUPABASE','cv-clean',$2,100,100,'application/pdf',$3,'CLEAN',now(),$4,now()+interval '1 hour')",
        [upload, `be05/${randomUUID()}`, randomBytes(32), randomBytes(32)],
      );
      uploadIds.push(upload);
      await db.query(
        "INSERT INTO portal.applications(id,job_id,candidate_id,cv_upload_id,cv_scan_state,intake_state,status,profile_encrypted,consent_at,policy_version,source,locale,idempotency_key,payload_digest,receipt_hash,receipt_expires_at,confirmed_at) VALUES($1,$2,$3,$4,'CLEAN',$5,$6,$7,now(),'be05-v1','CAREERS','en',$8,$9,$10,now()+interval '1 hour',CASE WHEN $5='CONFIRMED' THEN now() ELSE NULL END)",
        [
          id,
          job,
          candidateId,
          upload,
          confirmed ? "CONFIRMED" : "RECEIVED",
          status,
          encryptProfileValue(profile, `application:${id}:profile`),
          randomUUID(),
          randomBytes(32),
          randomBytes(32),
        ],
      );
      appIds.push(id);
      return id;
    }
    const profile = {
      name: "BE05 synthetic target",
      email,
      phone: "+250788123456",
    };
    const a = await candidate(profile),
      b = await candidate({ ...profile, name: "BE05 synthetic duplicate" }, 1),
      c = await candidate({
        ...profile,
        name: "BE05 email-only",
        phone: "+12133734253",
      }),
      d = await candidate({
        ...profile,
        name: "BE05 phone-only",
        email: `other-${randomUUID()}@example.invalid`,
      });
    const app = await application(a, profile),
      second = await application(
        b,
        { ...profile, name: "Original submission" },
        "SCREENING",
      ),
      third = await application(
        c,
        { ...profile, phone: "+12133734253" },
        "OFFER",
      ),
      pending = await application(d, profile, "NEW", false);
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
        const response = await fetch(origin + "/api/admin/applications", {
          signal: AbortSignal.timeout(1000),
        });
        await response.body?.cancel();
        if (response.status === 401) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.ok(ready, "Built server did not start");
    async function call(
      path,
      { user = lead, method = "GET", body, cookie = false, cross = false } = {},
    ) {
      const headers = {};
      if (user)
        headers[cookie ? "cookie" : "authorization"] = cookie
          ? user.cookie
          : `Bearer ${user.token}`;
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
    const list = `/api/admin/applications?jobId=${job}`;
    await t.test(
      "Anonymous and READ_ONLY access are denied; responses are private/no-store",
      async () => {
        assert.equal((await call(list, { user: null })).status, 401);
        assert.equal((await call(list, { user: reader })).status, 403);
        assert.equal(
          (await call(`/api/admin/candidates/${a}`, { user: reader })).status,
          403,
        );
        const response = await call(list);
        assert.match(response.headers.get("cache-control"), /no-store/);
      },
    );
    await t.test(
      "Lists paginate with server stage counts, decrypt profiles and exclude unconfirmed intake",
      async () => {
        let response = await call(list + "&pageSize=1");
        assert.equal(response.status, 200);
        const data = await response.json();
        assert.equal(data.total, 3);
        assert.equal(data.applications.length, 1);
        assert.deepEqual(data.counts, {
          NEW: 1,
          SCREENING: 1,
          INTERVIEW: 0,
          OFFER: 1,
          REJECTED: 0,
        });
        assert.equal(data.applications[0].profileAvailable, true);
        assert.ok(data.applications[0].email);
        response = await call(list + "&status=NEW&status=OFFER&status=NEW");
        assert.equal((await response.json()).total, 2);
        assert.equal(
          (await call(`/api/admin/applications/${pending}`)).status,
          404,
        );
      },
    );
    await t.test(
      "Exact normalized contact search supports key versions and never needs PII URLs",
      async () => {
        const response = await call("/api/admin/applications/search", {
          method: "POST",
          body: { jobId: job, email: email.toUpperCase() },
        });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).total, 3);
        assert.equal(
          (await call(list + "&email=private@example.invalid")).status,
          400,
        );
        assert.equal(
          (
            await call("/api/admin/applications/search", {
              method: "POST",
              body: { jobId: job, phone: "0788123456" },
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      "Matching ranks both contacts first across old/new hash versions and flags split identities",
      async () => {
        const response = await call(`/api/admin/candidates/${a}/matches`);
        assert.equal(response.status, 200);
        const data = await response.json();
        assert.equal(data.total, 3);
        assert.equal(data.matches[0].candidate.id, b);
        assert.equal(data.matches[0].reason, "both");
        assert.ok(data.matches.every((m) => m.conflict));
        assert.equal(new Set(data.matches.map((m) => m.reason)).size, 3);
      },
    );
    await t.test(
      "Stage changes persist with replay/conflict and CSRF protections",
      async () => {
        const body = {
          status: "INTERVIEW",
          expectedVersion: 1,
          requestId: randomUUID(),
        };
        assert.equal(
          (
            await call(`/api/admin/applications/${app}`, {
              user: hr,
              method: "PATCH",
              body,
              cookie: true,
              cross: true,
            })
          ).status,
          403,
        );
        const response = await call(`/api/admin/applications/${app}`, {
          user: hr,
          method: "PATCH",
          body,
        });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).result.version, 2);
        assert.equal(
          (
            await call(`/api/admin/applications/${app}`, {
              user: hr,
              method: "PATCH",
              body,
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await call(`/api/admin/applications/${app}`, {
              user: hr,
              method: "PATCH",
              body: { ...body, status: "OFFER" },
            })
          ).status,
          409,
        );
        const saved = await (
          await call(`/api/admin/applications/${app}`)
        ).json();
        assert.equal(saved.application.status, "Interview");
        assert.equal(saved.submittedProfile.name, profile.name);
      },
    );
    await t.test(
      "Merge preserves application totals, snapshots and aliases, and replays the same request",
      async () => {
        const body = {
          sourceId: b,
          sourceVersion: 1,
          expectedVersion: 1,
          requestId: randomUUID(),
        };
        let response = await call(`/api/admin/candidates/${a}/merge`, {
          method: "POST",
          body,
        });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).result.applicationsMoved, 1);
        assert.equal(
          (
            await call(`/api/admin/candidates/${a}/merge`, {
              method: "POST",
              body,
            })
          ).status,
          200,
        );
        const alias = await (await call(`/api/admin/candidates/${b}`)).json();
        assert.equal(alias.candidate.id, a);
        assert.equal(alias.history.total, 2);
        const saved = await (
          await call(`/api/admin/applications/${second}`)
        ).json();
        assert.equal(saved.application.candidateId, a);
        assert.equal(saved.submittedProfile.name, "Original submission");
        assert.equal((await (await call(list)).json()).total, 3);
        assert.equal(
          (await (await call(`/api/admin/candidates/${a}/matches`)).json())
            .total,
          2,
        );
      },
    );
    await t.test(
      "Alias contact lookup remains available after merging a distinct contact",
      async () => {
        const response = await call(`/api/admin/candidates/${a}/merge`, {
          method: "POST",
          body: {
            sourceId: c,
            sourceVersion: 1,
            expectedVersion: 2,
            requestId: randomUUID(),
          },
        });
        assert.equal(response.status, 200);
        const search = await call("/api/admin/applications/search", {
          method: "POST",
          body: { jobId: job, phone: "+12133734253" },
        });
        assert.equal((await search.json()).total, 3);
      },
    );
    await t.test(
      "Concurrent merges of the same source have one winner and one conflict",
      async () => {
        const x = await candidate({
            ...profile,
            email: `x-${randomUUID()}@example.invalid`,
          }),
          y = await candidate({
            ...profile,
            email: `y-${randomUUID()}@example.invalid`,
          }),
          z = await candidate({
            ...profile,
            email: `z-${randomUUID()}@example.invalid`,
          });
        const replies = await Promise.all(
          [y, z].map((target) =>
            call(`/api/admin/candidates/${target}/merge`, {
              method: "POST",
              body: {
                sourceId: x,
                sourceVersion: 1,
                expectedVersion: 1,
                requestId: randomUUID(),
              },
            }),
          ),
        );
        assert.deepEqual(replies.map((r) => r.status).sort(), [200, 409]);
      },
    );
    await t.test(
      "Concurrent attachments are included and deletion requests prevent a waiting merge",
      async () => {
        async function waitForIdentityLock() {
          for (let i = 0; i < 40; i++) {
            const { rows } = await db.query(
              "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=72705 AND objid=1 AND NOT granted) waiting",
            );
            if (rows[0].waiting) return;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          assert.fail("Merge did not wait for the identity lock");
        }
        const source = await candidate({
            ...profile,
            email: `attach-${randomUUID()}@example.invalid`,
          }),
          target = await candidate({
            ...profile,
            email: `target-${randomUUID()}@example.invalid`,
          });
        let merging, attached;
        await db.query("BEGIN");
        try {
          attached = await application(source, profile);
          merging = call(`/api/admin/candidates/${target}/merge`, {
            method: "POST",
            body: {
              sourceId: source,
              sourceVersion: 1,
              expectedVersion: 1,
              requestId: randomUUID(),
            },
          });
          await waitForIdentityLock();
          await db.query("COMMIT");
        } catch (error) {
          await db.query("ROLLBACK");
          if (merging) await merging;
          throw error;
        }
        let response = await merging;
        assert.equal(response.status, 200);
        assert.equal((await response.json()).result.applicationsMoved, 1);
        assert.equal(
          (
            await db.query(
              "SELECT candidate_id FROM portal.applications WHERE id=$1",
              [attached],
            )
          ).rows[0].candidate_id,
          target,
        );
        const blockedSource = await candidate({
            ...profile,
            email: `delete-${randomUUID()}@example.invalid`,
          }),
          blockedTarget = await candidate({
            ...profile,
            email: `survivor-${randomUUID()}@example.invalid`,
          });
        await db.query("BEGIN");
        try {
          await db.query(
            "INSERT INTO portal.deletion_requests(candidate_id,verified_requester_ref,reason_code,due_at) VALUES($1,$2,'TEST',now()+interval '1 day')",
            [blockedSource, randomUUID()],
          );
          merging = call(`/api/admin/candidates/${blockedTarget}/merge`, {
            method: "POST",
            body: {
              sourceId: blockedSource,
              sourceVersion: 1,
              expectedVersion: 1,
              requestId: randomUUID(),
            },
          });
          await waitForIdentityLock();
          await db.query("COMMIT");
        } catch (error) {
          await db.query("ROLLBACK");
          if (merging) await merging;
          throw error;
        }
        response = await merging;
        assert.equal(response.status, 409);
        assert.equal(
          (
            await db.query(
              "SELECT merged_into_id FROM portal.candidates WHERE id=$1",
              [blockedSource],
            )
          ).rows[0].merged_into_id,
          null,
        );
      },
    );
    await t.test(
      "Deletion on a merged alias removes group PII and CV eligibility",
      async () => {
        await db.query(
          "INSERT INTO portal.deletion_requests(candidate_id,verified_requester_ref,reason_code,due_at) VALUES($1,$2,'TEST',now()+interval '1 day')",
          [b, randomUUID()],
        );
        const data = await (
          await call(`/api/admin/applications/${third}`)
        ).json();
        assert.equal(data.application.cvAvailable, false);
        assert.equal(data.application.name, "");
        assert.equal(data.submittedProfile, null);
        assert.equal(data.candidate.mergeAllowed, false);
        assert.equal(
          (await call(`/api/admin/candidates/${a}/matches`)).status,
          409,
        );
      },
    );
    await t.test(
      "Unknown encrypted profiles remain explicit and cannot be merged",
      async () => {
        const id = await candidate({
          ...profile,
          email: `unreadable-${randomUUID()}@example.invalid`,
        });
        await db.query(
          "UPDATE portal.candidates SET name_encrypted=$2 WHERE id=$1",
          [id, randomBytes(48)],
        );
        const response = await call(`/api/admin/candidates/${id}`);
        assert.equal(response.status, 200);
        const text = await response.text();
        const data = JSON.parse(text);
        assert.equal(data.candidate.profileAvailable, false);
        assert.equal(data.candidate.mergeAllowed, false);
        assert.ok(!text.includes("name_encrypted"));
        assert.ok(!text.includes("email_hmac"));
        assert.equal(
          (await call(`/api/admin/candidates/${id}/matches`)).status,
          503,
        );
        assert.equal(
          (
            await call(`/api/admin/candidates/${id}/merge`, {
              method: "POST",
              body: {
                sourceId: d,
                sourceVersion: 1,
                expectedVersion: 2,
                requestId: randomUUID(),
              },
            })
          ).status,
          409,
        );
      },
    );
    await t.test(
      "EN/ZH console pages render committed data and page-scoped exports",
      async () => {
        for (const lang of ["en", "zh"]) {
          const response = await call(
            `/admin/applications?lang=${lang}&jobId=${job}`,
            { cookie: true },
          );
          assert.equal(response.status, 200);
          const html = await response.text();
          assert.ok(
            html.includes(lang === "en" ? "Export this page" : "导出本页"),
          );
          const detail = await call(`/admin/applications/${app}?lang=${lang}`, {
            cookie: true,
          });
          assert.equal(detail.status, 200);
        }
      },
    );
  },
);
