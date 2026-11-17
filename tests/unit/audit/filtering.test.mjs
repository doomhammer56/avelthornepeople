import test from "node:test";
import assert from "node:assert/strict";
import { instantFilterHref } from "../../../src/lib/admin/instantFilters.ts";

test("instant audit queries reset pagination and keep supported combined criteria", () => {
  const href = instantFilterHref("/admin/log", [
    ["lang", "zh"],
    ["page", "7"],
    ["pageSize", "20"],
    ["action", "CONTENT_SAVE"],
    ["objectType", "CONTENT"],
    ["actorId", ""],
  ]);
  const url = new URL(href, "https://example.invalid");
  assert.equal(url.pathname, "/admin/log");
  assert.equal(url.searchParams.get("lang"), "zh");
  assert.equal(url.searchParams.get("action"), "CONTENT_SAVE");
  assert.equal(url.searchParams.get("objectType"), "CONTENT");
  assert.equal(url.searchParams.has("page"), false);
  assert.equal(url.searchParams.has("actorId"), false);
});

test("unfinished or invalid audit identifiers cannot trigger a navigation", () => {
  for (const value of [
    "incomplete",
    "00000000-0000-0000-0000",
    "staff@example.invalid",
  ]) {
    assert.equal(instantFilterHref("/admin/log", [["objectId", value]]), null);
  }
  assert.ok(
    instantFilterHref("/admin/log", [
      ["objectId", "00000000-0000-4000-8000-000000000001"],
    ]),
  );
});

test("instant job search preserves multiple statuses and excludes private or unknown fields", () => {
  const href = instantFilterHref("/admin/jobs", [
    ["lang", "en"],
    ["status", "DRAFT"],
    ["status", "PUBLISHED"],
    ["q", " Support "],
    ["page", "3"],
    ["email", "private@example.invalid"],
    ["phone", "+12025550123"],
    ["unexpected", "value"],
  ]);
  const params = new URL(href, "https://example.invalid").searchParams;
  assert.deepEqual(params.getAll("status"), ["DRAFT", "PUBLISHED"]);
  assert.equal(params.get("q"), "Support");
  assert.equal(params.has("page"), false);
  assert.equal(params.has("email"), false);
  assert.equal(params.has("phone"), false);
  assert.equal(params.has("unexpected"), false);
});

test("the actor dropdown maps System to the system filter and still rejects other non-UUID actors", () => {
  const system = new URL(
    instantFilterHref("/admin/log", [["actorId", "system"]]),
    "https://example.invalid",
  );
  assert.equal(system.searchParams.get("actor"), "system");
  assert.equal(system.searchParams.get("actorId"), null);
  assert.equal(instantFilterHref("/admin/log", [["actorId", "someone"]]), null);
  const member = new URL(
    instantFilterHref("/admin/log", [
      ["actorId", "00000000-0000-4000-8000-000000000001"],
    ]),
    "https://example.invalid",
  );
  assert.equal(
    member.searchParams.get("actorId"),
    "00000000-0000-4000-8000-000000000001",
  );
});
