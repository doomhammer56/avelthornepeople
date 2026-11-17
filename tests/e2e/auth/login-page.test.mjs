import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import pg from "pg";
import {
  loadAuthTestEnvironment,
  connectAuthTestDatabase,
} from "../../../scripts/auth/test-env.mjs";
loadAuthTestEnvironment();
const { createStaffSession } = await import("../../helpers/staff-session.mjs");

test(
  "Built login redirects and branded missing pages preserve admission, role and language boundaries",
  { timeout: 240000 },
  async (t) => {
    const db = await connectAuthTestDatabase(
      () =>
        new pg.Client({
          connectionString: process.env.DIRECT_URL,
          connectionTimeoutMillis: 15000,
          statement_timeout: 15000,
        }),
    );
    const users = [];
    let child;
    t.after(async () => {
      if (child && child.exitCode === null) {
        const stopped = new Promise((resolve) => child.once("exit", resolve));
        child.kill();
        await stopped;
      }
      try {
        await db.query("BEGIN");
        const ids = users.map((u) => u.id);
        await db.query(
          "DELETE FROM portal_private.staff_session_admissions WHERE subject_id=ANY($1::uuid[])",
          [ids],
        );
        await db.query(
          "DELETE FROM portal_private.staff_session_cutoffs WHERE profile_id=ANY($1::uuid[])",
          [ids],
        );
        await db.query(
          "DELETE FROM portal.staff_profiles WHERE id=ANY($1::uuid[])",
          [ids],
        );
        await db.query("COMMIT");
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        await db.end();
        for (const user of users) await user.remove();
      }
    });
    for (const role of ["ADMIN", "HR", "READ_ONLY"])
      users.push(await createStaffSession(db, role));
    const [admin, hr, reader] = users;
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
        env: {
          ...process.env,
          AUTH_APP_ORIGIN: origin,
          PUBLIC_SITE_URL: origin,
        },
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
    assert.ok(ready, "Run npm run build before the login page suite.");
    const call = (path, user, cookieExtra = "") =>
      fetch(origin + path, {
        headers: user
          ? { Cookie: `${user.cookie}${cookieExtra ? `; ${cookieExtra}` : ""}` }
          : {},
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
      });

    await t.test(
      "anonymous visitors and invented cookies see a login form, not a redirect",
      async () => {
        for (const user of [
          undefined,
          {
            cookie: `sb-${process.env.AUTH_TEST_PROJECT_REF}-auth-token=invalid`,
          },
        ]) {
          const r = await call("/admin/login?lang=en", user);
          assert.equal(r.status, 200);
          assert.equal(r.headers.get("location"), null);
          assert.match(r.headers.get("cache-control"), /private.*no-store/);
          assert.ok(
            (await r.text()).includes("Sign in to your staff workspace."),
          );
        }
      },
    );
    await t.test(
      "all admitted roles leave login for their correct EN/ZH landing page",
      async () => {
        for (const user of users)
          for (const lang of ["en", "zh"]) {
            const r = await call(`/admin/login?lang=${lang}`, user);
            assert.equal(r.status, 307);
            const url = new URL(r.headers.get("location"), origin);
            assert.equal(
              url.pathname,
              user === reader ? "/admin/jobs" : "/admin",
            );
            assert.equal(url.searchParams.get("lang"), lang);
            assert.match(r.headers.get("cache-control"), /private.*no-store/);
            await r.body?.cancel();
          }
      },
    );
    await t.test(
      "safe return paths keep filters; external and login destinations cannot cause redirect loops",
      async () => {
        const good = await call(
          "/admin/login?lang=zh&next=" +
            encodeURIComponent("/admin/jobs?page=2&status=published"),
          admin,
        );
        assert.equal(good.status, 307);
        const url = new URL(good.headers.get("location"), origin);
        assert.equal(url.pathname, "/admin/jobs");
        assert.equal(url.searchParams.get("page"), "2");
        assert.equal(url.searchParams.get("lang"), "zh");
        for (const next of [
          "https://outside.invalid",
          "//outside.invalid/admin",
          "/admin/login",
          "/admin/forgot-password",
        ]) {
          const r = await call(
            "/admin/login?lang=en&next=" + encodeURIComponent(next),
            reader,
          );
          assert.equal(r.status, 307);
          assert.equal(
            new URL(r.headers.get("location"), origin).pathname,
            "/admin/jobs",
          );
        }
      },
    );
    await t.test(
      "explicit console language overrides old cookies and the public-site link follows it",
      async () => {
        const r = await call(
          "/admin/jobs?lang=zh&status=published",
          hr,
          "NEXT_LOCALE=en; portal-auth-language=en",
        );
        assert.equal(r.status, 200);
        const html = await r.text();
        assert.match(html, /<html[^>]*lang="zh-CN"/);
        assert.ok(html.includes("招聘管理后台"));
        assert.match(
          html,
          /<a[^>]*href="\/zh"[^>]*title="查看公开官网"|<a[^>]*title="查看公开官网"[^>]*href="\/zh"/,
        );
        assert.ok(
          r.headers.getSetCookie().some((s) => s.startsWith("NEXT_LOCALE=zh")),
        );
        assert.ok(
          r.headers
            .getSetCookie()
            .some((s) => s.startsWith("portal-auth-language=zh")),
        );
      },
    );
    await t.test(
      "public and console 404s are translated, recoverable and noindex; missing jobs keep their own message",
      async () => {
        for (const lang of ["en", "zh"]) {
          const r = await call(`/${lang}/does-not-exist`);
          assert.equal(r.status, 404);
          const html = await r.text();
          assert.ok(
            html.includes(lang === "zh" ? "找不到此页面" : "Page not found"),
          );
          assert.match(
            html,
            /<meta[^>]*name="robots"[^>]*content="[^"]*noindex/,
          );
          assert.ok(html.includes(`href="/${lang}/careers"`));
          const consolePage = await call(`/admin/does-not-exist?lang=${lang}`);
          assert.equal(consolePage.status, 404);
          const adminHtml = await consolePage.text();
          assert.ok(
            adminHtml.includes(
              lang === "zh" ? "返回工作台" : "Back to console",
            ),
          );
          assert.match(
            adminHtml,
            /<meta[^>]*name="robots"[^>]*content="[^"]*noindex/,
          );
          const job = await call(
            `/${lang}/jobs/unknown-vacancy-that-does-not-exist`,
          );
          assert.equal(job.status, 404);
          const jobHtml = await job.text();
          assert.ok(
            jobHtml.includes(
              lang === "zh" ? "该职位已不可用" : "Job No Longer Available",
            ),
          );
          assert.ok(!jobHtml.includes('"@type":"JobPosting"'));
        }
      },
    );
    await t.test(
      "public navigation and in-page anchors work across both languages",
      async () => {
        const pages = new Map();
        const linked = new Set();
        for (const lang of ["en", "zh"])
          for (const path of [
            "",
            "/about",
            "/services",
            "/careers",
            "/contact",
          ]) {
            const url = new URL(`/${lang}${path}`, origin);
            const response = await call(url.pathname);
            assert.equal(response.status, 200, url.pathname);
            const html = await response.text();
            assert.match(
              html,
              new RegExp(`<html[^>]*lang="${lang === "zh" ? "zh-CN" : "en"}"`),
            );
            assert.ok(html.includes('id="main-content"'), url.pathname);
            pages.set(url.pathname + url.search, html);
            for (const match of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
              const target = new URL(match[1].replaceAll("&amp;", "&"), url);
              if (target.origin === origin) linked.add(target.href);
            }
          }
        for (const href of linked) {
          const url = new URL(href),
            key = url.pathname + url.search;
          let html = pages.get(key);
          if (html === undefined) {
            const response = await call(key);
            assert.equal(response.status, 200, key);
            html = await response.text();
            pages.set(key, html);
          }
          if (url.hash)
            assert.ok(
              html.includes(`id="${decodeURIComponent(url.hash.slice(1))}"`),
              `Missing anchor: ${url.pathname}${url.hash}`,
            );
        }
      },
    );
    await t.test(
      "recovery keeps its remembered language when the public locale differs",
      async () => {
        const r = await call("/admin/forgot-password", {
          cookie: "portal-auth-language=zh; NEXT_LOCALE=en",
        });
        assert.equal(r.status, 200);
        const html = await r.text();
        assert.match(html, /<html[^>]*lang="zh-CN"/);
        assert.ok(html.includes("重置密码"));
      },
    );
    await t.test(
      "revoked admission and inactive membership stay on the form instead of bouncing into the console",
      async () => {
        await db.query(
          "DELETE FROM portal_private.staff_session_admissions WHERE subject_id=$1",
          [hr.id],
        );
        await db.query(
          "UPDATE portal.staff_profiles SET active=false WHERE id=$1",
          [reader.id],
        );
        for (const user of [hr, reader]) {
          const r = await call("/admin/login?lang=en", user);
          assert.equal(r.status, 200);
          assert.equal(r.headers.get("location"), null);
          assert.ok(
            (await r.text()).includes("Sign in to your staff workspace."),
          );
        }
      },
    );
    await t.test(
      "rejected logout retains the session; successful logout returns to the translated login form",
      async () => {
        const logout = (requestOrigin) =>
          fetch(origin + "/api/auth/logout", {
            method: "POST",
            headers: {
              Cookie: admin.cookie,
              Origin: requestOrigin,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ lang: "zh" }),
            redirect: "manual",
            signal: AbortSignal.timeout(30000),
          });
        assert.equal((await logout("https://foreign.invalid")).status, 403);
        assert.equal((await call("/admin/login?lang=zh", admin)).status, 307);
        const response = await logout(origin);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
          next: "/admin/login?lang=zh",
        });
        const after = await call("/admin/login?lang=zh", admin);
        assert.equal(after.status, 200);
        assert.equal(after.headers.get("location"), null);
        assert.ok((await after.text()).includes("登录员工工作台。"));
      },
    );
  },
);
