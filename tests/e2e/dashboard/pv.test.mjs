import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import pg from "pg";
import {
  loadAuthTestEnvironment,
  connectAuthTestDatabase,
} from "../../../scripts/auth/test-env.mjs";
loadAuthTestEnvironment();

test(
  "Seeded published job, restricted public API and real PV endpoint round trip",
  { timeout: 120000 },
  async (t) => {
    assert.ok(existsSync(".next/BUILD_ID"), "Build the app first");
    assert.ok(
      process.env.ANALYTICS_DATABASE_URL && process.env.PUBLIC_DATABASE_URL,
      "Run dashboard:setup:local -- --apply --seed first",
    );
    const db = await connectAuthTestDatabase(
      () =>
        new pg.Client({
          connectionString: process.env.DIRECT_URL,
          connectionTimeoutMillis: 15000,
          statement_timeout: 10000,
        }),
    );
    let child;
    t.after(async () => {
      if (child && child.exitCode === null) {
        const stopped = new Promise((resolve) => child.once("exit", resolve));
        child.kill();
        await stopped;
      }
      await db.end();
    });
    const {
      rows: [seed],
    } = await db.query(
      "SELECT id FROM portal.jobs WHERE canonical_slug='dev-pv-test-vacancy' AND published_content->>'developmentFixture'='pv-local-v1'",
    );
    assert.ok(seed, "The explicitly labelled development seed is required");
    const count = async () =>
      Number(
        (
          await db.query(
            "SELECT COALESCE(sum(page_views),0)::text AS n FROM portal.daily_metrics WHERE job_id=$1",
            [seed.id],
          )
        ).rows[0].n,
      );
    const socket = createServer();
    await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
    const port = socket.address().port;
    await new Promise((resolve) => socket.close(resolve));
    const origin = `http://127.0.0.1:${port}`;
    child = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: {
          ...process.env,
          PUBLIC_JOBS_SOURCE: "database",
          PUBLIC_SITE_URL: origin,
          AUTH_APP_ORIGIN: origin,
          AUTH_TRUSTED_IP_HEADER: "",
        },
      },
    );
    child.stdout.on("data", () => {});
    child.stderr.on("data", () => {});
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) break;
      try {
        const response = await fetch(origin + "/api/health", {
          signal: AbortSignal.timeout(1500),
        });
        ready = response.ok;
        await response.body?.cancel();
        if (ready) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.ok(ready, "Built server did not become ready");
    const before = await count();
    const list = await fetch(origin + "/api/jobs");
    assert.equal(list.status, 200);
    const listing = await list.json();
    assert.ok(listing.jobs.some((job) => job.id === seed.id));
    assert.ok(!JSON.stringify(listing).includes("developmentFixture"));
    const detail = await fetch(origin + "/api/jobs/dev-pv-test-vacancy");
    assert.equal(detail.status, 200);
    const { job } = await detail.json();
    assert.equal(job.id, seed.id);
    assert.ok(job.title.en.includes("DEV TEST"));
    assert.equal(job.owner_id, undefined);
    assert.equal(job.salary, undefined);
    for (const locale of ["en", "zh"]) {
      const page = await fetch(`${origin}/${locale}/jobs/dev-pv-test-vacancy`);
      assert.equal(page.status, 200);
      assert.ok((await page.text()).includes(seed.id));
    }
    assert.equal(
      await count(),
      before,
      "SSR/metadata/API reads must not increment views",
    );
    const post = (headers, body) =>
      fetch(origin + "/api/analytics/job-detail-view", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    const event = { jobId: seed.id, locale: "en", source: "linkedin" };
    assert.equal(
      (await post({ origin: "https://attacker.invalid" }, event)).status,
      403,
    );
    assert.equal(await count(), before);
    const accepted = await post({ origin }, event);
    assert.equal(accepted.status, 204);
    assert.match(accepted.headers.get("cache-control"), /no-store/);
    assert.equal(await count(), before + 1);
    const missing = await fetch(origin + "/api/jobs/not-a-published-job");
    assert.equal(missing.status, 404);
    console.log(
      "Verified PV increment on the labelled development fixture; this test view is retained in its analytics.",
    );
  },
);
