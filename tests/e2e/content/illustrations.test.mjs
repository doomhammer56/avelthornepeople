import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import sharp from "sharp";
import { loadAuthTestEnvironment } from "../../../scripts/auth/test-env.mjs";
import { companyIllustrations } from "../../../src/lib/content/illustrations.ts";

loadAuthTestEnvironment();

test(
  "Built image routes serve migrated artwork without repository files or draft access",
  {
    timeout: 90000,
  },
  async (t) => {
    const probe = createServer();
    await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    const origin = `http://127.0.0.1:${port}`;
    const child = spawn(
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
    t.after(async () => {
      if (child.exitCode === null) {
        const stopped = new Promise((resolve) => child.once("exit", resolve));
        child.kill();
        await stopped;
      }
    });
    let ready = false;
    for (let attempt = 0; attempt < 100 && child.exitCode === null; attempt++) {
      try {
        const response = await fetch(
          `${origin}/api/content/illustrations/unknown`,
          {
            signal: AbortSignal.timeout(1000),
          },
        );
        await response.body?.cancel();
        if (response.status === 404) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.ok(
      ready,
      "Build the application and provision the test artwork first",
    );
    for (const { file } of Object.values(companyIllustrations)) {
      const response = await fetch(
        `${origin}/api/content/illustrations/${file}`,
        {
          signal: AbortSignal.timeout(15000),
        },
      );
      assert.equal(response.status, 200, file);
      assert.equal(response.headers.get("content-type"), "image/webp");
      assert.match(response.headers.get("cache-control"), /^public,/);
      const metadata = await sharp(
        Buffer.from(await response.arrayBuffer()),
      ).metadata();
      assert.equal(metadata.format, "webp");
      assert.equal(metadata.width, 2400);
      assert.equal(metadata.height, 1800);
    }
    for (const path of [
      "/api/content/illustrations/workspace.webp",
      "/api/content/illustrations/00000000-0000-4000-8000-000000000000",
      "/images/company/workspace.svg",
    ]) {
      const response = await fetch(origin + path, {
        signal: AbortSignal.timeout(10000),
      });
      assert.equal(response.status, 404, path);
      await response.body?.cancel();
    }
  },
);
