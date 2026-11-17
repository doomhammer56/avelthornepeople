import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { updatePassword } from "../../../src/server/auth/password.ts";
const identity = {
  subject: randomUUID(),
  sessionId: randomUUID(),
  token: "fixture-token",
};
const grant = randomBytes(32).toString("base64url"),
  password = randomBytes(24).toString("base64url");
function fixture({
  error,
  ticket = "operation",
  finalization = true,
  updateThrows = false,
  signoutThrows = false,
} = {}) {
  const calls = [];
  const repository = {
    begin: async (...args) => {
      calls.push(["begin", ...args]);
      return ticket;
    },
    finish: async (...args) => {
      calls.push(["finish", ...args]);
      return finalization;
    },
  };
  const client = {
    auth: {
      updateUser: async () => {
        calls.push(["provider-update"]);
        if (updateThrows) throw new Error("timeout");
        return { error };
      },
      signOut: async (options) => {
        calls.push(["signout", options.scope]);
        if (signoutThrows) throw new Error("outage");
        return { error: null };
      },
    },
  };
  return {
    calls,
    run: (token = grant, value = password) =>
      updatePassword(
        client,
        identity,
        token,
        value,
        () => calls.push(["clear"]),
        repository,
      ),
  };
}
test("Password update requires a valid single-use grant before contacting the provider", async () => {
  const missing = fixture();
  await assert.rejects(missing.run(""), { code: "email_link_invalid" });
  assert.equal(missing.calls.length, 0);
  const spent = fixture({ ticket: null });
  await assert.rejects(spent.run(), { code: "email_link_invalid" });
  assert.deepEqual(
    spent.calls.map((x) => x[0]),
    ["begin"],
  );
  const short = fixture();
  await assert.rejects(short.run(grant, "short"), { code: "password_weak" });
  assert.equal(short.calls.length, 0);
});
test("Known password-policy rejections and provider throttles release only the claimed operation", async () => {
  for (const [error, code] of [
    [{ code: "same_password", status: 422 }, "password_reused"],
    [{ code: "weak_password", status: 422 }, "password_weak"],
    [{ status: 429 }, "provider_limited"],
  ]) {
    const f = fixture({ error });
    await assert.rejects(f.run(), { code });
    assert.deepEqual(
      f.calls.map((x) => x[0]),
      ["begin", "provider-update", "finish"],
    );
    assert.deepEqual(f.calls[0].slice(1), [
      identity,
      createHash("sha256").update(grant).digest(),
    ]);
    assert.equal(f.calls.at(-1).at(-1), "retry");
  }
});
test("Successful password update commits app-session revocation before global sign-out", async () => {
  for (const signoutThrows of [false, true]) {
    const f = fixture({ signoutThrows });
    await f.run();
    assert.deepEqual(
      f.calls.map((x) => x[0]),
      ["begin", "provider-update", "finish", "signout", "clear"],
    );
    assert.equal(f.calls[2].at(-1), "complete");
    assert.equal(f.calls[3][1], "global");
  }
});
test("Uncertain provider writes and failed finalization never release the grant for another write", async () => {
  for (const options of [
    { error: { status: 503 } },
    { updateThrows: true },
    { finalization: false },
    { error: { status: 401, code: "session_not_found" } },
  ]) {
    const f = fixture(options);
    await assert.rejects(f.run());
    assert.ok(
      f.calls.some((x) => x[0] === "finish" && x.at(-1) === "uncertain"),
    );
    assert.ok(!f.calls.some((x) => x[0] === "finish" && x.at(-1) === "retry"));
    assert.ok(f.calls.some((x) => x[0] === "clear"));
    assert.ok(f.calls.some((x) => x[0] === "signout"));
  }
});

import { changeOwnPassword } from "../../../src/server/auth/password.ts";
function changeFixture({ loginError, grantError } = {}) {
  const calls = [];
  const verifier = {
    auth: {
      signOut: async (options) => {
        calls.push(["verifier-signout", options.scope]);
        return { error: null };
      },
    },
  };
  const dependencies = {
    verifier: () => verifier,
    login: async (client, input, clear) => {
      calls.push(["login", client === verifier, input.email, input.password]);
      clear();
      if (loginError) throw loginError;
    },
    grant: async () => {
      calls.push(["grant"]);
      if (grantError) throw grantError;
      return grant;
    },
    update: async (_client, _identity, token, value) =>
      calls.push(["update", token, value]),
  };
  const input = (overrides = {}) => ({
    client: {},
    identity,
    email: "staff@example.com",
    currentPassword: "old-password-1",
    newPassword: password,
    captchaToken: "captcha",
    clearCookies: () => calls.push(["clear-main-cookies"]),
    ...overrides,
  });
  return {
    calls,
    run: (overrides) => changeOwnPassword(input(overrides), dependencies),
  };
}
test("Changing your own password proves the current password first, then reuses the grant flow", async () => {
  const f = changeFixture();
  await f.run();
  assert.deepEqual(f.calls, [
    ["login", true, "staff@example.com", "old-password-1"],
    ["verifier-signout", "local"],
    ["grant"],
    ["update", grant, password],
  ]);
});
test("A wrong current password stops before any grant or provider update", async () => {
  const { StaffAuthError } = await import("../../../src/server/auth/errors.ts");
  const f = changeFixture({ loginError: new StaffAuthError(401, "invalid_login") });
  await assert.rejects(f.run(), { code: "invalid_login" });
  assert.deepEqual(
    f.calls.map((x) => x[0]),
    ["login"],
  );
});
test("Weak or unchanged passwords are rejected without contacting the provider", async () => {
  const weak = changeFixture();
  await assert.rejects(weak.run({ newPassword: "short" }), {
    code: "password_weak",
  });
  const same = changeFixture();
  await assert.rejects(
    same.run({ currentPassword: password, newPassword: password }),
    { code: "password_reused" },
  );
  const tiny = changeFixture();
  await assert.rejects(tiny.run({ currentPassword: "x" }), {
    code: "invalid_login",
  });
  for (const f of [weak, same, tiny]) assert.equal(f.calls.length, 0);
});
