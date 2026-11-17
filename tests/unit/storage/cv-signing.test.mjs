import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import {
  issueCvDownloadUrl,
  CvAccessError,
} from "../../../src/server/storage/cv-url.ts";

function fixture({
  roleChanged = false,
  auditFails = false,
  commitFails = false,
  providerFails = false,
} = {}) {
  const subject = randomUUID(),
    applicationId = randomUUID();
  const cv = {
    id: randomUUID(),
    objectKey: "bound-object",
    contentType: "application/pdf",
    sizeBytes: 100,
    sha256: randomBytes(32),
  };
  const events = [];
  let active = false,
    phase = 0;
  const dependencies = {
    verifyUser: async () => subject,
    repository: {
      withSubject: async (actual, action) => {
        assert.equal(actual, subject);
        assert.equal(active, false);
        active = true;
        phase++;
        events.push(`begin:${phase}`);
        try {
          const result = await action({
            role: async () => (roleChanged && phase === 2 ? "READ_ONLY" : "HR"),
            findCv: async () => cv,
            recordAccess: async (id, requestId, expected) => {
              assert.equal(id, applicationId);
              assert.match(requestId, /^[0-9a-f-]{36}$/);
              assert.deepEqual(expected, cv);
              events.push("audit");
              if (auditFails) throw new CvAccessError(403);
            },
          });
          if (commitFails && phase === 2) throw new Error("Commit failed");
          events.push(`commit:${phase}`);
          return result;
        } finally {
          active = false;
        }
      },
    },
    storage: {
      signDownload: async (actual) => {
        assert.equal(
          active,
          false,
          "No database transaction may remain open while Storage is called",
        );
        assert.equal(actual, cv);
        events.push("sign");
        if (providerFails) throw new Error("Storage unavailable");
        return { url: "signed-private-url" };
      },
    },
  };
  return {
    dependencies,
    events,
    input: { applicationId, token: "jwt", mode: "download" },
  };
}

test("CV signing releases its read connection and commits a descriptor-bound audit before returning", async () => {
  const f = fixture();
  assert.equal(
    (await issueCvDownloadUrl(f.input, f.dependencies)).url,
    "signed-private-url",
  );
  assert.deepEqual(f.events, [
    "begin:1",
    "commit:1",
    "sign",
    "begin:2",
    "audit",
    "commit:2",
  ]);
});

test("role revocation, changed/revoked file or failed commit prevent URL disclosure", async () => {
  for (const options of [
    { roleChanged: true },
    { auditFails: true },
    { commitFails: true },
  ]) {
    const f = fixture(options);
    await assert.rejects(issueCvDownloadUrl(f.input, f.dependencies));
    assert.ok(f.events.includes("sign"));
    assert.equal(f.events.includes("commit:2"), false);
  }
});

test("a failed provider request never opens the final audit transaction", async () => {
  const f = fixture({ providerFails: true });
  await assert.rejects(
    issueCvDownloadUrl(f.input, f.dependencies),
    /Storage unavailable/,
  );
  assert.deepEqual(f.events, ["begin:1", "commit:1", "sign"]);
});
