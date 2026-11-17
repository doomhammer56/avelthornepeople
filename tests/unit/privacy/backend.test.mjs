import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { can } from "../../../src/lib/auth/permissions.ts";
import {
  createDeletionRequest,
  deletionDecision,
  legalHoldCommand,
  privacyPolicyCommand,
  publicDeletionRequest,
} from "../../../src/server/privacy/contract.ts";
import { createPrivacyStorage } from "../../../src/server/privacy/storage.ts";
import { processPrivacyCleanup } from "../../../src/server/privacy/worker.ts";
import { withPrivacyWorker } from "../../../src/server/privacy/database.ts";
import { privacyErrorResponse } from "../../../src/server/privacy/errors.ts";
import { requestCandidateDeletion } from "../../../src/server/privacy/public.ts";
import { StaffAuthError } from "../../../src/server/auth/errors.ts";
import { auditEntry } from "../../../src/server/audit/contract.ts";

test("privacy administration is ADMIN-only; contracts reject arbitrary PII and policy extensions", () => {
  for (const role of ["HR", "READ_ONLY", undefined])
    assert.equal(can(role, "privacy.manage"), false);
  assert.equal(can("ADMIN", "privacy.manage"), true);
  const policy = {
    requestId: randomUUID(),
    expectedVersion: 1,
    retentionMonths: 24,
    evidenceMonths: 24,
    retentionEnabled: false,
  };
  assert.ok(privacyPolicyCommand.safeParse(policy).success);
  for (const value of [0, 25, 2.5, "24", null])
    assert.equal(
      privacyPolicyCommand.safeParse({ ...policy, retentionMonths: value })
        .success,
      false,
    );
  const request = {
    id: randomUUID(),
    candidateId: randomUUID(),
    requesterRef: randomUUID(),
    requestId: randomUUID(),
  };
  assert.ok(createDeletionRequest.safeParse(request).success);
  assert.equal(
    createDeletionRequest.safeParse({
      ...request,
      email: "private@example.invalid",
    }).success,
    false,
  );
  assert.equal(
    deletionDecision.safeParse({
      action: "complete",
      requestId: randomUUID(),
      expectedVersion: 1,
    }).success,
    false,
  );
  assert.equal(
    deletionDecision.safeParse({
      action: "reject",
      requestId: randomUUID(),
      expectedVersion: 1,
      reasonCode: "private reason",
    }).success,
    false,
  );
  assert.equal(
    legalHoldCommand.safeParse({
      action: "hold",
      requestId: randomUUID(),
      expectedVersion: 0,
      caseRef: randomUUID(),
      reasonCode: "LEGAL_CLAIM",
      until: "tomorrow",
    }).success,
    false,
  );
  assert.equal(
    publicDeletionRequest.safeParse({
      candidateId: randomUUID(),
      email: "private@example.invalid",
    }).success,
    false,
  );
});

function storageFixture(entries, options = {}) {
  const removed = [],
    listed = [];
  const client = {
    storage: {
      from: (bucket) => ({
        list: async (prefix, page) => {
          listed.push({ bucket, prefix, ...page });
          if (options.listFailure)
            return { data: null, error: new Error("private provider detail") };
          return {
            data: (entries[bucket] ?? [])
              .slice(page.offset, page.offset + page.limit)
              .map((name) => ({ name })),
            error: null,
          };
        },
        remove: async (keys) => {
          removed.push({ bucket, keys });
          if (options.removeFailure)
            return { data: null, error: new Error("private provider detail") };
          if (!options.partial)
            entries[bucket] = (entries[bucket] ?? []).filter(
              (name) => !keys.some((key) => key.endsWith(`/${name}`)),
            );
          return { data: [], error: null };
        },
      }),
    },
  };
  return { client, removed, listed };
}
const descriptor = (id) => ({
  bucket: "cv-clean",
  objectKey: `${id}/${randomUUID()}.pdf`,
});
test("erasure removes clean and quarantine variants under the exact upload UUID and is idempotent", async () => {
  const id = randomUUID(),
    fileA = `${randomUUID()}.pdf`,
    fileB = `${randomUUID()}.pdf`;
  const f = storageFixture({ "cv-quarantine": [fileA], "cv-clean": [fileB] });
  await createPrivacyStorage(f.client).purgeUpload(
    id,
    "SUPABASE",
    descriptor(id),
  );
  assert.deepEqual(
    f.removed.map((entry) => entry.keys),
    [[`${id}/${fileA}`], [`${id}/${fileB}`]],
  );
  assert.ok(f.listed.every((entry) => entry.prefix === id));
  await createPrivacyStorage(f.client).purgeUpload(
    id,
    "SUPABASE",
    descriptor(id),
  );
  assert.equal(f.removed.length, 2);
});
test("storage verifies removal, rejects arbitrary paths, and never truncates a full listing", async () => {
  const id = randomUUID();
  for (const options of [
    { listFailure: true },
    { removeFailure: true },
    { partial: true },
  ]) {
    const f = storageFixture({ "cv-clean": [`${randomUUID()}.pdf`] }, options);
    await assert.rejects(
      createPrivacyStorage(f.client).purgeUpload(
        id,
        "SUPABASE",
        descriptor(id),
      ),
    );
  }
  const unsafe = storageFixture({ "cv-quarantine": ["../another-object.pdf"] });
  await assert.rejects(
    createPrivacyStorage(unsafe.client).purgeUpload(
      id,
      "SUPABASE",
      descriptor(id),
    ),
  );
  assert.equal(unsafe.removed.length, 0);
  const full = storageFixture({
    "cv-quarantine": Array.from({ length: 1001 }, () => `${randomUUID()}.pdf`),
  });
  await assert.rejects(
    createPrivacyStorage(full.client).purgeUpload(
      id,
      "SUPABASE",
      descriptor(id),
    ),
  );
  assert.equal(full.removed.length, 0);
  await assert.rejects(
    createPrivacyStorage(full.client).purgeUpload(id, "S3", descriptor(id)),
  );
  const wrongKey = storageFixture({});
  await assert.rejects(
    createPrivacyStorage(wrongKey.client).purgeUpload(
      id,
      "SUPABASE",
      descriptor(randomUUID()),
    ),
  );
  await assert.rejects(
    createPrivacyStorage(wrongKey.client).purgeUpload(id, "SUPABASE", {
      ...descriptor(id),
      bucket: "company-content",
    }),
  );
  assert.equal(wrongKey.listed.length, 0);
});
test("large valid UUID-prefix listings are fully paged and removed in bounded chunks", async () => {
  const f = storageFixture({
    "cv-clean": Array.from({ length: 203 }, () => `${randomUUID()}.pdf`),
  });
  const id = randomUUID();
  await createPrivacyStorage(f.client).purgeUpload(
    id,
    "SUPABASE",
    descriptor(id),
  );
  assert.deepEqual(
    f.removed.map((entry) => entry.keys.length),
    [100, 100, 3],
  );
});

test("worker performs storage outside transactions, preserves provider failures, and reports stale leases", async () => {
  const claims = Array.from({ length: 3 }, () => ({
    applicationId: randomUUID(),
    uploadId: randomUUID(),
    provider: "SUPABASE",
    leaseToken: randomUUID(),
  }));
  const results = [];
  let transactions = 0;
  const result = await processPrivacyCleanup({
    runTransaction: async (action) => {
      transactions++;
      try {
        return await action({
          query: async (sql, args) => {
            if (sql.includes("prepare_privacy_cleanup"))
              return { rows: [{ result: { queued: 3, completed: 0 } }] };
            if (sql.includes("claim_privacy_cleanup"))
              return { rows: [{ result: claims }] };
            if (sql.includes("finish_privacy_cleanup")) {
              results.push(args);
              return {
                rows: [
                  { removed: args[2] && args[0] !== claims[2].applicationId },
                ],
              };
            }
            return {
              rows: [{ result: { completed: 1, pending: 2, overdue: 1 } }],
            };
          },
        });
      } finally {
        transactions--;
      }
    },
    storage: () => ({
      purgeUpload: async (id) => {
        assert.equal(transactions, 0);
        if (id === claims[1].uploadId) throw new Error("provider failure");
      },
    }),
  });
  assert.deepEqual(result, {
    queued: 3,
    removed: 1,
    failed: 1,
    skipped: 1,
    completed: 1,
    pending: 2,
    overdue: 1,
  });
  assert.equal(
    results.find((args) => args[0] === claims[1].applicationId)[2],
    false,
  );
});
test("worker credentials cannot fall back to an owner or a mixed runtime login", async () => {
  for (const role of [
    { restricted: false, memberships: ["portal_privacy_worker"] },
    {
      restricted: true,
      memberships: ["portal_privacy_worker", "portal_runtime"],
    },
    { restricted: true, memberships: null },
  ]) {
    const calls = [];
    const connection = {
      query: async (sql) => {
        calls.push(sql);
        return { rows: [role] };
      },
      release: () => {},
    };
    await assert.rejects(
      withPrivacyWorker(async () => assert.fail("must not execute"), {
        connect: async () => connection,
      }),
      { status: 503 },
    );
    assert.ok(!calls.some((sql) => sql.startsWith("BEGIN")));
  }
});

test("public receipt intake uses bounded same-origin rate-limited requests and hashes the capability", async (t) => {
  const previous = {
    PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL,
    AUTH_TRUSTED_IP_HEADER: process.env.AUTH_TRUSTED_IP_HEADER,
    AUTH_LIMITER_SECRET: process.env.AUTH_LIMITER_SECRET,
  };
  Object.assign(process.env, {
    PUBLIC_SITE_URL: "http://localhost:3000",
    AUTH_LIMITER_SECRET: "x".repeat(32),
  });
  delete process.env.AUTH_TRUSTED_IP_HEADER;
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const upload = randomUUID(),
    token = randomBytes(32).toString("base64url"),
    calls = [];
  const make = (origin = "http://localhost:3000") =>
    new Request("http://localhost:3000/api/privacy/deletion-requests", {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: JSON.stringify({ resumeToken: `${upload}.${token}` }),
    });
  const transact = async (_subject, action) =>
    action({
      query: async (sql, args) => {
        calls.push({ sql, args });
        return { rows: [{ retry: 0 }] };
      },
    });
  assert.deepEqual(await requestCandidateDeletion(make(), transact), {
    status: "received",
  });
  assert.ok(calls[0].sql.includes("consume_intake_traffic"));
  assert.equal(calls[1].args[0], upload);
  assert.deepEqual(
    calls[1].args[1],
    createHash("sha256").update(token).digest(),
  );
  const count = calls.length;
  await assert.rejects(
    requestCandidateDeletion(make("https://other.invalid"), transact),
    { status: 403 },
  );
  assert.equal(calls.length, count);
});
test("privacy errors preserve safe retry headers and never disclose SQL or provider details", async () => {
  const response = privacyErrorResponse({
    code: "23505",
    detail: "private@example.invalid",
    message: "candidate id",
  });
  assert.equal(response.status, 409);
  assert.match(response.headers.get("cache-control"), /private.*no-store/);
  assert.equal(
    await response.text(),
    '{"error":"Privacy request could not be processed"}',
  );
  const limited = privacyErrorResponse(
    new StaffAuthError(429, "traffic_limited", 60),
  );
  assert.equal(limited.headers.get("retry-after"), "60");
});
test("privacy completion events expose only approved opaque evidence", () => {
  const entry = auditEntry({
    id: randomUUID(),
    created_at: new Date(),
    actor_id: null,
    object_id: randomUUID(),
    object_type: "PRIVACY_REQUEST",
    action: "DELETION_COMPLETED",
    safe_changes: { id: randomUUID(), version: 3 },
    request_id: randomUUID(),
  });
  assert.equal(entry.action, "DELETION_COMPLETED");
  assert.equal(entry.detailsAvailable, true);
});
