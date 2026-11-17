import test from "node:test";
import assert from "node:assert/strict";
import {
  companyImageSource,
  illustrationObjectKey,
} from "../../../src/lib/content/illustrations.ts";
import { companyIllustrationResponse } from "../../../src/server/content/illustrations.ts";
import { contentTypes } from "../../../src/lib/content/contract.ts";

test("Default section artwork uses six storage routes with EN/ZH descriptions", () => {
  const paths = new Set();
  for (const type of contentTypes) {
    const en = companyImageSource(null, "", type, "en");
    const zh = companyImageSource(null, "", type, "zh");
    assert.match(en.src, /^\/api\/content\/illustrations\/[a-z-]+$/);
    assert.equal(en.src, zh.src);
    assert.ok(en.alt && zh.alt && en.alt !== zh.alt);
    paths.add(en.src);
    assert.equal(
      illustrationObjectKey(en.src.split("/").at(-1)),
      `illustrations/v1/${en.src.split("/").at(-1)}.webp`,
    );
  }
  assert.equal(paths.size, 6);
});

test("Public default artwork cannot expose uploads or arbitrary storage keys", async () => {
  for (const name of [
    "../workspace",
    "images/00000000-0000-4000-8000-000000000000.webp",
    "workspace.webp",
    "toString",
    "__proto__",
    "unknown",
  ]) {
    assert.equal(illustrationObjectKey(name), null);
    await assert.rejects(
      companyIllustrationResponse(name, () => {
        assert.fail("Invalid names must not access storage");
      }),
      { status: 404 },
    );
  }
});

test("Default artwork is served from the private bucket with public image headers", async () => {
  const bytes = new Blob(["synthetic WebP"]);
  const response = await companyIllustrationResponse("workspace", () => ({
    storage: {
      from(bucket) {
        assert.equal(bucket, "company-content");
        return {
          async download(key) {
            assert.equal(key, "illustrations/v1/workspace.webp");
            return { data: bytes, error: null };
          },
        };
      },
    },
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/webp");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.match(response.headers.get("Cache-Control"), /^public,/);
  assert.equal(await response.text(), await bytes.text());
});

test("Missing default artwork reports an unavailable service without provider details", async () => {
  await assert.rejects(
    companyIllustrationResponse("workspace", () => ({
      storage: {
        from: () => ({
          download: async () => ({ data: null, error: { message: "secret" } }),
        }),
      },
    })),
    (error) => error.status === 503 && !error.message.includes("secret"),
  );
});
test("Custom published images take priority and unconfigured item images remain absent", () => {
  const image = {
    id: "custom",
    url: "/api/content/images/custom",
    width: 1200,
    height: 900,
  };
  assert.deepEqual(
    companyImageSource(image, "Approved custom image", "BANNER", "en"),
    { src: image.url, alt: "Approved custom image" },
  );
  assert.equal(companyImageSource(null, ""), null);
});
