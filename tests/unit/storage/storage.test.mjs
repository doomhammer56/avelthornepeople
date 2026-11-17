import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import {
  createCvStorage,
  prepareUpload,
  validateObjectKey,
} from "../../../src/server/adapters/storage/cv-storage.ts";
import { configureCvBuckets } from "../../../src/server/adapters/storage/buckets.ts";
import {
  CvStorageError,
  MAX_CV_BYTES,
  storageConfig,
} from "../../../src/server/adapters/storage/config.ts";
import {
  CvAccessError,
  cvErrorResponse,
  issueCvDownloadUrl,
} from "../../../src/server/storage/cv-url.ts";
import { issueCvUploadIntent } from "../../../src/server/storage/upload-intent.ts";

const result = (data) => ({ data, error: null });
const rejected = (code) => (error) =>
  error instanceof CvStorageError && error.code === code;
const id = randomUUID();
const applicationId = randomUUID();
const cv = {
  id,
  objectKey: `${id}/${randomUUID()}.pdf`,
  contentType: "application/pdf",
  sizeBytes: 100,
  sha256: Buffer.alloc(32),
};

function storageFixture(overrides = {}) {
  const calls = [];
  const files = {
    async info(path) {
      calls.push(["info", path]);
      return result({ size: cv.sizeBytes, contentType: cv.contentType });
    },
    async createSignedUrl(path, ttl, options) {
      calls.push(["sign", path, ttl, options]);
      return result({
        signedUrl: "https://storage.invalid/private?token=SECRET",
      });
    },
    async createSignedUploadUrl(path, options) {
      calls.push(["upload", path, options]);
      const payload = Buffer.from(
        JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 7200 }),
      ).toString("base64url");
      return result({
        token: `header.${payload}.signature`,
        path,
        signedUrl: "https://storage.invalid/upload",
      });
    },
    ...overrides,
  };
  const client = {
    storage: {
      from(bucket) {
        calls.push(["bucket", bucket]);
        return files;
      },
    },
  };
  return { storage: createCvStorage(client), calls };
}

test("configuration requires a server key and secure provider origin", () => {
  assert.equal(
    storageConfig({
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_test",
    }).url,
    "https://test.supabase.co",
  );
  for (const url of [
    "",
    "http://test.supabase.co",
    "https://user:pass@test.supabase.co",
    "https://test.supabase.co/path",
    "https://test.supabase.co?secret=x",
  ]) {
    assert.throws(
      () =>
        storageConfig({
          SUPABASE_URL: url,
          SUPABASE_SECRET_KEY: "sb_secret_test",
        }),
      rejected("CONFIGURATION"),
    );
  }
  for (const key of [
    "",
    "sb_publishable_test",
    "not-a-key",
    `header.${Buffer.from('{"role":"anon"}').toString("base64url")}.signature`,
  ]) {
    assert.throws(
      () =>
        storageConfig({
          SUPABASE_URL: "https://test.supabase.co",
          SUPABASE_SECRET_KEY: key,
        }),
      rejected("CONFIGURATION"),
    );
  }
});

test("upload reservations reject unsupported types, sizes and unsafe keys", () => {
  for (const size of [0, -1, MAX_CV_BYTES + 1, 1.5, NaN])
    assert.throws(
      () => prepareUpload("application/pdf", size),
      rejected("INVALID_FILE"),
    );
  assert.throws(
    () =>
      prepareUpload(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        100,
      ),
    rejected("INVALID_FILE"),
  );
  const intent = prepareUpload("application/msword", MAX_CV_BYTES);
  assert.ok(intent.objectKey.endsWith(".doc"));
  assert.doesNotThrow(() => validateObjectKey(intent.objectKey, intent.id));
  for (const key of [
    "../cv.pdf",
    `${randomUUID()}/${randomUUID()}.pdf`,
    `${intent.id}/candidate@example.com.pdf`,
  ]) {
    assert.throws(
      () => validateObjectKey(key, intent.id),
      rejected("INVALID_FILE"),
    );
  }
});

test("signed uploads disable upsert and keep provider and application expiries distinct", async () => {
  const { storage, calls } = storageFixture();
  const intent = prepareUpload("application/pdf", 100);
  const ticket = await storage.issueUpload(intent);
  assert.ok(
    ticket.providerExpiresAt.getTime() - intent.acceptBefore.getTime() >
      6_000_000,
  );
  assert.deepEqual(calls.find((call) => call[0] === "upload").slice(1), [
    intent.objectKey,
    { upsert: false },
  ]);
  assert.deepEqual(
    calls.find((call) => call[0] === "bucket"),
    ["bucket", "cv-quarantine"],
  );
  await assert.rejects(
    storage.issueUpload({ ...intent, acceptBefore: new Date(0) }),
    rejected("UNAVAILABLE"),
  );
});

test("invalid provider tokens and provider errors are sanitized", async () => {
  for (const response of [
    result({ token: "bad-token" }),
    { data: null, error: { message: "provider secret/token" } },
  ]) {
    const { storage } = storageFixture({
      createSignedUploadUrl: async () => response,
    });
    await assert.rejects(
      storage.issueUpload(prepareUpload("application/pdf", 100)),
      rejected("PROVIDER"),
    );
  }
});

test("download signing verifies metadata, forces DOC attachment and uses a fixed lifetime", async () => {
  const { storage, calls } = storageFixture();
  const signed = await storage.signDownload(cv, "preview");
  assert.equal(signed.disposition, "inline");
  assert.deepEqual(calls.find((call) => call[0] === "sign").slice(2), [60, {}]);
  const mismatched = storageFixture({
    info: async () => result({ size: 999, contentType: "text/html" }),
  });
  await assert.rejects(
    mismatched.storage.signDownload(cv),
    rejected("UNAVAILABLE"),
  );
  assert.equal(
    mismatched.calls.some((call) => call[0] === "sign"),
    false,
  );
  const doc = {
    ...cv,
    objectKey: cv.objectKey.replace(/\.pdf$/, ".doc"),
    contentType: "application/msword",
  };
  const docFixture = storageFixture({
    info: async () => result({ size: 100, contentType: doc.contentType }),
  });
  assert.equal(
    (await docFixture.storage.signDownload(doc, "preview")).disposition,
    "attachment",
  );
  assert.deepEqual(docFixture.calls.find((call) => call[0] === "sign")[3], {
    download: "cv.doc",
  });
});

test("Unscanned PDFs can preview from quarantine while explicit downloads remain attachments", async () => {
  const { storage, calls } = storageFixture();
  const signed = await storage.signDownload(
    { ...cv, scanState: "UNSCANNED" },
    "preview",
  );
  assert.equal(signed.disposition, "inline");
  assert.ok(
    calls.some((call) => call[0] === "bucket" && call[1] === "cv-quarantine"),
  );
  assert.deepEqual(calls.find((call) => call[0] === "sign")[3], {});
  const download = storageFixture();
  assert.equal(
    (
      await download.storage.signDownload(
        { ...cv, scanState: "UNSCANNED" },
        "download",
      )
    ).disposition,
    "attachment",
  );
  assert.deepEqual(download.calls.find((call) => call[0] === "sign")[3], {
    download: "cv.pdf",
  });
});

test("promotion checks the exact scanned bytes and never overwrites a clean object", async () => {
  const bytes = Buffer.from("synthetic scan fixture");
  const digest = createHash("sha256").update(bytes).digest();
  const uploaded = [];
  const { storage } = storageFixture({
    info: async () =>
      result({ size: bytes.length, contentType: "application/pdf" }),
    download: async () => result(new Blob([bytes])),
    upload: async (...args) => {
      uploaded.push(args);
      return result({ path: args[0] });
    },
  });
  await assert.rejects(
    storage.promoteVerified({ ...cv, sizeBytes: bytes.length }),
    rejected("UNAVAILABLE"),
  );
  assert.equal(uploaded.length, 0);
  const promoted = await storage.promoteVerified({
    ...cv,
    sizeBytes: bytes.length,
    sha256: digest,
  });
  assert.equal(promoted.bucket, "cv-clean");
  assert.notEqual(promoted.objectKey, cv.objectKey);
  assert.deepEqual(uploaded[0][2], {
    contentType: "application/pdf",
    cacheControl: "0",
    upsert: false,
  });
});

test("orphan removal cannot delete a key while a provider ticket can still recreate it", async () => {
  const removed = [];
  const { storage } = storageFixture({
    remove: async (keys) => {
      removed.push(keys);
      return result([]);
    },
  });
  for (const expiry of [
    new Date(Date.now() + 7200_000),
    new Date(Date.now() - 60_000),
    new Date(NaN),
  ]) {
    await assert.rejects(
      storage.removeExpiredQuarantine({
        id,
        objectKey: cv.objectKey,
        providerExpiresAt: expiry,
      }),
      rejected("UNAVAILABLE"),
    );
  }
  assert.equal(removed.length, 0);
  await storage.removeExpiredQuarantine({
    id,
    objectKey: cv.objectKey,
    providerExpiresAt: new Date(Date.now() - 600_000),
  });
  assert.deepEqual(removed, [[cv.objectKey]]);
});

test("a failed intake guard cannot reserve or mint an upload capability", async () => {
  let touched = false;
  await assert.rejects(
    issueCvUploadIntent(
      { contentType: "application/pdf", sizeBytes: 100 },
      {
        guard: async () => {
          throw new Error("rate-limited");
        },
        repository: {
          reserve: async () => {
            touched = true;
          },
        },
        storage: {
          issueUpload: async () => {
            touched = true;
          },
        },
      },
    ),
  );
  assert.equal(touched, false);
});

test("upload intent persistence stores only the capability hash and records transport expiry before returning", async () => {
  const stored = [];
  const { storage } = storageFixture();
  const ticket = await issueCvUploadIntent(
    { contentType: "application/pdf", sizeBytes: 100 },
    {
      guard: async () => {},
      storage,
      repository: {
        reserve: async (row) => stored.push(row),
        recordProviderExpiry: async (id, expiry) => stored.push({ id, expiry }),
      },
    },
  );
  assert.equal(
    stored[0].capabilityHash.toString("hex"),
    createHash("sha256").update(ticket.capability).digest("hex"),
  );
  assert.equal("capability" in stored[0], false);
  assert.equal(stored[1].expiry.toISOString(), ticket.providerExpiresAt);
  await assert.rejects(
    issueCvUploadIntent(
      { contentType: "application/pdf", sizeBytes: 100 },
      {
        guard: async () => {},
        storage,
        repository: {
          reserve: async () => {},
          recordProviderExpiry: async () => {
            throw new Error("database unavailable");
          },
        },
      },
    ),
  );
});

function accessFixture({
  subject = id,
  role = "HR",
  row = cv,
  auditError = null,
} = {}) {
  const calls = [];
  return {
    calls,
    dependencies: {
      verifyUser: async () => {
        calls.push("verify");
        return subject;
      },
      repository: {
        withSubject: async (subject, action) => {
          calls.push(["subject", subject]);
          return action({
            role: async () => role,
            findCv: async () => {
              calls.push("lookup");
              return row;
            },
            recordAccess: async () => {
              calls.push("audit");
              if (auditError) throw auditError;
            },
          });
        },
      },
      storage: {
        signDownload: async () => {
          calls.push("sign");
          return { url: "secret-url" };
        },
      },
    },
  };
}

test("signing requires a verified active HR/Admin subject, not client metadata", async () => {
  for (const role of [null, "READ_ONLY", "authenticated", "SUPER_ADMIN"]) {
    const fixture = accessFixture({ role });
    await assert.rejects(
      issueCvDownloadUrl(
        { applicationId, token: "jwt", mode: "download" },
        fixture.dependencies,
      ),
      { status: 403 },
    );
    assert.equal(fixture.calls.includes("sign"), false);
  }
  const invalid = accessFixture({ subject: null });
  await assert.rejects(
    issueCvDownloadUrl(
      { applicationId, token: "jwt", mode: "download" },
      invalid.dependencies,
    ),
    { status: 401 },
  );
  assert.deepEqual(invalid.calls, ["verify"]);
  for (const role of ["HR", "ADMIN"]) {
    const fixture = accessFixture({ role });
    assert.equal(
      (
        await issueCvDownloadUrl(
          { applicationId, token: "jwt", mode: "download" },
          fixture.dependencies,
        )
      ).url,
      "secret-url",
    );
    assert.ok(fixture.calls.indexOf("audit") > fixture.calls.indexOf("sign"));
  }
});

test("missing/revoked CVs and failed authorization rechecks never return a URL", async () => {
  const missing = accessFixture({ row: null });
  await assert.rejects(
    issueCvDownloadUrl(
      { applicationId, token: "jwt", mode: "preview" },
      missing.dependencies,
    ),
    { status: 404 },
  );
  assert.equal(missing.calls.includes("sign"), false);
  const revoked = accessFixture({ auditError: new CvAccessError(403) });
  await assert.rejects(
    issueCvDownloadUrl(
      { applicationId, token: "jwt", mode: "download" },
      revoked.dependencies,
    ),
    { status: 403 },
  );
  assert.equal(revoked.calls.includes("audit"), true);
  const response = cvErrorResponse(new Error("SECRET token and provider key"));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await response.text()).includes("SECRET"), false);
});

test("bucket setup is repeatable and changes only the two fixed CV buckets", async () => {
  const buckets = new Map();
  let mutations = 0;
  const client = {
    storage: {
      getBucket: async (name) =>
        buckets.has(name)
          ? result(buckets.get(name))
          : { data: null, error: { statusCode: "404" } },
      createBucket: async (name, config) => {
        mutations++;
        buckets.set(name, {
          public: config.public,
          file_size_limit: config.fileSizeLimit,
          allowed_mime_types: config.allowedMimeTypes,
        });
        return result({ name });
      },
    },
  };
  assert.ok(
    (await configureCvBuckets(client)).every((bucket) => !bucket.configured),
  );
  assert.equal(mutations, 0);
  assert.ok(
    (await configureCvBuckets(client, true)).every(
      (bucket) => bucket.configured,
    ),
  );
  assert.ok(
    (await configureCvBuckets(client, true)).every((bucket) => !bucket.changed),
  );
  assert.equal(mutations, 2);
  assert.deepEqual([...buckets.keys()], ["cv-quarantine", "cv-clean"]);
});
