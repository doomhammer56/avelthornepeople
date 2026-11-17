import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { readStaffAccounts } from "../../../src/server/team/service.ts";

function fixture(size = 50, failure = null) {
  const identity = {
    subject: randomUUID(),
    sessionId: randomUUID(),
    token: "unused-verified-token",
  };
  const rows = Array.from({ length: size }, (_, i) => {
    const id = randomUUID();
    return {
      id,
      provider_id: id,
      display_name: `Staff ${i}`,
      role: "HR",
      active: true,
      version: 3,
      email: `staff-${i}@example.invalid`,
      last_sign_in_at: new Date("2026-10-27T07:10:11Z"),
      pending_operation_id: i === 0 ? randomUUID() : null,
    };
  });
  const sql = [],
    providerCalls = [];
  const dependencies = {
    staffRead: async (actual, roles, action) => {
      assert.equal(actual, identity);
      assert.deepEqual(roles, ["ADMIN"]);
      return action({
        query: async (statement, values) => {
          sql.push({ statement, values });
          if (failure) throw failure;
          if (statement.includes("pending_team_operations"))
            return {
              rows: rows
                .filter((row) => row.pending_operation_id)
                .map((row) => ({
                  profile_id: row.id,
                  operation_id: row.pending_operation_id,
                })),
            };
          return { rows };
        },
      });
    },
    requirePermission: async () => {},
    authAdminClient: () => ({
      auth: {
        admin: {
          getUserById: async (id) => {
            providerCalls.push(id);
            const row = rows.find((row) => row.id === id);
            return {
              data: {
                user: {
                  id,
                  email: row.email,
                  last_sign_in_at: row.last_sign_in_at?.toISOString(),
                },
              },
              error: null,
            };
          },
        },
      },
    }),
  };
  return { identity, rows, sql, providerCalls, dependencies };
}

test("a staff page uses one bounded SQL read and no per-account Auth API calls", async () => {
  for (const size of [1, 20, 50]) {
    const f = fixture(size);
    const result = await readStaffAccounts(f.identity, 1, f.dependencies);
    assert.equal(result.accounts.length, size);
    assert.equal(result.accounts[0].email, f.rows[0].email);
    assert.equal(
      result.accounts[0].pendingOperationId,
      f.rows[0].pending_operation_id,
    );
    assert.equal(result.accounts[0].lastLogin.en, "2026-10-27T07:10:11.000Z");
    assert.equal(result.hasMore, false);
    assert.equal(f.providerCalls.length, 0);
    assert.equal(f.sql.length, 1);
    assert.deepEqual(f.sql[0].values, [1]);
  }
});

test("lookahead is excluded from the DTO and empty pages remain valid", async () => {
  const f = fixture(51);
  const result = await readStaffAccounts(f.identity, 2, f.dependencies);
  assert.equal(result.accounts.length, 50);
  assert.equal(result.hasMore, true);
  assert.equal(result.page, 2);
  assert.equal(JSON.stringify(result).includes(f.rows[50].id), false);
  const empty = fixture(0);
  assert.deepEqual(
    await readStaffAccounts(empty.identity, 1, empty.dependencies),
    { accounts: [], page: 1, hasMore: false },
  );
});

test("missing provider identities and unknown roles fail closed", async () => {
  for (const change of [{ provider_id: null }, { role: "SUPER_ADMIN" }]) {
    const f = fixture(1);
    Object.assign(f.rows[0], change);
    await assert.rejects(readStaffAccounts(f.identity, 1, f.dependencies), {
      status: 503,
    });
  }
});

test("invalid pages cannot reach the data boundary and SQL denial becomes 403", async () => {
  const f = fixture(1);
  for (const page of [0, -1, 1.5, 10001, NaN])
    await assert.rejects(readStaffAccounts(f.identity, page, f.dependencies), {
      status: 400,
    });
  assert.equal(f.sql.length, 0);
  const denied = fixture(
    1,
    Object.assign(new Error("Denied"), { code: "42501" }),
  );
  await assert.rejects(
    readStaffAccounts(denied.identity, 1, denied.dependencies),
    { status: 403 },
  );
});

test("null email and last-login values keep their display fallbacks", async () => {
  const f = fixture(1);
  Object.assign(f.rows[0], { email: null, last_sign_in_at: null });
  const result = await readStaffAccounts(f.identity, 1, f.dependencies);
  assert.equal(result.accounts[0].email, "");
  assert.deepEqual(result.accounts[0].lastLogin, { en: "—", zh: "—" });
});
