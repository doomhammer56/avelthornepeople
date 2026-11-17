import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  authConfig,
  appOrigin,
  requireCaptchaConfiguration,
} from "../../../src/server/adapters/auth/config.ts";
import {
  assertSameOrigin,
  readAuthBody,
  safeConsolePath,
  staffConsolePath,
} from "../../../src/server/auth/http.ts";
import { attemptKey } from "../../../src/server/auth/limiter.ts";
import {
  verifyIdentity,
  requestIdentity,
} from "../../../src/server/auth/identity.ts";
import { staffInTransaction } from "../../../src/server/auth/staff.ts";
import { withRuntime } from "../../../src/server/database/runtime.ts";
import { connectAuthTestDatabase } from "../../../scripts/auth/test-env.mjs";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_unit_fixture";
process.env.AUTH_APP_ORIGIN = "https://console.example.com";
const subject = randomUUID(),
  sessionId = randomUUID();
const claims = {
  sub: subject,
  session_id: sessionId,
  iss: "https://example.supabase.co/auth/v1",
  aud: "authenticated",
  role: "authenticated",
  exp: Math.floor(Date.now() / 1000) + 3600,
};
const mock = (overrides = {}, error = null) => ({
  auth: {
    getClaims: async () => ({
      data: { claims: { ...claims, ...overrides } },
      error,
    }),
    getUser: async () => ({ data: { user: { id: subject } }, error: null }),
  },
});

test("An admitted session returns to a safe console destination with role-appropriate landing and language", () => {
  assert.equal(staffConsolePath(undefined, "ADMIN", "en"), "/admin?lang=en");
  assert.equal(staffConsolePath(undefined, "HR", "zh"), "/admin?lang=zh");
  assert.equal(
    staffConsolePath(undefined, "READ_ONLY", "zh"),
    "/admin/jobs?lang=zh",
  );
  assert.equal(
    staffConsolePath("/admin/jobs?page=2", "HR", "zh"),
    "/admin/jobs?page=2&lang=zh",
  );
  assert.equal(
    staffConsolePath("/admin/jobs?lang=en", "HR", "zh"),
    "/admin/jobs?lang=en",
  );
  for (const next of [
    "https://outside.invalid",
    "//outside.invalid/admin",
    "/admin/login",
    "/admin/forgot-password",
    "/admin/../admin/login",
    "/admin?x=%2Fadmin%2Flogin",
  ])
    assert.equal(
      staffConsolePath(next, "READ_ONLY", "en"),
      "/admin/jobs?lang=en",
    );
});

test("Auth configuration accepts only safe origins and ordinary API keys", () => {
  assert.equal(authConfig().url, "https://example.supabase.co");
  for (const url of [
    "https://user:secret@example.com",
    "http://example.com",
    "https://example.com/path",
    "https://example.com?x=1",
  ]) {
    assert.throws(
      () =>
        authConfig({
          SUPABASE_URL: url,
          SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
        }),
      { status: 503 },
    );
  }
  assert.throws(
    () =>
      authConfig({
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: "sb_secret_private",
      }),
    { status: 503 },
  );
  assert.equal(
    appOrigin({ AUTH_APP_ORIGIN: "http://127.0.0.1:3000" }),
    "http://127.0.0.1:3000",
  );
});
test("Test setup retries DNS with a fresh client and never retries fixture writes", async () => {
  let attempts = 0,
    closed = 0;
  const client = await connectAuthTestDatabase(() => {
    const attempt = ++attempts;
    return {
      connect: async () => {
        if (attempt === 1)
          throw Object.assign(new Error("DNS"), { code: "ENOTFOUND" });
      },
      end: async () => {
        closed++;
      },
      marker: attempt,
    };
  });
  assert.equal(client.marker, 2);
  assert.equal(closed, 1);
  await assert.rejects(
    connectAuthTestDatabase(() => ({
      connect: async () => {
        throw Object.assign(new Error("denied"), { code: "42501" });
      },
      end: async () => {},
    })),
    { code: "42501" },
  );
});
test("Cookie mutations require the configured origin, regardless of spoofed Host", () => {
  assertSameOrigin(
    new Request("https://spoofed.invalid", {
      headers: { origin: process.env.AUTH_APP_ORIGIN },
    }),
  );
  for (const origin of ["https://attacker.invalid", "null", ""]) {
    assert.throws(
      () =>
        assertSameOrigin(
          new Request(process.env.AUTH_APP_ORIGIN, { headers: { origin } }),
        ),
      { status: 403 },
    );
  }
});
test("Missing or development CAPTCHA keys fail closed on deployed origins", () => {
  delete process.env.AUTH_TURNSTILE_SITE_KEY;
  assert.throws(() => requireCaptchaConfiguration(), { status: 503 });
  process.env.AUTH_TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
  assert.throws(() => requireCaptchaConfiguration(), { status: 503 });
  process.env.AUTH_TURNSTILE_SITE_KEY = "0x4AAAA_public_fixture";
  requireCaptchaConfiguration();
  delete process.env.AUTH_TURNSTILE_SITE_KEY;
});
test("Redirects remain on non-auth console paths", () => {
  for (const path of [
    "https://attacker.invalid",
    "//attacker.invalid",
    "/admin\\evil",
    "/admin/login",
    "/admin/reset-password",
    "/admin%2f../evil",
    "/administrator",
    "/en",
  ]) {
    assert.equal(safeConsolePath(path), "/admin");
  }
  assert.equal(safeConsolePath("/admin/jobs?page=2"), "/admin/jobs?page=2");
});
test("Auth bodies reject oversized, malformed and array payloads", async () => {
  for (const body of [
    "[1]",
    "null",
    "{bad}",
    JSON.stringify({ password: "x".repeat(24000) }),
  ])
    await assert.rejects(
      readAuthBody(
        new Request("https://console.example.com", { method: "POST", body }),
      ),
      { status: 400 },
    );
  assert.deepEqual(
    await readAuthBody(
      new Request("https://console.example.com", {
        method: "POST",
        body: '{"action":"logout"}',
      }),
    ),
    { action: "logout" },
  );
});
test("Rate-limit identifiers are opaque and scoped", () => {
  const key = attemptKey("account", "staff@example.invalid", "a".repeat(32));
  assert.match(key, /^[a-f0-9-]{36}$/);
  assert.equal(
    key,
    attemptKey("account", "staff@example.invalid", "a".repeat(32)),
  );
  assert.notEqual(
    key,
    attemptKey("ip", "staff@example.invalid", "a".repeat(32)),
  );
  assert.throws(() => attemptKey("account", "staff@example.invalid", "short"), {
    status: 503,
  });
});
test("Identity verification requires project, audience, subject, session and expiry", async () => {
  assert.deepEqual(await verifyIdentity("token", mock()), {
    subject,
    sessionId,
    token: "token",
  });
  for (const overrides of [
    { sub: "bad" },
    { session_id: null },
    { iss: "https://attacker.invalid/auth/v1" },
    { aud: "anon" },
    { role: "service_role" },
    { exp: 1 },
  ])
    await assert.rejects(verifyIdentity("token", mock(overrides)), {
      status: 401,
    });
  await assert.rejects(verifyIdentity("token", mock({}, { status: 503 })), {
    status: 503,
  });
  await assert.rejects(verifyIdentity("token", mock({}, { status: 401 })), {
    status: 401,
  });
});
test("An explicit invalid bearer cannot fall back to a cookie", async () => {
  const client = {
    auth: {
      getSession: () => {
        throw new Error("Cookie fallback must never run");
      },
    },
  };
  await assert.rejects(
    requestIdentity(
      new Request("https://console.example.com", {
        headers: { authorization: "Basic wrong" },
      }),
      client,
    ),
    { status: 401 },
  );
});
test("Live staff lookup denies revoked sessions, inactive profiles and role escalation", async () => {
  const identity = { subject, sessionId, token: "token" };
  const db = (live, rows) => ({
    query: async () => ({ rows: [{ ...rows[0], live }] }),
  });
  await assert.rejects(staffInTransaction(db(false, []), identity), {
    status: 401,
  });
  await assert.rejects(staffInTransaction(db(true, []), identity), {
    status: 403,
  });
  await assert.rejects(
    staffInTransaction(
      db(true, [{ id: subject, display_name: "Staff", role: "READ_ONLY" }]),
      identity,
      ["ADMIN"],
    ),
    { status: 403 },
  );
  assert.deepEqual(
    await staffInTransaction(
      db(true, [{ id: subject, display_name: "Staff", role: "HR" }]),
      identity,
    ),
    { id: subject, displayName: "Staff", role: "HR" },
  );
});
test("Restricted transactions commit verified claims and roll back failures before release", async () => {
  for (const fail of [false, true]) {
    const calls = [];
    const client = {
      query: async (sql, values) => {
        calls.push({ sql, values });
        return sql.includes("FROM pg_roles")
          ? [
              { rows: [] },
              {
                rows: [
                  {
                    restricted: true,
                    runtime_member: true,
                    owner_member: false,
                  },
                ],
              },
              { rows: [] },
            ]
          : { rows: [] };
      },
      release: () => calls.push({ sql: "RELEASE" }),
    };
    const run = withRuntime(
      subject,
      async () => {
        if (fail) throw new Error("failure");
        return "ok";
      },
      { connect: async () => client },
      sessionId,
    );
    if (fail) await assert.rejects(run, /failure/);
    else assert.equal(await run, "ok");
    assert.deepEqual(
      calls.slice(-2).map((x) => x.sql),
      [fail ? "ROLLBACK" : "COMMIT", "RELEASE"],
    );
    const claimsCall = calls.find((x) => x.sql.includes("set_config"));
    assert.deepEqual(JSON.parse(claimsCall.values[1]), {
      sub: subject,
      session_id: sessionId,
    });
  }
});
test("Migration-owner, bypass and table-owner connections are rejected", async () => {
  for (const identity of [
    { restricted: false, runtime_member: true, owner_member: false },
    { restricted: true, runtime_member: false, owner_member: false },
    { restricted: true, runtime_member: true, owner_member: true },
  ]) {
    let action = false,
      released = false;
    const client = {
      query: async (sql) =>
        sql.includes("FROM pg_roles")
          ? [{ rows: [] }, { rows: [identity] }, { rows: [] }]
          : { rows: [] },
      release: () => {
        released = true;
      },
    };
    await assert.rejects(
      withRuntime(
        subject,
        async () => {
          action = true;
        },
        { connect: async () => client },
      ),
      { status: 503 },
    );
    assert.equal(action, false);
    assert.equal(released, true);
  }
});
