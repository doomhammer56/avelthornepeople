import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import {
  normalizeEmail,
  normalizePhone,
} from "../../../src/server/candidates/contacts.ts";
import {
  encryptProfileValue,
  decryptProfileValue,
  encryptedCandidate,
  candidateProfile,
  contactKeys,
  ProfileUnavailable,
} from "../../../src/server/candidates/crypto.ts";
import {
  parseQuery,
  stageCommand,
  mergeCommand,
  applicationSearch,
} from "../../../src/server/applications/contract.ts";
import { recruitmentRequest } from "../../../src/lib/admin/recruitmentClient.ts";
import { applicationListHref } from "../../../src/lib/admin/recruitmentClient.ts";
import { toCsv } from "../../../src/lib/admin/csv.ts";
process.env.CANDIDATE_ENCRYPTION_KEYS = JSON.stringify({
  1: randomBytes(32).toString("base64"),
  2: randomBytes(32).toString("base64"),
});
process.env.CANDIDATE_MATCH_KEYS = JSON.stringify({
  1: randomBytes(32).toString("base64"),
  2: randomBytes(32).toString("base64"),
});
process.env.CANDIDATE_ACTIVE_KEY_VERSION = "2";
test("Email normalization preserves meaningful aliases and rejects invalid input", () => {
  assert.equal(
    normalizeEmail(" First.Last+Jobs@Example.COM "),
    "first.last+jobs@example.com",
  );
  assert.notEqual(
    normalizeEmail("first.last@example.com"),
    normalizeEmail("firstlast@example.com"),
  );
  assert.throws(() => normalizeEmail("bad"));
});
test("Phone matching uses explicit country context and full valid E.164 numbers", () => {
  assert.equal(normalizePhone("0788 123 456", "RW"), "+250788123456");
  assert.equal(normalizePhone("+250 788 123 456"), "+250788123456");
  for (const [phone, region] of [
    ["0788123456", undefined],
    ["123", "RW"],
    ["Call +250788123456", "RW"],
    ["+12133734253 ext 7", "US"],
    ["0788123456", "ZZ"],
  ])
    assert.throws(() => normalizePhone(phone, region));
});
test("Authenticated encryption binds field and record, uses random nonces and rejects tampering", () => {
  const value = {
    name: "Synthetic candidate",
    email: "test@example.invalid",
    phone: "+250788123456",
  };
  const context = `application:${randomUUID()}:profile`;
  const a = encryptProfileValue(value, context),
    b = encryptProfileValue(value, context);
  assert.notDeepEqual(a, b);
  assert.deepEqual(decryptProfileValue(a, context), value);
  assert.throws(
    () => decryptProfileValue(a, context + ":other"),
    ProfileUnavailable,
  );
  const e = JSON.parse(a);
  e.data = Buffer.from("tampered").toString("base64");
  assert.throws(
    () => decryptProfileValue(Buffer.from(JSON.stringify(e)), context),
    ProfileUnavailable,
  );
  assert.throws(
    () => decryptProfileValue(randomBytes(48), context),
    ProfileUnavailable,
  );
});
test("Candidate envelopes round-trip normalized profiles and fail closed with wrong keys", () => {
  const id = randomUUID(),
    input = encryptedCandidate(id, {
      name: "Synthetic",
      email: "Case+Jobs@Example.invalid",
      phone: "0788123456",
      phoneRegion: "RW",
    });
  const row = {
    id,
    name_encrypted: input.nameEncrypted,
    email_encrypted: input.emailEncrypted,
    phone_encrypted: input.phoneEncrypted,
  };
  assert.deepEqual(candidateProfile(row), {
    name: "Synthetic",
    email: "case+jobs@example.invalid",
    phone: "+250788123456",
  });
  assert.equal(candidateProfile({ ...row, id: randomUUID() }), null);
  const keys = process.env.CANDIDATE_ENCRYPTION_KEYS;
  process.env.CANDIDATE_ENCRYPTION_KEYS = JSON.stringify({
    2: randomBytes(32).toString("base64"),
  });
  try {
    assert.equal(candidateProfile(row), null);
  } finally {
    process.env.CANDIDATE_ENCRYPTION_KEYS = keys;
  }
});
test("Matching keys are domain-separated, normalized and generated for supported versions", () => {
  const a = contactKeys("Case@Example.invalid", "0788123456", "RW"),
    b = contactKeys("case@example.invalid", "+250788123456");
  assert.deepEqual(a, b);
  assert.equal(a.length, 4);
  assert.notEqual(a[0].hash, a[1].hash);
  assert.notEqual(a[0].hash, a[2].hash);
});
test("Missing/malformed server keys never fall back to Auth or plaintext values", () => {
  const original = process.env.CANDIDATE_MATCH_KEYS;
  try {
    for (const value of [
      "{}",
      "invalid",
      JSON.stringify({ 1: "short" }),
      JSON.stringify([]),
    ]) {
      process.env.CANDIDATE_MATCH_KEYS = value;
      assert.throws(() => contactKeys("x@example.invalid"), ProfileUnavailable);
    }
  } finally {
    process.env.CANDIDATE_MATCH_KEYS = original;
  }
});
test("Pagination and multi-stage filters are bounded and strict; contact values cannot enter GET queries", () => {
  const query = parseQuery(
    new URLSearchParams("status=NEW&status=OFFER&pageSize=2&jobId=&source="),
  );
  assert.deepEqual(query.status, ["NEW", "OFFER"]);
  assert.equal(query.page, 1);
  assert.equal(query.pageSize, 2);
  for (const raw of [
    "page=0",
    "pageSize=101",
    "status=HACK",
    "page=1&page=2",
    "email=secret@example.invalid",
    "from=2026-10-25",
    "from=2026-10-26T00:00:00Z&to=2026-10-25T00:00:00Z",
  ])
    assert.throws(() => parseQuery(new URLSearchParams(raw)));
  assert.ok(
    applicationSearch.safeParse({ email: "test@example.invalid", region: "RW" })
      .success,
  );
});
test("Stage/merge commands reject mass assignment and require versions and request IDs", () => {
  assert.ok(
    stageCommand.safeParse({
      status: "INTERVIEW",
      expectedVersion: 1,
      requestId: randomUUID(),
    }).success,
  );
  assert.ok(
    !stageCommand.safeParse({
      status: "INTERVIEW",
      expectedVersion: 1,
      requestId: randomUUID(),
      candidateId: randomUUID(),
    }).success,
  );
  assert.ok(
    !mergeCommand.safeParse({
      sourceId: randomUUID(),
      sourceVersion: 0,
      expectedVersion: 1,
      requestId: randomUUID(),
    }).success,
  );
});
test("Client reports failed writes and keeps contact search out of the URL", async () => {
  const input = { email: "private@example.invalid" };
  await assert.rejects(
    recruitmentRequest(
      "/api/admin/applications/search",
      "POST",
      input,
      async (path, options) => {
        assert.equal(path, "/api/admin/applications/search");
        assert.deepEqual(JSON.parse(options.body), input);
        return Response.json({ error: "failed" }, { status: 409 });
      },
    ),
    (error) => error.status === 409,
  );
});
test("List navigation retains public filters without including private search contacts", () => {
  const query = applicationSearch.parse({
    candidateId: randomUUID(),
    status: ["NEW", "NEW", "OFFER"],
    email: "private@example.invalid",
    page: 2,
  });
  assert.deepEqual(query.status, ["NEW", "OFFER"]);
  const href = applicationListHref(query, "en");
  assert.ok(href.includes("candidateId="));
  assert.ok(href.includes("page=2"));
  assert.ok(!href.includes("private"));
  assert.ok(!href.includes("email"));
});
test("Exported candidate contacts and names cannot become spreadsheet formulas", () => {
  for (const value of [
    "=1+1",
    "+250788123456",
    "-1+1",
    "@SUM(1)",
    "  =1+1",
    "\t=1+1",
  ]) {
    const csv = toCsv([[value]]);
    assert.ok(csv.startsWith("'") || csv.startsWith("\"'"));
  }
  assert.equal(
    toCsv([["Candidate, name", "line\rbreak", 'a"b']]),
    '"Candidate, name","line\rbreak","a""b"',
  );
  assert.equal(
    toCsv([["普通文字", "name@example.invalid"]]),
    "普通文字,name@example.invalid",
  );
});
