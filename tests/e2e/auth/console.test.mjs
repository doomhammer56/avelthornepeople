import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
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
const { attemptKey } = await import("../../../src/server/auth/limiter.ts");

test(
  "Built staff console and cookie/API boundaries with real Supabase sessions",
  { timeout: 360000 },
  async (t) => {
    assert.ok(existsSync(".next/BUILD_ID"), "Run npm run build first.");
    const admin = authAdminClient(),
      users = [];
    const invitedUsers = [];
    const loginKeys = [];
    let child;
    const db = await connectAuthTestDatabase(
      () =>
        new pg.Client({
          connectionString: process.env.DIRECT_URL,
          connectionTimeoutMillis: 15000,
        }),
    );
    t.after(async () => {
      const errors = [];
      if (child && child.exitCode === null) {
        const stopped = new Promise((resolve) => child.once("exit", resolve));
        child.kill();
        await stopped;
      }
      try {
        await db.query("BEGIN");
        await db.query(
          "DELETE FROM portal_private.login_states WHERE id=ANY($1::uuid[])",
          [loginKeys],
        );
        for (const user of [...users, ...invitedUsers]) {
          await db.query(
            "DELETE FROM portal_private.team_commands WHERE actor_id=$1",
            [user.id],
          );
          await db.query(
            "DELETE FROM portal.outbox_events WHERE aggregate_id=$1",
            [user.id],
          );
          await db.query(
            "DELETE FROM portal_private.password_grants WHERE subject_id=$1",
            [user.id],
          );
          await db.query(
            "DELETE FROM portal_private.staff_invitation_requests WHERE actor_id=$1 OR profile_id=$1",
            [user.id],
          );
          await db.query(
            "DELETE FROM portal_private.staff_provider_operations WHERE profile_id=$1",
            [user.id],
          );
          await db.query(
            "DELETE FROM portal_private.staff_session_cutoffs WHERE profile_id=$1",
            [user.id],
          );
          await db.query(
            "DELETE FROM portal.audit_logs WHERE actor_id=$1 OR object_id=$1",
            [user.id],
          );
        }
        for (const user of [...users, ...invitedUsers])
          await db.query("DELETE FROM portal.staff_profiles WHERE id=$1", [
            user.id,
          ]);
        await db.query("COMMIT");
      } catch {
        await db.query("ROLLBACK");
        errors.push("Synthetic database cleanup failed.");
      }
      await db.end();
      for (const user of [...users, ...invitedUsers])
        if ((await admin.auth.admin.deleteUser(user.id)).error)
          errors.push("Synthetic Auth cleanup failed.");
      assert.deepEqual(errors, []);
    });
    const known = await admin.auth.admin.getUserById(
      process.env.TEST_STAFF_USER_ID,
    );
    assert.equal(known.error, null);
    assert.equal(
      (
        await db.query(
          "SELECT EXISTS(SELECT 1 FROM auth.users WHERE id=$1) AS present",
          [known.data.user.id],
        )
      ).rows[0].present,
      true,
    );
    assert.equal(
      (
        await db.query(
          "SELECT to_regprocedure('portal_private.staff_session_is_live(uuid)') IS NOT NULL AS present",
        )
      ).rows[0].present,
      true,
      "Deploy the Auth migration to test first.",
    );
    for (const role of ["ADMIN", "READ_ONLY"]) {
      const email = `auth01-e2e-${randomUUID()}@example.invalid`;
      const fixturePassword = randomBytes(32).toString("base64url");
      const result = await admin.auth.admin.createUser({
        email,
        password: fixturePassword,
        email_confirm: true,
        user_metadata: { role: "ADMIN" },
      });
      assert.equal(result.error, null);
      users.push({ ...result.data.user, fixturePassword });
      await db.query(
        "INSERT INTO portal.staff_profiles(id,display_name,role,active) VALUES($1,'Auth endpoint fixture',$2,true)",
        [result.data.user.id, role],
      );
    }
    const socket = createServer();
    await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
    const port = socket.address().port;
    await new Promise((resolve) => socket.close(resolve));
    const origin = `http://127.0.0.1:${port}`;
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
        env: {
          ...process.env,
          AUTH_APP_ORIGIN: origin,
          PUBLIC_SITE_URL: origin,
        },
      },
    );
    child.stdout.on("data", () => {});
    child.stderr.on("data", () => {});
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) break;
      try {
        const response = await fetch(origin + "/api/admin/me", {
          signal: AbortSignal.timeout(1500),
        });
        ready = response.status === 401;
        await response.body?.cancel();
        if (ready) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.equal(
      ready,
      true,
      "Built server did not become ready with the test configuration.",
    );
    const base = `sb-${process.env.AUTH_TEST_PROJECT_REF}-auth-token`;
    async function session(user, admitted = true) {
      const link = await admin.auth.admin.generateLink({
        type: "magiclink",
        email: user.email,
      });
      assert.equal(link.error, null);
      const result = await identityClient().auth.verifyOtp({
        type: "magiclink",
        token_hash: link.data.properties.hashed_token,
      });
      assert.equal(result.error, null);
      // Explicit owner-only fixture admission, never a deployed bypass.
      if (admitted)
        await db.query(
          "INSERT INTO portal_private.staff_session_admissions(session_id,subject_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
          [
            JSON.parse(
              Buffer.from(
                result.data.session.access_token.split(".")[1],
                "base64url",
              ),
            ).session_id,
            user.id,
          ],
        );
      return {
        token: result.data.session.access_token,
        jar: new Map([
          [
            base,
            "base64-" +
              Buffer.from(JSON.stringify(result.data.session)).toString(
                "base64url",
              ),
          ],
        ]),
      };
    }
    const administrator = await session(users[0]);
    let reader = await session(users[1]);
    async function call(
      path,
      { method = "GET", body, jar, token, crossOrigin = false } = {},
    ) {
      // Legacy auth scenarios use the current team version; dedicated BE-08
      // tests separately cover stale and missing versions.
      if (
        path === "/api/admin/staff" &&
        body?.action === "change" &&
        body.expectedVersion === undefined
      )
        body = {
          ...body,
          expectedVersion:
            (
              await db.query(
                "SELECT version FROM portal.staff_profiles WHERE id=$1",
                [body.userId],
              )
            ).rows[0]?.version ?? 1,
        };
      const headers = {};
      if (jar?.size)
        headers.cookie = [...jar]
          .map(([key, value]) => `${key}=${value}`)
          .join("; ");
      if (token) headers.authorization = `Bearer ${token}`;
      if (method !== "GET") {
        headers.origin = crossOrigin ? "https://attacker.invalid" : origin;
        headers["content-type"] = "application/json";
      }
      const response = await fetch(origin + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
      });
      for (const item of response.headers.getSetCookie()) {
        const pair = item.split(";")[0],
          at = pair.indexOf("=");
        const key = pair.slice(0, at),
          value = pair.slice(at + 1);
        if (jar) {
          if (/max-age=0(?:;|$)/i.test(item)) jar.delete(key);
          else jar.set(key, value);
        }
      }
      return response;
    }
    await t.test(
      "Dashboard HTTP authorization, range validation and private aggregate response",
      async () => {
        assert.equal((await call("/api/admin/dashboard")).status, 401);
        assert.equal(
          (await call("/api/admin/dashboard", { token: reader.token })).status,
          403,
        );
        const response = await call("/api/admin/dashboard?range=7", {
          token: administrator.token,
        });
        assert.equal(response.status, 200);
        assert.match(
          response.headers.get("cache-control"),
          /private.*no-store/,
        );
        const data = await response.json();
        assert.equal(data.period.range, 7);
        assert.equal(data.dailyApplications.length, 7);
        assert.ok(Number.isSafeInteger(data.applications));
        assert.equal(data.period.timezone, "UTC");
        assert.equal(data.recentApplications, undefined);
        assert.equal(
          (
            await call("/api/admin/dashboard?range=90", {
              jar: administrator.jar,
            })
          ).status,
          200,
        );
        for (const suffix of ["range=14", "range=7&range=90"])
          assert.equal(
            (
              await call("/api/admin/dashboard?" + suffix, {
                token: administrator.token,
              })
            ).status,
            400,
          );
        assert.equal(
          (
            await call("/api/admin/dashboard", {
              jar: administrator.jar,
              token: "invalid-explicit-token",
            })
          ).status,
          401,
        );
        try {
          await db.query(
            "UPDATE portal.staff_profiles SET role='HR' WHERE id=$1",
            [users[0].id],
          );
          assert.equal(
            (await call("/api/admin/dashboard", { token: administrator.token }))
              .status,
            200,
          );
          await db.query(
            "UPDATE portal.staff_profiles SET active=false WHERE id=$1",
            [users[0].id],
          );
          assert.equal(
            (await call("/api/admin/dashboard", { token: administrator.token }))
              .status,
            403,
          );
        } finally {
          await db.query(
            "UPDATE portal.staff_profiles SET role='ADMIN',active=true WHERE id=$1",
            [users[0].id],
          );
        }
      },
    );
    await t.test(
      "New console screens use authorized backend data instead of design fixtures",
      async () => {
        assert.equal((await call("/api/admin/staff")).status, 401);
        assert.equal(
          (await call("/api/admin/staff", { token: reader.token })).status,
          403,
        );
        const directory = await call("/api/admin/staff", {
          token: administrator.token,
        });
        assert.equal(directory.status, 200);
        assert.match(
          directory.headers.get("cache-control"),
          /private.*no-store/,
        );
        const data = await directory.json();
        assert.ok(data.accounts.some((account) => account.id === users[0].id));
        assert.ok(data.accounts.some((account) => account.id === users[1].id));
        assert.equal(
          data.accounts.find((account) => account.id === users[1].id).role,
          "READ_ONLY",
        );
        assert.equal(
          (
            await call("/api/admin/staff?page=0", {
              token: administrator.token,
            })
          ).status,
          400,
        );
        for (const [path, title] of [
          ["jobs", "Jobs"],
          ["applications", "Applications"],
          ["accounts", "Accounts &amp; roles"],
          ["log", "Audit log"],
          ["settings", "Settings"],
        ]) {
          const page = await call(`/admin/${path}?lang=en`, {
            jar: administrator.jar,
          });
          assert.equal(page.status, 200);
          const html = await page.text();
          assert.ok(
            html.includes(`<h1>${title}</h1>`),
            `Live ${path} screen must render successfully`,
          );
          assert.ok(!html.includes("jasmine.c@mail.com"));
          assert.ok(!html.includes("chen.zm@avelthornepeople.com"));
        }
        const readOnlyApps = await call("/admin/applications?lang=en", {
          jar: reader.jar,
        });
        assert.equal(readOnlyApps.status, 200);
        assert.ok((await readOnlyApps.text()).includes("does not have access"));
        const newJob = await call("/admin/jobs/new?lang=en", {
          jar: administrator.jar,
        });
        const newJobHtml = await newJob.text();
        assert.ok(newJobHtml.includes("New job"));
        assert.ok(!newJobHtml.includes("No changes will be saved"));
      },
    );
    await t.test(
      "Collector HTTP rejects cross-origin and malformed events",
      async () => {
        assert.equal(
          (
            await call("/api/analytics/job-detail-view", {
              method: "POST",
              crossOrigin: true,
              body: {},
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await call("/api/analytics/job-detail-view", {
              method: "POST",
              body: { jobId: "invalid" },
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      "Direct provider sessions have no console admission, with cookies or bearer tokens",
      async () => {
        const direct = await session(users[0], false);
        assert.equal(
          (await call("/api/admin/dashboard", { token: direct.token })).status,
          401,
        );
        assert.equal(
          (await call("/api/admin/me", { token: direct.token })).status,
          401,
        );
        assert.equal(
          (await call("/api/admin/me", { jar: direct.jar })).status,
          401,
        );
        const page = await call("/admin", { jar: direct.jar });
        assert.equal(page.status, 307);
        assert.match(page.headers.get("location"), /\/admin\/login/);
      },
    );
    await t.test(
      "Supabase rejects invalid CAPTCHA without counting a password failure or returning cookies",
      async () => {
        const email = `be01-captcha-${randomUUID()}@example.invalid`;
        const id = attemptKey("login", email);
        loginKeys.push(id);
        const response = await call("/api/auth/login", {
          method: "POST",
          body: {
            email,
            password: randomBytes(32).toString("base64url"),
            captchaToken: "invalid-turnstile-token",
          },
        });
        assert.equal(
          response.status,
          400,
          "Enable Turnstile CAPTCHA in the test project's Supabase Auth settings.",
        );
        assert.equal((await response.json()).code, "captcha_failed");
        assert.ok(
          response.headers
            .getSetCookie()
            .every((cookie) => /max-age=0(?:;|$)/i.test(cookie)),
        );
        const row = (
          await db.query(
            "SELECT failures,lease_id FROM portal_private.login_states WHERE id=$1",
            [id],
          )
        ).rows[0];
        assert.deepEqual(row, { failures: 0, lease_id: null });
      },
    );
    await t.test(
      "Existing admitted sessions remain usable during a login lock; retries preserve its deadline",
      async () => {
        const id = attemptKey("login", users[0].email.toLowerCase());
        loginKeys.push(id);
        await db.query(
          "WITH clock AS (SELECT clock_timestamp() AS instant) INSERT INTO portal_private.login_states(id,failures,locked_at,locked_until) SELECT $1,5,instant-interval '8 minutes',instant+interval '7 minutes' FROM clock",
          [id],
        );
        const deadline = (
          await db.query(
            "SELECT locked_until FROM portal_private.login_states WHERE id=$1",
            [id],
          )
        ).rows[0].locked_until;
        for (let i = 0; i < 2; i++) {
          const response = await call("/api/auth/login", {
            method: "POST",
            body: {
              email: `  ${users[0].email.toUpperCase()}  `,
              password: "unexamined-password",
              captchaToken: "unexamined-challenge",
            },
          });
          assert.equal(response.status, 429);
          const result = await response.json();
          assert.equal(result.code, "login_locked");
          assert.ok(
            result.retryAfterSeconds > 390 && result.retryAfterSeconds <= 420,
          );
          assert.equal(
            response.headers.get("retry-after"),
            String(result.retryAfterSeconds),
          );
          assert.equal(response.headers.getSetCookie().length, 0);
        }
        assert.equal(
          (await call("/api/admin/me", { jar: administrator.jar })).status,
          200,
        );
        assert.equal(
          (
            await db.query(
              "SELECT locked_until FROM portal_private.login_states WHERE id=$1",
              [id],
            )
          ).rows[0].locked_until.getTime(),
          deadline.getTime(),
        );
      },
    );
    await t.test(
      "Anonymous APIs deny access and public locales still render",
      async () => {
        assert.equal((await call("/api/admin/me")).status, 401);
        const response = await call("/en");
        assert.equal(response.status, 200);
        await response.body?.cancel();
      },
    );
    await t.test(
      "Only minimal live profile fields reach the console",
      async () => {
        const response = await call("/api/admin/me", {
          jar: administrator.jar,
        });
        assert.equal(response.status, 200);
        assert.deepEqual(Object.keys(await response.json()).sort(), [
          "displayName",
          "id",
          "role",
        ]);
        assert.match(
          response.headers.get("cache-control"),
          /private.*no-store/,
        );
        const page = await call("/admin", { jar: administrator.jar });
        assert.equal(page.status, 200);
        const html = await page.text();
        assert.ok(html.includes("Auth endpoint fixture"));
        assert.ok(!html.includes(administrator.token));
      },
    );
    await t.test(
      "Editable metadata does not elevate READ_ONLY and invalid bearer never falls back",
      async () => {
        const response = await call("/api/admin/me", { jar: reader.jar });
        assert.equal((await response.json()).role, "READ_ONLY");
        assert.equal(
          (
            await call("/api/admin/staff", {
              method: "POST",
              jar: reader.jar,
              body: {
                action: "link",
                userId: users[0].id,
                displayName: "Denied",
                requestId: randomUUID(),
              },
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await call("/api/admin/me", {
              jar: administrator.jar,
              token: "invalid-explicit-token",
            })
          ).status,
          401,
        );
      },
    );
    await t.test(
      "Cookie mutations reject cross-origin requests and arbitrary password changes",
      async () => {
        assert.equal(
          (
            await call("/api/auth/logout", {
              method: "POST",
              jar: administrator.jar,
              body: {},
              crossOrigin: true,
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await call("/api/auth/password", {
              method: "POST",
              jar: administrator.jar,
              body: { password: randomBytes(32).toString("base64url") },
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await call("/api/admin/staff", {
              method: "POST",
              jar: administrator.jar,
              crossOrigin: true,
              body: {},
            })
          ).status,
          403,
        );
      },
    );
    await t.test(
      "Refresh updates HttpOnly cookies without sharing session state",
      async () => {
        const stale = JSON.parse(
          Buffer.from(
            administrator.jar.get(base).slice(7),
            "base64url",
          ).toString(),
        );
        stale.expires_at = 1;
        administrator.jar.set(
          base,
          "base64-" + Buffer.from(JSON.stringify(stale)).toString("base64url"),
        );
        const response = await call("/api/admin/me", {
          jar: administrator.jar,
        });
        assert.equal(response.status, 200);
        const writes = response.headers
          .getSetCookie()
          .filter((value) => value.startsWith("sb-"));
        assert.ok(writes.length > 0);
        assert.ok(writes.every((value) => /httponly/i.test(value)));
        const independent = await call("/api/admin/me", { jar: reader.jar });
        assert.equal((await independent.json()).id, users[1].id);
      },
    );
    await t.test(
      "Admin changes invalidate old sessions and reconcile provider state",
      async () => {
        const self = await call("/api/admin/staff", {
          method: "POST",
          jar: administrator.jar,
          body: {
            action: "change",
            userId: users[0].id,
            role: "HR",
            active: false,
            requestId: randomUUID(),
          },
        });
        assert.equal(self.status, 403);
        const changed = await call("/api/admin/staff", {
          method: "POST",
          jar: administrator.jar,
          body: {
            action: "change",
            userId: users[1].id,
            role: "HR",
            active: true,
            requestId: randomUUID(),
          },
        });
        assert.equal(changed.status, 200);
        assert.equal(
          (await call("/api/admin/me", { jar: reader.jar })).status,
          401,
        );
        reader = await session(users[1]);
        assert.equal(
          (await (await call("/api/admin/me", { jar: reader.jar })).json())
            .role,
          "HR",
        );
        const disabled = await call("/api/admin/staff", {
          method: "POST",
          jar: administrator.jar,
          body: {
            action: "change",
            userId: users[1].id,
            role: "HR",
            active: false,
            requestId: randomUUID(),
          },
        });
        assert.equal(disabled.status, 200);
        assert.equal((await disabled.json()).providerSync, "complete");
        assert.equal(
          (await call("/api/admin/me", { jar: reader.jar })).status,
          401,
        );
        const enabled = await call("/api/admin/staff", {
          method: "POST",
          jar: administrator.jar,
          body: {
            action: "change",
            userId: users[1].id,
            role: "HR",
            active: true,
            requestId: randomUUID(),
          },
        });
        assert.equal(enabled.status, 200);
        reader = await session(users[1]);
        assert.equal(
          (await call("/api/admin/me", { jar: reader.jar })).status,
          200,
        );
      },
    );
    await t.test(
      "A real recovery token grants one password update and the URL cannot be replayed",
      async () => {
        const link = await admin.auth.admin.generateLink({
          type: "recovery",
          email: users[1].email,
        });
        assert.equal(link.error, null);
        const jar = new Map();
        const payload = {
          type: "recovery",
          token_hash: link.data.properties.hashed_token,
          lang: "zh",
        };
        const preview = await call(
          `/auth/confirm?type=recovery&token_hash=${encodeURIComponent(payload.token_hash)}&lang=zh`,
        );
        assert.equal(preview.status, 200);
        await preview.body?.cancel();
        const response = await call("/api/auth/confirm", {
          method: "POST",
          jar,
          body: payload,
        });
        assert.equal(response.status, 200);
        assert.equal(
          (await response.json()).next,
          "/admin/reset-password?lang=zh",
        );
        assert.ok(
          response.headers
            .getSetCookie()
            .some(
              (value) =>
                value.startsWith("portal-password-setup=") &&
                /httponly/i.test(value),
            ),
        );
        assert.equal(
          (await call("/api/auth/confirm", { method: "POST", body: payload }))
            .status,
          401,
        );
        assert.equal((await call("/api/admin/me", { jar })).status, 401);
        const form = await call("/admin/reset-password?lang=zh", { jar });
        assert.equal(form.status, 200);
        assert.ok((await form.text()).includes('name="repeat"'));
        const reused = await call("/api/auth/password", {
          method: "POST",
          jar,
          body: { password: users[1].fixturePassword },
        });
        assert.equal(reused.status, 400);
        assert.equal((await reused.json()).code, "password_reused");
        assert.ok(jar.has("portal-password-setup"));
        const updated = await call("/api/auth/password", {
          method: "POST",
          jar,
          body: { password: randomBytes(32).toString("base64url"), lang: "zh" },
        });
        assert.equal(updated.status, 200);
        assert.equal(
          (await updated.json()).next,
          "/admin/login?updated=1&lang=zh",
        );
        assert.equal((await call("/api/admin/me", { jar })).status, 401);
        assert.equal(
          (await call("/api/admin/me", { jar: reader.jar })).status,
          401,
        );
        assert.equal(jar.has("portal-password-setup"), false);
      },
    );
    async function recoveryJar() {
      const link = await admin.auth.admin.generateLink({
        type: "recovery",
        email: users[1].email,
      });
      assert.equal(link.error, null);
      const jar = new Map();
      assert.equal(
        (
          await call("/api/auth/confirm", {
            method: "POST",
            jar,
            body: {
              type: "recovery",
              token_hash: link.data.properties.hashed_token,
            },
          })
        ).status,
        200,
      );
      return jar;
    }
    await t.test(
      "Expired grants render a new-link prompt and cannot change a password",
      async () => {
        const jar = await recoveryJar();
        await db.query(
          "UPDATE portal_private.password_grants SET expires_at=clock_timestamp()-interval '1 second' WHERE subject_id=$1",
          [users[1].id],
        );
        const page = await call("/admin/reset-password", { jar });
        const html = await page.text();
        assert.ok(html.includes("Request a new link"));
        assert.ok(!html.includes('name="repeat"'));
        const response = await call("/api/auth/password", {
          method: "POST",
          jar,
          body: { password: randomBytes(32).toString("base64url") },
        });
        assert.equal(response.status, 403);
        assert.equal((await response.json()).code, "email_link_invalid");
        assert.equal(jar.has("portal-password-setup"), false);
      },
    );
    await t.test(
      "Concurrent password submissions consume one operation",
      async () => {
        const jar = await recoveryJar(),
          password = randomBytes(32).toString("base64url");
        const responses = await Promise.all(
          [0, 1].map(() =>
            call("/api/auth/password", {
              method: "POST",
              jar: new Map(jar),
              body: { password },
            }),
          ),
        );
        assert.equal(responses.filter((r) => r.status === 200).length, 1);
        assert.ok(responses.some((r) => [401, 403].includes(r.status)));
        for (const response of responses) await response.body?.cancel();
      },
    );
    await t.test(
      "Sign-out clears a pending recovery grant and invalidates that session",
      async () => {
        const jar = await recoveryJar();
        assert.equal(
          (await call("/api/auth/logout", { method: "POST", jar, body: {} }))
            .status,
          200,
        );
        assert.equal(jar.has("portal-password-setup"), false);
        assert.equal(
          (
            await call("/api/auth/password", {
              method: "POST",
              jar,
              body: { password: randomBytes(32).toString("base64url") },
            })
          ).status,
          401,
        );
      },
    );
    await t.test(
      "Invitation password setup preserves inactive/read-only profile defaults",
      async () => {
        const link = await admin.auth.admin.generateLink({
          type: "invite",
          email: `auth-invite-${randomUUID()}@example.invalid`,
        });
        assert.equal(link.error, null);
        const user = link.data.user;
        invitedUsers.push(user);
        await db.query(
          "INSERT INTO portal.staff_profiles(id,display_name) VALUES($1,'Invitation password fixture')",
          [user.id],
        );
        const jar = new Map();
        const confirmed = await call("/api/auth/confirm", {
          method: "POST",
          jar,
          body: {
            type: "invite",
            token_hash: link.data.properties.hashed_token,
          },
        });
        assert.equal(confirmed.status, 200);
        assert.equal(
          (await confirmed.json()).next,
          "/admin/setup-password?lang=en",
        );
        assert.equal((await call("/api/admin/me", { jar })).status, 401);
        assert.equal(
          (
            await call("/api/auth/password", {
              method: "POST",
              jar,
              body: { password: randomBytes(32).toString("base64url") },
            })
          ).status,
          200,
        );
        assert.deepEqual(
          (
            await db.query(
              "SELECT role,active FROM portal.staff_profiles WHERE id=$1",
              [user.id],
            )
          ).rows[0],
          { role: "READ_ONLY", active: false },
        );
      },
    );
    await t.test(
      "Sign-out prevents sensitive replay of the same unexpired bearer",
      async () => {
        assert.equal(
          (
            await call("/api/auth/logout", {
              method: "POST",
              jar: administrator.jar,
              body: {},
            })
          ).status,
          200,
        );
        assert.equal(
          (await call("/api/admin/me", { token: administrator.token })).status,
          401,
        );
        assert.equal(
          (await call("/api/admin/me", { jar: administrator.jar })).status,
          401,
        );
      },
    );
    await t.test(
      "Competing administrator deactivations leave one authorized administrator",
      async () => {
        await db.query(
          "UPDATE portal.staff_profiles SET role='ADMIN',active=true WHERE id=ANY($1::uuid[])",
          [users.map((user) => user.id)],
        );
        const identities = await Promise.all(
          users.map((user) => session(user)),
        );
        const responses = await Promise.all(
          identities.map((identity, index) =>
            call("/api/admin/staff", {
              method: "POST",
              token: identity.token,
              body: {
                action: "change",
                userId: users[1 - index].id,
                role: "ADMIN",
                active: false,
                requestId: randomUUID(),
              },
            }),
          ),
        );
        assert.equal(
          responses.filter(
            (response) => response.status === 200 || response.status === 202,
          ).length,
          1,
        );
        assert.ok(
          responses.some((response) =>
            [401, 403, 503].includes(response.status),
          ),
        );
        for (const response of responses) await response.body?.cancel();
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int AS count FROM portal.staff_profiles WHERE id=ANY($1::uuid[]) AND role='ADMIN' AND active",
              [users.map((user) => user.id)],
            )
          ).rows[0].count,
          1,
        );
      },
    );
  },
);
