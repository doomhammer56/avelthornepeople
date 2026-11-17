import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { reconcileStaffProviderOperation } from "../../../src/server/auth/lifecycle.ts";
const identity = {
  subject: randomUUID(),
  sessionId: randomUUID(),
  token: "verified",
};
function fixture({
  state = "claimed",
  operation = "ban",
  error = null,
  throws = false,
  failCompletion = false,
} = {}) {
  let active = 0,
    claimed = false;
  const calls = [];
  const target = randomUUID();
  const dependencies = {
    requireStaff: async () => calls.push("gate"),
    staffInTransaction: async () => calls.push("authorize"),
    withRuntime: async (subject, action, pool, sessionId) => {
      assert.equal(subject, identity.subject);
      assert.equal(sessionId, identity.sessionId);
      active++;
      calls.push("begin");
      try {
        return await action({
          query: async (sql, values) => {
            calls.push({ sql, values });
            if (sql.includes("claim_staff_provider_operation")) {
              claimed = true;
              return { rows: [{ state, operation, profile_id: target }] };
            }
            if (failCompletion) throw new Error("commit unavailable");
            return { rows: [] };
          },
        });
      } finally {
        active--;
        calls.push("release");
      }
    },
    authAdminClient: () => ({
      auth: {
        admin: {
          updateUserById: async (id, options) => {
            assert.equal(active, 0, "no database connection across HTTP");
            assert.equal(claimed, true);
            assert.equal(id, target);
            assert.deepEqual(options, {
              ban_duration: operation === "ban" ? "876000h" : "none",
            });
            calls.push("http");
            if (throws) throw new Error("timeout");
            return { error };
          },
        },
      },
    }),
  };
  return { calls, dependencies };
}
test("Provider HTTP runs after claim commit/release, followed by fresh authorization and token-bound completion", async () => {
  for (const operation of ["ban", "unban"]) {
    const f = fixture({ operation });
    const id = randomUUID();
    assert.equal(
      (await reconcileStaffProviderOperation(identity, id, f.dependencies))
        .providerSync,
      "complete",
    );
    const queries = f.calls.filter((c) => typeof c === "object");
    assert.equal(queries.length, 2);
    assert.deepEqual(queries[1].values, [id, queries[0].values[1], true]);
    assert.equal(f.calls.filter((c) => c === "authorize").length, 2);
    assert.ok(f.calls.indexOf("release") < f.calls.indexOf("http"));
  }
});
test("Existing/complete claims never issue another provider call", async () => {
  for (const state of ["pending", "complete"]) {
    const f = fixture({ state });
    assert.equal(
      (
        await reconcileStaffProviderOperation(
          identity,
          randomUUID(),
          f.dependencies,
        )
      ).providerSync,
      state,
    );
    assert.equal(f.calls.includes("http"), false);
  }
});
test("Unknown outcomes retain claims; only definitive provider rejection releases for retry", async () => {
  for (const settings of [
    { throws: true },
    { error: { status: 500 } },
    { error: { status: 408 } },
    { error: { status: 429 } },
    { error: { status: 403 } },
  ]) {
    const f = fixture(settings);
    await assert.rejects(() =>
      reconcileStaffProviderOperation(identity, randomUUID(), f.dependencies),
    );
    const finish = f.calls.filter(
      (c) =>
        typeof c === "object" && c.sql.includes("finish_staff_provider_claim"),
    );
    if ([429, 403].includes(settings.error?.status))
      assert.equal(finish[0].values[2], false);
    else assert.equal(finish.length, 0);
  }
  const f = fixture({ failCompletion: true });
  await assert.rejects(() =>
    reconcileStaffProviderOperation(identity, randomUUID(), f.dependencies),
  );
  assert.equal(f.calls.filter((c) => c === "http").length, 1);
  const unavailable = fixture();
  unavailable.dependencies.authAdminClient = () => {
    throw new Error("invalid configuration");
  };
  await assert.rejects(() =>
    reconcileStaffProviderOperation(
      identity,
      randomUUID(),
      unavailable.dependencies,
    ),
  );
  assert.equal(unavailable.calls.includes("http"), false);
  assert.equal(
    unavailable.calls.find(
      (c) =>
        typeof c === "object" && c.sql.includes("finish_staff_provider_claim"),
    ).values[2],
    false,
  );
});
