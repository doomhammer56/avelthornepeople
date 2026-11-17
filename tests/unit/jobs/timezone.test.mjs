import test from "node:test";
import assert from "node:assert/strict";
import {
  validTimeZone,
  availableTimeZones,
  zonedDateTime,
  scheduleInstant,
  ScheduleTimeError,
} from "../../../src/lib/admin/timeZone.ts";
import {
  jobEditorInput,
  rezoneSchedule,
} from "../../../src/lib/admin/jobEditorInput.ts";

test("Scheduling converts the selected timezone without relying on the server timezone", () => {
  for (const [zone, local, instant] of [
    ["Africa/Kigali", "2026-10-25T14:05:28.093", "2026-10-25T12:05:28.093Z"],
    ["Asia/Shanghai", "2026-10-26T00:30", "2026-10-25T16:30:00.000Z"],
    ["Asia/Kathmandu", "2026-10-25T14:00", "2026-10-25T08:15:00.000Z"],
    ["America/New_York", "2026-01-10T14:00", "2026-01-10T19:00:00.000Z"],
    ["America/New_York", "2026-07-10T14:00", "2026-07-10T18:00:00.000Z"],
    ["UTC", "2026-10-25T00:00", "2026-10-25T00:00:00.000Z"],
  ]) {
    assert.equal(scheduleInstant(local, zone), instant);
    assert.equal(scheduleInstant(zonedDateTime(instant, zone), zone), instant);
  }
  assert.equal(scheduleInstant("", "Africa/Kigali"), null);
  assert.equal(zonedDateTime(null, "Africa/Kigali"), "");
});

test("Scheduling rejects invalid calendar values and unsupported zones", () => {
  for (const raw of [
    "2026-02-30T10:00",
    "2026-10-25T24:00",
    "2026-10-25",
    "bad",
    "2026-10-25T12:00Z",
  ]) {
    assert.throws(
      () => scheduleInstant(raw, "Africa/Kigali"),
      (error) => error instanceof ScheduleTimeError && error.code === "invalid",
    );
  }
  for (const zone of [
    undefined,
    "",
    "bad/zone",
    "UTC|secret",
    "<script>",
    "a".repeat(101),
  ])
    assert.equal(validTimeZone(zone), false);
  assert.equal(validTimeZone("Africa/Kigali"), true);
  assert.equal(validTimeZone("UTC"), true);
  assert.ok(availableTimeZones("Africa/Kigali").includes("Africa/Kigali"));
  assert.ok(availableTimeZones("Africa/Kigali").includes("UTC"));
});

test("Scheduling rejects daylight-saving gaps and folds instead of guessing an instant", () => {
  for (const [zone, raw, code] of [
    ["America/New_York", "2026-03-08T02:30", "nonexistent_time"],
    ["America/New_York", "2026-11-01T01:30", "ambiguous_time"],
    ["Australia/Lord_Howe", "2026-10-04T02:15", "nonexistent_time"],
    ["Australia/Lord_Howe", "2026-04-05T01:45", "ambiguous_time"],
  ])
    assert.throws(
      () => scheduleInstant(raw, zone),
      (error) => error instanceof ScheduleTimeError && error.code === code,
    );
});

test("An unchanged saved time retains either exact instant during a repeated daylight-saving hour", () => {
  for (const instant of [
    "2026-11-01T05:30:00.123Z",
    "2026-11-01T06:30:00.123Z",
  ]) {
    const local = zonedDateTime(instant, "America/New_York");
    assert.equal(scheduleInstant(local, "America/New_York", instant), instant);
    assert.throws(
      () => scheduleInstant("2026-11-01T01:45", "America/New_York", instant),
      (error) => error.code === "ambiguous_time",
    );
  }
});

test("Timezone changes preserve unsaved schedule instants and empty fields", () => {
  const original = { publishAt: null, closeAt: null };
  const local = { publishAt: "2026-10-25T14:05:28.093", closeAt: "" };
  const converted = rezoneSchedule(
    local,
    "Africa/Kigali",
    "Asia/Shanghai",
    original,
  );
  assert.deepEqual(converted.issues, []);
  assert.deepEqual(converted.values, {
    publishAt: "2026-10-25T20:05:28.093",
    closeAt: "",
  });
  assert.deepEqual(
    rezoneSchedule(
      converted.values,
      converted.timeZone,
      "Africa/Kigali",
      converted.original,
    ).values,
    local,
  );
  // A known UTC instant converted into a repeated hour stays unambiguous on save.
  const repeated = rezoneSchedule(
    { publishAt: "2026-11-01T06:30", closeAt: "" },
    "UTC",
    "America/New_York",
    original,
  );
  const draft = { settings: original };
  const result = jobEditorInput(
    draft,
    { min: "", max: "" },
    repeated.values,
    repeated.timeZone,
    repeated.original,
  );
  assert.deepEqual(result.issues, []);
  assert.equal(result.draft.settings.publishAt, "2026-11-01T06:30:00.000Z");
});

test("An invalid unsaved date blocks timezone changes without erasing entered values", () => {
  const original = { publishAt: null, closeAt: null };
  const values = { publishAt: "2026-03-08T02:30", closeAt: "2026-03-09T10:00" };
  const result = rezoneSchedule(values, "America/New_York", "UTC", original);
  assert.deepEqual(result.values, values);
  assert.equal(result.timeZone, "America/New_York");
  assert.deepEqual(result.issues, [
    { field: "draft.settings.publishAt", code: "nonexistent_time" },
  ]);
});

test("Editor sends UTC instants and reports localized time errors at the correct field", () => {
  const draft = { settings: { publishAt: null, closeAt: null } };
  const result = jobEditorInput(
    draft,
    { min: "", max: "" },
    { publishAt: "2026-10-25T14:00", closeAt: "2026-10-25T15:00" },
    "Africa/Kigali",
  );
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.draft.settings, {
    publishAt: "2026-10-25T12:00:00.000Z",
    closeAt: "2026-10-25T13:00:00.000Z",
  });
  assert.deepEqual(draft.settings, { publishAt: null, closeAt: null });
  const invalid = jobEditorInput(
    draft,
    { min: "", max: "" },
    { publishAt: "", closeAt: "2026-03-08T02:30" },
    "America/New_York",
  );
  assert.deepEqual(invalid.issues, [
    { field: "draft.settings.closeAt", code: "nonexistent_time" },
  ]);
});
