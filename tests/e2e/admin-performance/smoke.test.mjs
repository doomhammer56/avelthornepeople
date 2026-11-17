import test from "node:test";
import assert from "node:assert/strict";

// Run against a local `next start` instance. These checks never authenticate or write data.
const base = process.env.ADMIN_PERFORMANCE_BASE_URL ?? "http://127.0.0.1:3187";
const languageCookies = (response) =>
  response.headers
    .getSetCookie()
    .filter((value) => /^(NEXT_LOCALE|portal-auth-language)=/.test(value));

test("new admin read endpoints retain admission, privacy headers, and sanitized timings", async () => {
  for (const path of [
    "/api/admin/applications/count",
    "/api/admin/applications/options",
    "/api/admin/applications/11111111-1111-1111-1111-111111111111",
    "/api/admin/jobs/summary",
    "/api/admin/settings",
    "/api/admin/dashboard?range=30",
  ]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 401, path);
    assert.match(response.headers.get("cache-control"), /private.*no-store/);
    assert.match(
      response.headers.get("server-timing"),
      /^identity;dur=\d+\.\d, total;dur=\d+\.\d$/,
    );
  }
});

test("speculative Flight and browser prefetches cannot persist language cookies", async () => {
  for (const headers of [
    { rsc: "1", "next-router-prefetch": "1" },
    {
      rsc: "1",
      "next-router-prefetch": "1",
      "next-router-segment-prefetch": "/_tree",
    },
    { purpose: "prefetch" },
    { "sec-purpose": "prefetch;prerender" },
  ]) {
    const response = await fetch(base + "/admin/login?lang=zh", { headers });
    assert.equal(response.status, 200);
    assert.deepEqual(languageCookies(response), [], JSON.stringify(headers));
    await response.body?.cancel();
  }
});

test("document navigation still persists the selected language", async () => {
  const response = await fetch(base + "/admin/login?lang=zh", {
    headers: { accept: "text/html" },
  });
  assert.equal(response.status, 200);
  assert.ok(
    languageCookies(response).some((value) =>
      value.startsWith("NEXT_LOCALE=zh;"),
    ),
  );
  assert.ok(
    languageCookies(response).some((value) =>
      value.startsWith("portal-auth-language=zh;"),
    ),
  );
  await response.body?.cancel();
});

test("protected cached console pages redirect unauthenticated requests", async () => {
  for (const path of [
    "/admin",
    "/admin/jobs",
    "/admin/applications",
    "/admin/applications/11111111-1111-1111-1111-111111111111",
  ]) {
    const response = await fetch(base + path, {
      redirect: "manual",
    });
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "/admin/login");
  }
});

test("public EN/ZH Careers and company pages render through the new loading/cache boundaries", async () => {
  for (const path of [
    "/en/careers",
    "/zh/careers",
    "/en/about",
    "/zh/about",
    "/en/services",
  ]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.ok(!html.includes("NEXT_HTTP_ERROR_FALLBACK;500"), path);
    assert.ok(html.includes("<html"), path);
  }
});
