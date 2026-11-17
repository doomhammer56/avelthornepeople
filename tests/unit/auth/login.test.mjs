import test from "node:test";
import assert from "node:assert/strict";
import { loginStaff, passwordError } from "../../../src/server/auth/login.ts";
import {
  StaffAuthError,
  authErrorResponse,
} from "../../../src/server/auth/errors.ts";
process.env.AUTH_LIMITER_SECRET = "unit-only-stable-secret-32-characters";
const input = {
  email: "  STAFF@Example.invalid  ",
  password: "password",
  captchaToken: "challenge",
};
const identity = { subject: "subject", sessionId: "session", token: "token" };

function fixture({
  start = { outcome: "ready", reservation_id: "ticket" },
  end,
  error,
  identifyError,
  finishError,
} = {}) {
  const calls = [];
  const repo = {
    begin: async (key) => {
      calls.push(["begin", key]);
      return start;
    },
    finish: async (...args) => {
      calls.push(["finish", ...args]);
      if (finishError) throw finishError;
      return end ?? { outcome: args[2] === "success" ? "admitted" : args[2] };
    },
  };
  const client = {
    auth: {
      signInWithPassword: async (payload) => {
        calls.push(["provider", payload]);
        return {
          data: { session: error ? null : { access_token: "token" } },
          error,
        };
      },
      signOut: async () => {
        calls.push(["signout"]);
        return { error: null };
      },
    },
  };
  const run = () =>
    loginStaff(
      client,
      input,
      () => calls.push(["clear"]),
      repo,
      async () => {
        if (identifyError) throw identifyError;
        return identity;
      },
    );
  return { calls, run };
}
test("Only provider-confirmed invalid credentials count; other errors preserve failures", async () => {
  for (const [error, outcome, status, code] of [
    [
      { code: "invalid_credentials", status: 400 },
      "invalid",
      401,
      "invalid_login",
    ],
    [{ code: "captcha_failed", status: 400 }, "abort", 400, "captcha_failed"],
    [{ code: "invalid_credentials", status: 503 }, "abort", 503, undefined],
    [{ status: 429 }, "abort", 429, "provider_limited"],
    [
      { code: "email_not_confirmed", status: 400 },
      "abort",
      401,
      "invalid_login",
    ],
    [{ code: "user_banned", status: 403 }, "abort", 401, "invalid_login"],
    [{}, "abort", 503, undefined],
  ]) {
    const f = fixture({ error });
    await assert.rejects(
      f.run(),
      (e) => e.status === status && e.code === code,
    );
    assert.equal(f.calls.find((c) => c[0] === "finish")[3], outcome);
    assert.equal(
      f.calls.find((c) => c[0] === "provider")[1].email,
      "staff@example.invalid",
    );
    assert.ok(f.calls.some((c) => c[0] === "clear"));
  }
});
test("Locked and busy identifiers never contact the password endpoint", async () => {
  for (const [outcome, code] of [
    ["locked", "login_locked"],
    ["busy", "login_busy"],
  ]) {
    const f = fixture({ start: { outcome, retry_after_seconds: 37 } });
    await assert.rejects(f.run(), { status: 429, code, retryAfterSeconds: 37 });
    assert.deepEqual(
      f.calls.map((c) => c[0]),
      ["begin"],
    );
  }
});
test("The fifth failure is committed before returning the lock response", async () => {
  const f = fixture({
    error: { code: "invalid_credentials", status: 400 },
    end: { outcome: "locked", retry_after_seconds: 900 },
  });
  await assert.rejects(f.run(), {
    code: "login_locked",
    retryAfterSeconds: 900,
  });
  assert.equal(f.calls.filter((c) => c[0] === "finish").length, 1);
});
test("Verified identity is bound to admission; successful login keeps buffered cookies", async () => {
  const f = fixture();
  await f.run();
  assert.deepEqual(
    f.calls.map((c) => c[0]),
    ["begin", "provider", "finish"],
  );
  assert.deepEqual(f.calls.at(-1).slice(2), ["ticket", "success", identity]);
});
test("Denied, stale, identity and commit failures revoke provisional sessions and clear cookies", async () => {
  for (const options of [
    { end: { outcome: "denied" } },
    { end: { outcome: "stale" } },
    { identifyError: new StaffAuthError(401) },
    { finishError: new Error("Database unavailable") },
  ]) {
    const f = fixture(options);
    await assert.rejects(f.run());
    assert.ok(f.calls.some((c) => c[0] === "signout"));
    assert.ok(f.calls.some((c) => c[0] === "clear"));
  }
});
test("Rate-limit errors expose actual server duration and never label all throttles as account locks", async () => {
  const response = authErrorResponse(
    new StaffAuthError(429, "login_locked", 31.2),
  );
  assert.equal(response.headers.get("retry-after"), "32");
  assert.equal((await response.json()).retryAfterSeconds, 32);
  const provider = authErrorResponse(passwordError({ status: 429 }));
  assert.equal(provider.headers.get("retry-after"), null);
  assert.equal((await provider.json()).code, "provider_limited");
});
