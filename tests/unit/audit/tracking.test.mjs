import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  safeAuditChanges,
  auditEntry,
  auditFilters,
  auditCode,
  knownActions,
  knownTypes,
} from "../../../src/server/audit/contract.ts";
import { auditPresentation } from "../../../src/server/audit/presentation.ts";
import {
  auditActionLabels,
  auditObjectLabels,
  auditActionLabel,
  auditDetailLines,
} from "../../../src/lib/admin/auditLogLabels.ts";
import {
  safePayloads,
  unsafePayloads,
} from "../../fixtures/audit-payloads.mjs";

test("Audit payloads allow only opaque references, typed enums and safe field names", () => {
  for (const value of safePayloads)
    assert.ok(safeAuditChanges.safeParse(value).success);
  for (const value of unsafePayloads)
    assert.ok(!safeAuditChanges.safeParse(value).success);
});
test("Stored-record projection withholds unsafe legacy details and ignores display metadata", () => {
  const row = {
    id: randomUUID(),
    created_at: new Date("2026-10-26T12:34:56.789Z"),
    actor_id: randomUUID(),
    object_id: randomUUID(),
    request_id: randomUUID(),
    action: "JOB_SAVE",
    object_type: "JOB",
    safe_changes: { version: 2 },
    display_name: "Private Actor Canary",
  };
  assert.equal(auditEntry(row).at, "2026-10-26T12:34:56.789Z");
  assert.ok(!JSON.stringify(auditEntry(row)).includes("Private Actor Canary"));
  const hidden = auditEntry({
    ...row,
    action: "Private Actor Canary",
    safe_changes: { version: 2, email: "audit-canary@example.invalid" },
  });
  assert.equal(hidden.detailsAvailable, false);
  assert.deepEqual(hidden.changes, {});
  assert.equal(hidden.action, "LEGACY_EVENT");
  assert.ok(!JSON.stringify(hidden).includes("audit-canary"));
  const uppercase = auditEntry({
    ...row,
    action: "PRIVATE_CANDIDATE_CANARY",
    object_type: "PRIVATE_PERSON_CANARY",
  });
  assert.equal(uppercase.action, "LEGACY_EVENT");
  assert.equal(uppercase.objectType, "LEGACY_OBJECT");
  assert.ok(!JSON.stringify(uppercase).includes("PRIVATE_"));
});

test("Authorized display labels resolve names/sections without modifying stored changes or reading candidate PII", () => {
  const base = auditEntry({
    id: randomUUID(),
    created_at: new Date(),
    actor_id: randomUUID(),
    object_type: "CONTENT",
    object_id: randomUUID(),
    request_id: randomUUID(),
    action: "CONTENT_SEEDED",
    safe_changes: { version: 2 },
  });
  const display = auditPresentation(base, {
    actor_name: "  Alice   Admin ",
    content_type: "BANNER",
    candidate_name: "Private Candidate Canary",
    email: "private@example.invalid",
  });
  assert.equal(display.actorName, "Alice Admin");
  assert.equal(display.objectLabel.en, "Home banner");
  assert.deepEqual(display.changes, { version: 2 });
  assert.equal(base.actorName, undefined);
  assert.ok(!JSON.stringify(display).includes("Private Candidate Canary"));
  const missing = auditPresentation({ ...base, objectType: "JOB" }, {});
  assert.equal(missing.actorName, null);
  assert.equal(missing.objectLabel, null);
  const candidate = auditPresentation(
    { ...base, objectType: "CANDIDATE" },
    { candidate_name: "Private Candidate Canary" },
  );
  assert.equal(candidate.objectLabel, null);
});
test("Every supported action/object has EN/ZH labels and readable details keep IDs in technical references", () => {
  for (const action of knownActions.options)
    assert.ok(auditActionLabels[action].en && auditActionLabels[action].zh);
  for (const type of knownTypes.options)
    assert.ok(auditObjectLabels[type].en && auditObjectLabels[type].zh);
  assert.equal(
    auditActionLabel("CONTENT_SEEDED", "en"),
    "Initial company content published",
  );
  assert.equal(
    auditActionLabel("UNTRUSTED_LEGACY_CODE", "en"),
    "Historical action",
  );
  const id = randomUUID();
  assert.deepEqual(
    auditDetailLines({ id, version: 2, fields: ["name_en"] }, "en"),
    ["Revision: 2", "Changed fields: English name"],
  );
  assert.ok(
    !auditDetailLines({ sourceId: id, version: 2 }, "en").join().includes(id),
  );
});
test("Exact audit filters have bounded pages and offset-aware ordered date ranges", () => {
  assert.equal(auditFilters.parse({}).pageSize, 20);
  assert.ok(
    auditFilters.safeParse({
      actor: "system",
      from: "2026-10-25T00:00:00+02:00",
      to: "2026-10-26T00:00:00Z",
    }).success,
  );
  for (const value of [
    { page: 0 },
    { page: 10001 },
    { pageSize: 101 },
    { actorId: "private@example.invalid" },
    { actor: "system", actorId: randomUUID() },
    { from: "2026-10-26T00:00:00" },
    { from: "2026-10-26T00:00:00Z", to: "2026-10-25T00:00:00Z" },
    { search: "private@example.invalid" },
    { action: "JOB_SAVE' OR true--" },
  ])
    assert.ok(!auditFilters.safeParse(value).success);
  assert.ok(!auditCode.safeParse("private@example.invalid").success);
});
