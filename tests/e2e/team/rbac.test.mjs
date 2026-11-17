import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import pg from "pg";
import {
  loadAuthTestEnvironment,
  connectAuthTestDatabase,
} from "../../../scripts/auth/test-env.mjs";
loadAuthTestEnvironment();
const { createStaffSession } = await import("../../helpers/staff-session.mjs");
const { withRuntime, runtimePool } =
  await import("../../../src/server/database/runtime.ts");
const { authAdminClient } =
  await import("../../../src/server/adapters/auth/admin.ts");
const { staffUiText } = await import("../../../src/lib/admin/staffContent.ts");
const { accountsContent } =
  await import("../../../src/lib/admin/accountsContent.ts");

test(
  "Built RBAC APIs and team console enforce live permissions and versioned changes",
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
    const users = [],
      extraIds = [],
      provider = authAdminClient();
    let child;
    t.after(async () => {
      if (child && child.exitCode === null) {
        const stopped = new Promise((resolve) => child.once("exit", resolve));
        child.kill();
        await stopped;
      }
      await runtimePool().end();
      const ids = [...users.map((u) => u.id), ...extraIds];
      try {
        await db.query("BEGIN");
        for (const query of [
          "DELETE FROM portal_private.team_commands WHERE actor_id=ANY($1::uuid[])",
          "DELETE FROM portal_private.staff_invitation_requests WHERE actor_id=ANY($1::uuid[]) OR profile_id=ANY($1::uuid[])",
          "DELETE FROM portal_private.staff_provider_operations WHERE profile_id=ANY($1::uuid[])",
          "DELETE FROM portal.audit_logs WHERE actor_id=ANY($1::uuid[]) OR object_id=ANY($1::uuid[])",
          "DELETE FROM portal.outbox_events WHERE aggregate_id=ANY($1::uuid[])",
          "DELETE FROM portal_private.staff_session_admissions WHERE subject_id=ANY($1::uuid[])",
          "DELETE FROM portal_private.staff_session_cutoffs WHERE profile_id=ANY($1::uuid[])",
          "DELETE FROM portal.staff_profiles WHERE id=ANY($1::uuid[])",
        ])
          await db.query(query, [ids]);
        await db.query("COMMIT");
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        await db.end();
        for (const id of ids)
          assert.equal((await provider.auth.admin.deleteUser(id)).error, null);
      }
    });
    for (const role of ["ADMIN", "ADMIN", "HR", "READ_ONLY"])
      users.push(await createStaffSession(db, role));
    const [admin, otherAdmin, hr, reader] = users;
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
        const r = await fetch(origin + "/api/admin/me", {
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
    assert.ok(ready, "Run npm run build before the team HTTP suite.");
    function call(path, user = admin, body, options = {}) {
      return fetch(origin + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(user
            ? options.cookie
              ? { Cookie: user.cookie }
              : { Authorization: `Bearer ${user.token}` }
            : {}),
          ...(body === undefined
            ? {}
            : { "Content-Type": "application/json", Origin: origin }),
          ...options.headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
      });
    }
    const post = (body, user = admin, options) =>
      call("/api/admin/staff", user, body, options);
    async function profile(id) {
      return (
        await db.query(
          "SELECT role,active,version FROM portal.staff_profiles WHERE id=$1",
          [id],
        )
      ).rows[0];
    }
    async function account(id) {
      const r = await call("/api/admin/staff");
      assert.equal(r.status, 200);
      return (await r.json()).accounts.find((a) => a.id === id);
    }
    await t.test("all roles obey the same API read/write matrix", async () => {
      for (const user of [admin, hr, reader]) {
        for (const path of [
          "/api/admin/me",
          "/api/admin/jobs",
          "/api/admin/content",
        ]) {
          const r = await call(path, user);
          assert.equal(r.status, 200, `${user.role} ${path}`);
          assert.match(r.headers.get("cache-control"), /private.*no-store/);
          await r.body?.cancel();
        }
        for (const [path, allowed] of [
          ["/api/admin/dashboard", user !== reader],
          ["/api/admin/applications", user !== reader],
          ["/api/admin/audit", user === admin],
          ["/api/admin/staff", user === admin],
        ]) {
          const r = await call(path, user);
          assert.equal(r.status, allowed ? 200 : 403, `${user.role} ${path}`);
          await r.body?.cancel();
        }
        for (const [path, status] of [
          ["/api/admin/jobs", user === reader ? 403 : 400],
          ["/api/admin/content", user === admin ? 400 : 403],
          ["/api/admin/staff", user === admin ? 400 : 403],
          [
            `/api/admin/applications/${randomUUID()}/cv-url`,
            user === reader ? 403 : 404,
          ],
        ]) {
          const r = await call(
            path,
            user,
            path.endsWith("cv-url") ? { mode: "preview" } : {},
          );
          assert.equal(r.status, status, `${user.role} POST ${path}`);
          await r.body?.cancel();
        }
      }
    });
    await t.test(
      "metadata spoofing, missing identity, explicit bad Bearer and cross-origin cookie writes fail closed",
      async () => {
        assert.equal(
          (
            await provider.auth.admin.updateUserById(hr.id, {
              user_metadata: { role: "ADMIN" },
            })
          ).error,
          null,
        );
        assert.equal((await call("/api/admin/staff", hr)).status, 403);
        assert.equal((await call("/api/admin/staff", null)).status, 401);
        assert.equal(
          (
            await call("/api/admin/staff", admin, undefined, {
              cookie: true,
              headers: { Authorization: "Bearer invalid" },
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await post({}, admin, {
              cookie: true,
              headers: { Origin: "https://foreign.invalid" },
            })
          ).status,
          403,
        );
        assert.equal((await post({}, admin, { cookie: true })).status, 400);
        for (const body of [
          {
            action: "link",
            userId: reader.id,
            displayName: "Synthetic",
            role: "ADMIN",
            requestId: randomUUID(),
          },
          {
            action: "invite",
            email: "never-send@example.invalid",
            displayName: "Synthetic",
            active: true,
            requestId: randomUUID(),
          },
          {
            action: "change",
            userId: reader.id,
            role: "HR",
            active: true,
            requestId: randomUUID(),
          },
        ])
          assert.equal((await post(body)).status, 400);
        for (const query of [
          "page=0",
          "page=1&page=2",
          "email=private@example.invalid",
        ]) {
          const r = await call("/api/admin/staff?" + query);
          assert.equal(r.status, 400);
          assert.ok(!(await r.text()).includes("private@example.invalid"));
        }
      },
    );
    await t.test(
      "direct console pages restrict privileged sections and Read-Only lands on Jobs",
      async () => {
        for (const user of [hr, reader]) {
          const r = await call("/admin/accounts?lang=en", user, undefined, {
            cookie: true,
          });
          assert.equal(r.status, 200);
          assert.ok((await r.text()).includes(accountsContent.en.noPermTitle));
        }
        const landing = await call("/admin?lang=en", reader, undefined, {
          cookie: true,
        });
        assert.ok([303, 307].includes(landing.status));
        assert.match(landing.headers.get("location"), /\/admin\/jobs/);
      },
    );
    await t.test(
      "linking an existing verified Auth user starts inactive Read-Only and activation returns a version",
      async () => {
        const created = await provider.auth.admin.createUser({
          email: `team-link-${randomUUID()}@example.invalid`,
          password: randomBytes(32).toString("base64url"),
          email_confirm: true,
        });
        assert.equal(created.error, null);
        const id = created.data.user.id;
        extraIds.push(id);
        const link = {
          action: "link",
          userId: id,
          displayName: "Synthetic linked member",
          requestId: randomUUID(),
        };
        for (let i = 0; i < 2; i++)
          assert.equal((await post(link)).status, 200);
        assert.deepEqual(await profile(id), {
          role: "READ_ONLY",
          active: false,
          version: 1,
        });
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int n FROM portal.audit_logs WHERE object_id=$1 AND action='STAFF_LINKED'",
              [id],
            )
          ).rows[0].n,
          1,
        );
        const activated = await post({
          action: "change",
          userId: id,
          role: "HR",
          active: true,
          expectedVersion: 1,
          requestId: randomUUID(),
        });
        assert.ok([200, 202].includes(activated.status));
        const result = await activated.json();
        assert.equal(result.version, 2);
        if (result.providerSync === "pending")
          assert.equal(
            (
              await post({
                action: "reconcile",
                operationId: result.operationId,
                requestId: randomUUID(),
              })
            ).status,
            200,
          );
        assert.deepEqual(await profile(id), {
          role: "HR",
          active: true,
          version: 2,
        });
      },
    );
    await t.test(
      "competing changes reject the stale version, revoke old sessions and replay without extra audit",
      async () => {
        const version = (await profile(hr.id)).version;
        const bodies = ["READ_ONLY", "ADMIN"].map((role) => ({
          action: "change",
          userId: hr.id,
          role,
          active: true,
          expectedVersion: version,
          requestId: randomUUID(),
        }));
        const responses = await Promise.all(bodies.map((body) => post(body)));
        assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
        const winner = responses.findIndex((r) => r.status === 200);
        const first = await responses[winner].json();
        assert.equal(first.version, version + 1);
        assert.equal((await call("/api/admin/me", hr)).status, 401);
        const replay = await post(bodies[winner]);
        assert.equal(replay.status, 200);
        assert.equal((await replay.json()).version, first.version);
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int n FROM portal.audit_logs WHERE request_id=$1 AND action='STAFF_CHANGED'",
              [bodies[winner].requestId],
            )
          ).rows[0].n,
          1,
        );
        const noOp = {
          ...bodies[winner],
          expectedVersion: first.version,
          requestId: randomUUID(),
        };
        assert.equal((await (await post(noOp)).json()).version, first.version);
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int n FROM portal.audit_logs WHERE request_id=$1",
              [noOp.requestId],
            )
          ).rows[0].n,
          0,
        );
        assert.equal(
          (await post({ ...bodies[winner], role: "HR" })).status,
          409,
        );
        assert.equal(
          (
            await post({
              action: "change",
              userId: admin.id,
              role: "HR",
              active: true,
              expectedVersion: (await profile(admin.id)).version,
              requestId: randomUUID(),
            })
          ).status,
          403,
        );
      },
    );
    await t.test(
      "pending provider synchronization survives API/page reloads and reconciliation is repeatable",
      async () => {
        const version = (await account(reader.id)).version;
        const operation = await withRuntime(
          admin.id,
          async (runtimeDb) =>
            (
              await runtimeDb.query(
                "SELECT portal_private.manage_team_change($1,$2,'READ_ONLY',false,$3) result",
                [reader.id, version, randomUUID()],
              )
            ).rows[0].result.operationId,
          undefined,
          admin.sessionId,
        );
        assert.ok(operation);
        assert.equal((await call("/api/admin/me", reader)).status, 401);
        for (const lang of ["en", "zh"]) {
          assert.equal(
            (await account(reader.id)).pendingOperationId,
            operation,
          );
          const r = await call(
            `/admin/accounts?lang=${lang}`,
            admin,
            undefined,
            { cookie: true },
          );
          assert.equal(r.status, 200);
          assert.ok((await r.text()).includes(staffUiText[lang].retry));
        }
        for (let i = 0; i < 2; i++) {
          const r = await post({
            action: "reconcile",
            operationId: operation,
            requestId: randomUUID(),
          });
          assert.equal(r.status, 200);
          assert.equal((await r.json()).providerSync, "complete");
        }
        assert.equal((await account(reader.id)).pendingOperationId, null);
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int n FROM portal.audit_logs WHERE object_id=$1 AND action='STAFF_PROVIDER_SYNCED'",
              [reader.id],
            )
          ).rows[0].n,
          1,
        );
      },
    );
    await t.test(
      "simultaneous administrators cannot deactivate each other after their own authority is revoked",
      async () => {
        const [adminBefore, otherBefore] = await Promise.all([
          profile(admin.id),
          profile(otherAdmin.id),
        ]);
        const responses = await Promise.all([
          post(
            {
              action: "change",
              userId: otherAdmin.id,
              role: "ADMIN",
              active: false,
              expectedVersion: otherBefore.version,
              requestId: randomUUID(),
            },
            admin,
          ),
          post(
            {
              action: "change",
              userId: admin.id,
              role: "ADMIN",
              active: false,
              expectedVersion: adminBefore.version,
              requestId: randomUUID(),
            },
            otherAdmin,
          ),
        ]);
        const statuses = responses.map((response) => response.status);
        const states = await Promise.all([
          profile(admin.id),
          profile(otherAdmin.id),
        ]);
        assert.equal(
          states.filter((s) => s.active).length,
          1,
          `Concurrent statuses: ${statuses}`,
        );
        assert.equal(
          responses.filter((r) => [200, 202].includes(r.status)).length,
          1,
          `Concurrent statuses: ${statuses}`,
        );
        assert.equal(
          responses.filter((r) => [401, 403].includes(r.status)).length,
          1,
          `Concurrent statuses: ${statuses}`,
        );
      },
    );
  },
);
