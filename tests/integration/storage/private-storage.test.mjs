import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { configureCvBuckets } from "../../../src/server/adapters/storage/buckets.ts";
import {
  storageAdminClient,
  storageConfig,
  MAX_CV_BYTES,
} from "../../../src/server/adapters/storage/config.ts";
import {
  createCvStorage,
  prepareUpload,
} from "../../../src/server/adapters/storage/cv-storage.ts";

test(
  "Supabase private CV Storage HTTP boundary",
  { timeout: 180_000 },
  async (t) => {
    assert.ok(
      process.env.SUPABASE_PUBLISHABLE_KEY,
      "Set the test project's SUPABASE_URL, SUPABASE_SECRET_KEY and SUPABASE_PUBLISHABLE_KEY in .env.",
    );
    assert.ok(
      process.env.DIRECT_URL && process.env.TEST_STAFF_USER_ID,
      "Use the dedicated test database and identity.",
    );
    const config = storageConfig();
    const admin = storageAdminClient();
    const db = new pg.Client({
      connectionString: process.env.DIRECT_URL,
      connectionTimeoutMillis: 15000,
    });
    await db.connect();
    const objects = [];
    let temporaryUser;
    t.after(async () => {
      try {
        // Actual objects are outside database rollback. Remove only exact test keys.
        for (const [bucket, key] of objects) {
          const { error } = await admin.storage.from(bucket).remove([key]);
          assert.equal(
            error,
            null,
            "Test object cleanup failed; remove its test UUID key through Storage API.",
          );
        }
        if (temporaryUser) {
          const { error } = await admin.auth.admin.deleteUser(temporaryUser);
          assert.equal(error, null, "Synthetic Auth identity cleanup failed.");
        }
      } finally {
        await db.end();
      }
    });
    // Ensure HTTP and SQL point at the same known test identity before mutations.
    const identity = await admin.auth.admin.getUserById(
      process.env.TEST_STAFF_USER_ID,
    );
    assert.equal(
      identity.error,
      null,
      "The Storage key and test user must belong to the intended test project.",
    );
    assert.equal(
      (
        await db.query(
          "SELECT EXISTS(SELECT 1 FROM auth.users WHERE id=$1) AS present",
          [identity.data.user.id],
        )
      ).rows[0].present,
      true,
    );
    const guards = await db.query(
      "SELECT tablename,permissive FROM pg_policies WHERE schemaname='storage' AND policyname IN ('cv_private_objects_guard','cv_private_buckets_guard')",
    );
    assert.equal(
      guards.rows.length,
      2,
      "Run npm run storage:policies before hosted storage tests.",
    );
    assert.ok(guards.rows.every((row) => row.permissive === "RESTRICTIVE"));
    const adapter = createCvStorage(admin);
    const bytes = Buffer.from(
      "%PDF-1.4\n% Synthetic Storage-01 transport fixture, not a malware-scan proof.\n%%EOF\n",
    );
    const intent = prepareUpload("application/pdf", bytes.length);
    objects.push(["cv-quarantine", intent.objectKey]);
    const ticket = await adapter.issueUpload(intent);
    const browser = createClient(
      config.url,
      process.env.SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const signedBrowser = createClient(
      config.url,
      process.env.SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    let clean;

    await t.test(
      "bucket configuration is private, constrained and repeatable",
      async () => {
        const first = await configureCvBuckets(admin);
        assert.ok(first.every((bucket) => bucket.configured));
        assert.ok(
          (await configureCvBuckets(admin, true)).every(
            (bucket) => !bucket.changed,
          ),
        );
      },
    );

    await t.test(
      "exact-path signed upload succeeds while direct upload and overwrite fail",
      async () => {
        const direct = await browser.storage
          .from("cv-quarantine")
          .upload(intent.objectKey, bytes, { contentType: "application/pdf" });
        assert.ok(direct.error);
        const uploaded = await browser.storage
          .from("cv-quarantine")
          .uploadToSignedUrl(intent.objectKey, ticket.token, bytes, {
            contentType: "application/pdf",
            cacheControl: "0",
          });
        assert.equal(uploaded.error, null);
        const again = await browser.storage
          .from("cv-quarantine")
          .uploadToSignedUrl(intent.objectKey, ticket.token, bytes, {
            contentType: "application/pdf",
            upsert: true,
          });
        assert.ok(
          again.error,
          "Signed tickets must not permit overwriting an existing object.",
        );
        const wrong = `${intent.id}/${randomUUID()}.pdf`;
        objects.push(["cv-quarantine", wrong]);
        assert.ok(
          (
            await browser.storage
              .from("cv-quarantine")
              .uploadToSignedUrl(wrong, ticket.token, bytes, {
                contentType: "application/pdf",
              })
          ).error,
        );
        objects.push(["cv-clean", intent.objectKey]);
        assert.ok(
          (
            await browser.storage
              .from("cv-clean")
              .uploadToSignedUrl(intent.objectKey, ticket.token, bytes, {
                contentType: "application/pdf",
              })
          ).error,
        );
      },
    );

    await t.test(
      "signed uploads enforce the bucket byte limit and PDF/DOC MIME allowlist",
      async () => {
        const boundary = prepareUpload("application/pdf", MAX_CV_BYTES);
        objects.push(["cv-quarantine", boundary.objectKey]);
        const cap = await adapter.issueUpload(boundary);
        const files = browser.storage.from("cv-quarantine");
        const badMime = await files.uploadToSignedUrl(
          boundary.objectKey,
          cap.token,
          bytes,
          {
            contentType:
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          },
        );
        assert.ok(
          badMime.error,
          "A signed token must not bypass the bucket MIME restriction.",
        );
        const payload = Buffer.alloc(MAX_CV_BYTES + 1, 32);
        payload.set(Buffer.from("%PDF-1.4\n% Synthetic size-limit fixture\n"));
        const tooLarge = await files.uploadToSignedUrl(
          boundary.objectKey,
          cap.token,
          payload,
          { contentType: "application/pdf", cacheControl: "0" },
        );
        assert.ok(
          tooLarge.error,
          "The byte limit must apply to the actual request, including signed uploads.",
        );
        const accepted = await files.uploadToSignedUrl(
          boundary.objectKey,
          cap.token,
          payload.subarray(0, MAX_CV_BYTES),
          { contentType: "application/pdf", cacheControl: "0" },
        );
        assert.equal(
          accepted.error,
          null,
          "The exact documented size boundary must be accepted.",
        );
        const info = await admin.storage
          .from("cv-quarantine")
          .info(boundary.objectKey);
        assert.equal(info.error, null);
        assert.equal(info.data.size, MAX_CV_BYTES);

        // MIME acceptance is a transport check only; the real worker must still
        // parse and scan legacy Word files before any clean promotion.
        const doc = prepareUpload("application/msword", bytes.length);
        objects.push(["cv-quarantine", doc.objectKey]);
        const docTicket = await adapter.issueUpload(doc);
        const acceptedDoc = await files.uploadToSignedUrl(
          doc.objectKey,
          docTicket.token,
          bytes,
          { contentType: "application/msword", cacheControl: "0" },
        );
        assert.equal(acceptedDoc.error, null);
      },
    );

    await t.test(
      "trusted fixture promotion preserves scanned bytes and creates a distinct clean key",
      async () => {
        // Synthetic trusted scan receipt exercises transport only. No production
        // scan endpoint or bypass is installed by this test.
        clean = await adapter.promoteVerified({
          id: intent.id,
          objectKey: intent.objectKey,
          sizeBytes: bytes.length,
          contentType: "application/pdf",
          sha256: createHash("sha256").update(bytes).digest(),
        });
        objects.push([clean.bucket, clean.objectKey]);
        const downloaded = await admin.storage
          .from(clean.bucket)
          .download(clean.objectKey);
        assert.equal(downloaded.error, null);
        assert.deepEqual(
          Buffer.from(await downloaded.data.arrayBuffer()),
          bytes,
        );
      },
    );

    await t.test(
      "ordinary authenticated clients cannot enumerate, read, sign, mutate or delete CVs",
      async () => {
        const password = randomBytes(32).toString("base64url");
        const email = `storage01-${randomUUID()}@example.invalid`;
        const created = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        assert.equal(
          created.error,
          null,
          "A synthetic confirmed user is required; no email is sent.",
        );
        temporaryUser = created.data.user.id;
        const fixtureLink = await admin.auth.admin.generateLink({
          type: "magiclink",
          email,
        });
        assert.equal(fixtureLink.error, null);
        assert.equal(
          (
            await signedBrowser.auth.verifyOtp({
              type: "magiclink",
              token_hash: fixtureLink.data.properties.hashed_token,
            })
          ).error,
          null,
        );
        for (const client of [browser, signedBrowser]) {
          for (const [bucket, key] of [
            ["cv-quarantine", intent.objectKey],
            ["cv-clean", clean.objectKey],
          ]) {
            const files = client.storage.from(bucket);
            const listed = await files.list(intent.id);
            assert.equal((listed.data ?? []).length, 0);
            assert.ok((await files.download(key)).error);
            assert.ok((await files.createSignedUrl(key, 60)).error);
            assert.ok((await files.createSignedUploadUrl(key)).error);
            assert.ok(
              (
                await files.update(key, bytes, {
                  contentType: "application/pdf",
                })
              ).error,
            );
            const copied = `${intent.id}/${randomUUID()}.pdf`;
            objects.push([bucket, copied]);
            assert.ok((await files.copy(key, copied)).error);
            assert.ok((await files.move(key, copied)).error);
            const removed = await files.remove([key]);
            assert.equal((removed.data ?? []).length, 0);
            assert.equal(
              (await admin.storage.from(bucket).info(key)).error,
              null,
              "Denied delete must leave the object intact.",
            );
            const publicUrl = client.storage.from(bucket).getPublicUrl(key)
              .data.publicUrl;
            const response = await fetch(publicUrl, {
              signal: AbortSignal.timeout(15000),
            });
            assert.equal(response.ok, false);
            await response.body?.cancel();
          }
        }
      },
    );

    await t.test(
      "authorized signed downloads work and token tampering fails",
      async () => {
        const signed = await adapter.signDownload({
          id: intent.id,
          objectKey: clean.objectKey,
          contentType: "application/pdf",
          sizeBytes: bytes.length,
          sha256: clean.sha256,
        });
        const response = await fetch(signed.url, {
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        });
        assert.equal(response.ok, true);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
        const altered = new URL(signed.url);
        altered.searchParams.set("token", "invalid");
        const denied = await fetch(altered, {
          signal: AbortSignal.timeout(15000),
        });
        assert.equal(denied.ok, false);
        await denied.body?.cancel();
      },
    );

    await t.test(
      "warm-cache signed URL expiry is measured independently of signature lifetime",
      async () => {
        const signed = await admin.storage
          .from("cv-clean")
          .createSignedUrl(clean.objectKey, 2);
        assert.equal(signed.error, null);
        const warm = await fetch(signed.data.signedUrl, {
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        });
        assert.equal(warm.ok, true);
        await warm.arrayBuffer();
        await new Promise((resolve) => setTimeout(resolve, 3100));
        const expired = await fetch(signed.data.signedUrl, {
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        });
        t.diagnostic(
          `Warm-cache request after token expiry: HTTP ${expired.status}; CDN ${expired.headers.get("cf-cache-status") ?? "unspecified"}.`,
        );
        await expired.body?.cancel();
        assert.equal(
          expired.ok,
          false,
          "Cached CV bytes outlive expiry in this environment; resolve the serving/cache design before production acceptance.",
        );
      },
    );
  },
);
