import assert from "node:assert/strict";
import test from "node:test";
import { createDatabasePool } from "../../../src/server/database/pool.ts";

test("idle pool disconnects are handled without exposing connection or error details", async (t) => {
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args));
  const secret = "do-not-log-password-or-candidate-data";
  const pool = createDatabasePool("runtime", {
    connectionString: `postgresql://test:${secret}@localhost/test`,
    max: 2,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
  });
  t.after(() => pool.end());
  const error = Object.assign(new Error(secret), {
    code: "57P01",
    detail: secret,
  });
  assert.doesNotThrow(() => pool.emit("error", error, { password: secret }));
  assert.deepEqual(logs, [
    ["database_pool_error", { pool: "runtime", code: "57P01" }],
  ]);
  assert.equal(JSON.stringify(logs).includes(secret), false);
  assert.equal(pool.options.max, 2);
  assert.equal(pool.options.connectionTimeoutMillis, 10000);
  assert.equal(pool.options.statement_timeout, 10000);
});

test("all pool labels handle network and unknown error codes with bounded logs", async (t) => {
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args));
  for (const name of ["runtime", "public", "analytics", "jobs-worker"]) {
    const pool = createDatabasePool(name, {});
    try {
      pool.emit("error", { code: "ECONNRESET" });
      pool.emit("error", { code: "untrusted-error-content\nsecret" });
      pool.emit("error", new Error("secret"));
      assert.deepEqual(logs.splice(0), [
        ["database_pool_error", { pool: name, code: "ECONNRESET" }],
        ["database_pool_error", { pool: name, code: "UNKNOWN" }],
        ["database_pool_error", { pool: name, code: "UNKNOWN" }],
      ]);
    } finally {
      await pool.end();
    }
  }
});
