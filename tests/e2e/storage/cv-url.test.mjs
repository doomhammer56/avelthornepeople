import "dotenv/config";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import {
  storageAdminClient,
  storageConfig,
} from "../../../src/server/adapters/storage/config.ts";
import { createCvRepository } from "../../../src/server/storage/repository.ts";

test(
  "Built CV URL endpoint with real staff JWTs and restricted runtime",
  { timeout: 180_000 },
  async (t) => {
    assert.ok(
      existsSync(".next/BUILD_ID"),
      "Run npm run build before the storage endpoint test.",
    );
    assert.ok(
      process.env.SUPABASE_PUBLISHABLE_KEY &&
        process.env.DATABASE_URL &&
        process.env.DIRECT_URL,
    );
    const config = storageConfig();
    const admin = storageAdminClient();
    const owner = new pg.Client({
      connectionString: process.env.DIRECT_URL,
      connectionTimeoutMillis: 15000,
    });
    const runtimePool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 15000,
    });
    const ids = Object.fromEntries(
      ["job", "candidate", "upload", "application"].map((name) => [
        name,
        randomUUID(),
      ]),
    );
    const objectKey = `${ids.upload}/${randomUUID()}.pdf`;
    const bytes = Buffer.from(
      "%PDF-1.4\n% Synthetic endpoint authorization fixture, not a production scan.\n%%EOF\n",
    );
    let userId;
    let child;
    let objectCreated = false;
    let fixtureCreated = false;
    await owner.connect();
    t.after(async () => {
      const cleanupErrors = [];
      if (child && child.exitCode === null) {
        const stopped = new Promise((resolve) => child.once("exit", resolve));
        child.kill();
        await stopped;
      }
      await runtimePool.end();
      try {
        if (fixtureCreated) {
          await owner.query("BEGIN");
          await owner.query("DELETE FROM portal.audit_logs WHERE actor_id=$1", [
            userId,
          ]);
          await owner.query("DELETE FROM portal.applications WHERE id=$1", [
            ids.application,
          ]);
          await owner.query("DELETE FROM portal.uploads WHERE id=$1", [
            ids.upload,
          ]);
          await owner.query("DELETE FROM portal.jobs WHERE id=$1", [ids.job]);
          await owner.query("DELETE FROM portal.candidates WHERE id=$1", [
            ids.candidate,
          ]);
          await owner.query("DELETE FROM portal.staff_profiles WHERE id=$1", [
            userId,
          ]);
          await owner.query("COMMIT");
        }
      } catch {
        await owner.query("ROLLBACK").catch(() => {});
        cleanupErrors.push("Synthetic database fixture cleanup failed.");
      }
      try {
        if (objectCreated) {
          const result = await admin.storage
            .from("cv-clean")
            .remove([objectKey]);
          if (result.error)
            cleanupErrors.push("Synthetic object cleanup failed.");
        }
        if (userId) {
          const result = await admin.auth.admin.deleteUser(userId);
          if (result.error)
            cleanupErrors.push("Synthetic Auth user cleanup failed.");
        }
      } finally {
        await owner.end();
      }
      assert.deepEqual(cleanupErrors, []);
    });

    // Verify credentials identify the same dedicated project before creating data.
    const identity = await admin.auth.admin.getUserById(
      process.env.TEST_STAFF_USER_ID,
    );
    assert.equal(identity.error, null);
    assert.equal(
      (
        await owner.query(
          "SELECT EXISTS(SELECT 1 FROM auth.users WHERE id=$1) AS present",
          [identity.data.user.id],
        )
      ).rows[0].present,
      true,
    );
    await createCvRepository(runtimePool).withSubject(
      randomUUID(),
      async (session) => {
        assert.equal(await session.role(), null);
      },
    );

    const password = randomBytes(32).toString("base64url");
    const email = `storage-e2e-${randomUUID()}@example.invalid`;
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: "ADMIN", active: true },
    });
    assert.equal(created.error, null);
    userId = created.data.user.id;
    const auth = createClient(
      config.url,
      process.env.SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    // Admin-generated fixture links send no email and remain usable when Auth
    // CAPTCHA is enabled; real password login is covered by Auth-01 acceptance.
    const fixtureLink = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    assert.equal(fixtureLink.error, null);
    const loggedIn = await auth.auth.verifyOtp({
      type: "magiclink",
      token_hash: fixtureLink.data.properties.hashed_token,
    });
    assert.equal(loggedIn.error, null);
    const token = loggedIn.data.session.access_token;

    const uploaded = await admin.storage
      .from("cv-clean")
      .upload(objectKey, bytes, {
        contentType: "application/pdf",
        cacheControl: "0",
        upsert: false,
      });
    assert.equal(uploaded.error, null);
    objectCreated = true;
    await owner.query("BEGIN");
    try {
      await owner.query(
        "INSERT INTO portal.staff_profiles (id,display_name,role,active) VALUES ($1,'Storage endpoint test','READ_ONLY',true)",
        [userId],
      );
      // Owner-only admission for endpoint fixtures, not password/CAPTCHA proof.
      await owner.query(
        "INSERT INTO portal_private.staff_session_admissions(session_id,subject_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
        [
          JSON.parse(Buffer.from(token.split(".")[1], "base64url")).session_id,
          userId,
        ],
      );
      await owner.query(
        "INSERT INTO portal.jobs (id,canonical_slug,draft_content,owner_id) VALUES ($1,$2,'{}'::jsonb,$3)",
        [ids.job, `storage-e2e-${ids.job}`, userId],
      );
      await owner.query(
        "INSERT INTO portal.candidates (id,name_encrypted,email_encrypted,phone_encrypted,email_hmac,phone_hmac,hmac_key_version) VALUES ($1,$2,$2,$2,$3,$4,1)",
        [ids.candidate, randomBytes(48), randomBytes(32), randomBytes(32)],
      );
      await owner.query(
        `INSERT INTO portal.uploads (id,storage_provider,bucket,object_key,declared_size_bytes,size_bytes,detected_type,sha256,scan_state,scanned_at,capability_hash,capability_expires_at)
      VALUES ($1,'SUPABASE','cv-clean',$2,$3,$3,'application/pdf',$4,'CLEAN',now(),$5,now()+interval '15 minutes')`,
        [
          ids.upload,
          objectKey,
          bytes.length,
          createHash("sha256").update(bytes).digest(),
          randomBytes(32),
        ],
      );
      await owner.query(
        `INSERT INTO portal.applications (id,job_id,candidate_id,cv_upload_id,cv_scan_state,intake_state,confirmed_at,profile_encrypted,consent_at,policy_version,source,locale,idempotency_key,payload_digest,receipt_hash,receipt_expires_at)
      VALUES ($1,$2,$3,$4,'CLEAN','CONFIRMED',now(),$5,now(),'v1','CAREERS','en',$6,$7,$8,now()+interval '1 day')`,
        [
          ids.application,
          ids.job,
          ids.candidate,
          ids.upload,
          randomBytes(48),
          randomUUID(),
          randomBytes(32),
          randomBytes(32),
        ],
      );
      await owner.query("COMMIT");
      fixtureCreated = true;
    } catch (error) {
      await owner.query("ROLLBACK");
      throw error;
    }

    const listener = createServer();
    await new Promise((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(0, "127.0.0.1", resolve);
    });
    const port = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
    child = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: { ...process.env, AUTH_APP_ORIGIN: `http://127.0.0.1:${port}` },
      },
    );
    child.stdout.on("data", () => {});
    child.stderr.on("data", () => {});
    const endpoint = `http://127.0.0.1:${port}/api/admin/applications/${ids.application}/cv-url`;
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) break;
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          signal: AbortSignal.timeout(2000),
        });
        ready = response.status === 401;
        await response.body?.cancel();
        if (ready) break;
      } catch {
        /* Wait for the localhost test server only. */
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.equal(
      ready,
      true,
      "The built localhost application did not become ready.",
    );
    const request = (url = endpoint) =>
      fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20000),
      });

    await t.test(
      "READ_ONLY is denied despite editable metadata claiming ADMIN",
      async () => {
        const response = await request();
        assert.equal(response.status, 403);
        assert.match(
          response.headers.get("cache-control"),
          /private.*no-store/,
        );
        assert.equal("url" in (await response.json()), false);
      },
    );

    await t.test(
      "active HR receives a working preview URL after authorization and audit",
      async () => {
        await owner.query(
          "UPDATE portal.staff_profiles SET role='HR' WHERE id=$1",
          [userId],
        );
        const response = await request(`${endpoint}?mode=preview`);
        assert.equal(response.status, 200);
        assert.match(
          response.headers.get("cache-control"),
          /private.*no-store/,
        );
        const result = await response.json();
        assert.equal(result.disposition, "inline");
        assert.deepEqual(Object.keys(result).sort(), [
          "disposition",
          "expiresAt",
          "url",
        ]);
        assert.ok(new Date(result.expiresAt).getTime() > Date.now());
        const file = await fetch(result.url, {
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        });
        assert.equal(file.ok, true);
        assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
      },
    );

    await t.test(
      "Live application detail uses the real submission and does not sign a CV before a download click",
      async () => {
        const base = `sb-${new URL(config.url).hostname.split(".")[0]}-auth-token`;
        const cookie = `${base}=base64-${Buffer.from(JSON.stringify(loggedIn.data.session)).toString("base64url")}`;
        const auditCount = async () =>
          Number(
            (
              await owner.query(
                "SELECT count(*)::text AS n FROM portal.audit_logs WHERE actor_id=$1",
                [userId],
              )
            ).rows[0].n,
          );
        const before = await auditCount();
        const response = await fetch(
          `http://127.0.0.1:${port}/admin/applications/${ids.application}?lang=en`,
          { headers: { cookie }, signal: AbortSignal.timeout(20000) },
        );
        assert.equal(response.status, 200);
        const html = await response.text();
        assert.ok(html.includes(ids.application));
        assert.ok(html.includes("Applicant details are currently unavailable"));
        assert.ok(html.includes("Download CV"));
        assert.ok(!html.includes("/storage/v1/object/sign/"));
        assert.equal(await auditCount(), before);
        const jobPage = await fetch(
          `http://127.0.0.1:${port}/admin/jobs/${ids.job}/edit?lang=en`,
          { headers: { cookie }, signal: AbortSignal.timeout(20000) },
        );
        assert.equal(jobPage.status, 200);
        const jobHtml = await jobPage.text();
        assert.ok(jobHtml.includes("Job title"));
        assert.ok(
          !jobHtml.includes("Editing and publishing are not available yet"),
        );
        const titleInput = jobHtml.match(
          /<input[^>]*id="job-title"[^>]*>/,
        )?.[0];
        assert.ok(titleInput, "HR must receive the real editable job form");
        assert.doesNotMatch(titleInput, /\bdisabled(?:=|\s|>)/);
        assert.equal(
          await auditCount(),
          before,
          "Rendering the job editor must not write audits",
        );
      },
    );
    await t.test(
      "HR cookie signing enforces Origin and does not fall back from an invalid bearer",
      async () => {
        const base = `sb-${new URL(config.url).hostname.split(".")[0]}-auth-token`;
        const cookie = `${base}=base64-${Buffer.from(JSON.stringify(loggedIn.data.session)).toString("base64url")}`;
        for (const [origin, bearer, expected] of [
          [`http://127.0.0.1:${port}`, null, 200],
          ["https://attacker.invalid", null, 403],
          [`http://127.0.0.1:${port}`, "invalid-explicit", 401],
        ]) {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              cookie,
              origin,
              ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
            },
            signal: AbortSignal.timeout(20000),
          });
          assert.equal(response.status, expected);
          await response.body?.cancel();
        }
      },
    );

    await t.test(
      "active ADMIN receives a neutral attachment and cannot select arbitrary paths",
      async () => {
        await owner.query(
          "UPDATE portal.staff_profiles SET role='ADMIN' WHERE id=$1",
          [userId],
        );
        const response = await request();
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.equal(result.disposition, "attachment");
        const file = await fetch(result.url, {
          signal: AbortSignal.timeout(15000),
        });
        assert.equal(file.ok, true);
        assert.ok(
          (file.headers.get("content-disposition") ?? "").includes("cv.pdf"),
        );
        await file.arrayBuffer();
        const invalidMode = await request(`${endpoint}?mode=anything`);
        assert.equal(invalidMode.status, 400);
        await invalidMode.body?.cancel();
      },
    );

    await t.test(
      "deactivation is enforced with the same unexpired JWT",
      async () => {
        await owner.query(
          "UPDATE portal.staff_profiles SET active=false WHERE id=$1",
          [userId],
        );
        const response = await request();
        assert.equal(response.status, 403);
        assert.equal("url" in (await response.json()), false);
        await owner.query(
          "UPDATE portal.staff_profiles SET active=true WHERE id=$1",
          [userId],
        );
      },
    );

    await t.test(
      "revoked, deletion-blocked and quarantine records never return URLs",
      async () => {
        for (const [change, reset, id] of [
          [
            "UPDATE portal.uploads SET access_revoked_at=now() WHERE id=$1",
            "UPDATE portal.uploads SET access_revoked_at=NULL WHERE id=$1",
            ids.upload,
          ],
          [
            "UPDATE portal.candidates SET deletion_requested_at=now() WHERE id=$1",
            "UPDATE portal.candidates SET deletion_requested_at=NULL WHERE id=$1",
            ids.candidate,
          ],
          [
            "UPDATE portal.uploads SET bucket='cv-quarantine' WHERE id=$1",
            "UPDATE portal.uploads SET bucket='cv-clean' WHERE id=$1",
            ids.upload,
          ],
        ]) {
          await owner.query(change, [id]);
          try {
            const response = await request();
            assert.equal(response.status, 404);
            assert.equal("url" in (await response.json()), false);
          } finally {
            await owner.query(reset, [id]);
          }
        }
      },
    );

    await t.test(
      "only successful URL issuance is audited with safe UUID references",
      async () => {
        const events = (
          await owner.query(
            "SELECT action,safe_changes FROM portal.audit_logs WHERE actor_id=$1",
            [userId],
          )
        ).rows;
        assert.equal(events.length, 3);
        assert.ok(events.every((event) => event.action === "CV_URL_ISSUED"));
        for (const event of events)
          assert.deepEqual(event.safe_changes, { uploadId: ids.upload });
      },
    );
  },
);
