import test from "node:test";
import assert from "node:assert/strict";
import { configureContentBucket } from "../../../src/server/content/bucket.ts";
import {
  CONTENT_BUCKET,
  MAX_IMAGE_BYTES,
} from "../../../src/server/content/images.ts";

function fixture(initial = null) {
  let bucket = initial;
  const writes = [];
  const save = async (name, options) => {
    assert.equal(name, CONTENT_BUCKET);
    writes.push(options);
    bucket = {
      public: options.public,
      file_size_limit: options.fileSizeLimit,
      allowed_mime_types: options.allowedMimeTypes,
    };
    return { data: { name }, error: null };
  };
  const client = {
    storage: {
      getBucket: async (name) => {
        assert.equal(name, CONTENT_BUCKET);
        return bucket
          ? { data: bucket, error: null }
          : { data: null, error: { statusCode: "404" } };
      },
      createBucket: save,
      updateBucket: save,
    },
  };
  return { client, writes };
}

test("Image bucket verification is read-only and setup is repeatable", async () => {
  const { client, writes } = fixture();
  assert.deepEqual(await configureContentBucket(client), {
    bucket: "company-content",
    configured: false,
  });
  assert.equal(writes.length, 0);
  assert.equal((await configureContentBucket(client, true)).configured, true);
  assert.deepEqual(writes, [
    {
      public: false,
      fileSizeLimit: MAX_IMAGE_BYTES,
      allowedMimeTypes: ["image/webp"],
    },
  ]);
  assert.equal((await configureContentBucket(client, true)).configured, true);
  assert.equal(writes.length, 1);
});

test("Image bucket setup repairs public access and upload restrictions", async () => {
  const { client, writes } = fixture({
    public: true,
    file_size_limit: null,
    allowed_mime_types: null,
  });
  assert.equal((await configureContentBucket(client)).configured, false);
  assert.equal(writes.length, 0);
  assert.equal((await configureContentBucket(client, true)).configured, true);
  assert.equal(writes.length, 1);
});

test("Provider failures never create a bucket after a failed lookup", async () => {
  const { client, writes } = fixture();
  client.storage.getBucket = async () => ({
    data: null,
    error: { statusCode: "403", message: "private provider details" },
  });
  await assert.rejects(
    configureContentBucket(client, true),
    (error) =>
      error.status === 503 &&
      !error.message.includes("private provider details"),
  );
  assert.equal(writes.length, 0);
});

test("Failed creation or unconfirmed bucket settings do not report success", async () => {
  const { client } = fixture();
  client.storage.createBucket = async () => ({
    data: null,
    error: { statusCode: "500" },
  });
  await assert.rejects(configureContentBucket(client, true), { status: 503 });
  client.storage.createBucket = async () => ({ data: {}, error: null });
  assert.equal((await configureContentBucket(client, true)).configured, false);
});
