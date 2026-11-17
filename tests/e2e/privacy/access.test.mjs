import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import pg from "pg";
import {
  loadAuthTestEnvironment,
  connectAuthTestDatabase,
} from "../../../scripts/auth/test-env.mjs";
import { verifiedDatabaseConfig } from "../../../src/server/database/tls.ts";

loadAuthTestEnvironment();
const { createStaffSession } = await import("../../helpers/staff-session.mjs");
test(
  "built privacy endpoints enforce anonymous, HR and READ_ONLY boundaries before data access",
  { timeout: 180000 },
  async (t) => {
    const db = await connectAuthTestDatabase(
      () =>
        new pg.Client(
          verifiedDatabaseConfig({
            connectionString: process.env.DIRECT_URL,
            connectionTimeoutMillis: 15000,
          }),
        ),
    );
    const users = [];
    let child;
    t.after(async () => {
      if (child && child.exitCode === null) {
        const exited = new Promise((resolve) => child.once("exit", resolve));
        child.kill();
        await exited;
      }
      try {
        await db.query(
          "DELETE FROM portal.staff_profiles WHERE id=ANY($1::uuid[])",
          [users.map((user) => user.id)],
        );
      } finally {
        await db.end();
        for (const user of users) await user.remove();
      }
    });
    for (const role of ["HR", "READ_ONLY"])
      users.push(await createStaffSession(db, role));
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
        stdio: "ignore",
        windowsHide: true,
      },
    );
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const response = await fetch(`${origin}/api/health`, {
          signal: AbortSignal.timeout(1000),
        });
        await response.body?.cancel();
        if (response.status === 200) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.ok(ready, "Build the production application before privacy E2E");
    const id = "11111111-1111-4111-8111-111111111111";
    const paths = [
      ["GET", "/api/admin/privacy/policy"],
      ["PUT", "/api/admin/privacy/policy"],
      ["GET", "/api/admin/privacy/requests"],
      ["POST", "/api/admin/privacy/requests"],
      ["GET", `/api/admin/privacy/requests/${id}`],
      ["POST", `/api/admin/privacy/requests/${id}/actions`],
      ["GET", "/api/admin/privacy/holds"],
      ["POST", `/api/admin/privacy/holds/${id}`],
    ];
    for (const user of [null, ...users]) {
      for (const [method, path] of paths) {
        const response = await fetch(origin + path, {
          method,
          signal: AbortSignal.timeout(15000),
          headers: user ? { authorization: `Bearer ${user.token}` } : {},
        });
        assert.equal(
          response.status,
          user ? 403 : 401,
          `${user?.role ?? "anonymous"} ${method} ${path}`,
        );
        assert.match(
          response.headers.get("cache-control"),
          /private.*no-store/,
        );
        const text = await response.text();
        assert.ok(
          !text.includes("candidate_id") && !text.includes("connectionString"),
        );
      }
    }
    const crossSite = await fetch(`${origin}/api/privacy/deletion-requests`, {
      method: "POST",
      headers: {
        origin: "https://other.invalid",
        "content-type": "application/json",
      },
      body: "{}",
    });
    assert.equal(crossSite.status, 403);
    const cron = await fetch(`${origin}/api/internal/cron/privacy-cleanup`);
    assert.equal(cron.status, 401);
  },
);
