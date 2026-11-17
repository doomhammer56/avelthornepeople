import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  importPreviewSchema,
  importCommitSchema,
  safeImportFileName,
} from "../../../src/server/jobs/import-contract.ts";
import { importLimits } from "../../../src/lib/admin/jobImport/columns.ts";

const rows = [{ row: 2, cells: { title_zh: "助理", project: "杜拜项目" } }];
const decisions = { default: null, perRow: {} };

test("Preview accepts rows and turns per-row decision keys into numbers", () => {
  const parsed = importPreviewSchema.parse({
    rows,
    decisions: { default: "skip", perRow: { 2: "overwrite" } },
  });
  assert.deepEqual(parsed.decisions, {
    default: "skip",
    perRow: { 2: "overwrite" },
  });
  assert.equal(typeof Object.keys(parsed.decisions.perRow)[0], "string");
  assert.equal(parsed.decisions.perRow[2], "overwrite");
});

test("Unknown columns, repeated rows, empty or oversized batches and bad choices are refused", () => {
  const bad = [
    { rows: [{ row: 2, cells: { recruiter: "x" } }], decisions },
    { rows: [rows[0], rows[0]], decisions },
    { rows: [], decisions },
    {
      rows: Array.from({ length: importLimits.maxRows + 1 }, (_, i) => ({
        row: i + 2,
        cells: {},
      })),
      decisions,
    },
    { rows, decisions: { default: "merge", perRow: {} } },
    { rows, decisions: { default: null, perRow: { abc: "skip" } } },
    { rows, decisions, extra: true },
  ];
  for (const body of bad) assert.throws(() => importPreviewSchema.parse(body));
});

test("Commit needs a batch id and carries the previewed overwrite versions", () => {
  const id = randomUUID();
  const ok = importCommitSchema.parse({
    requestId: randomUUID(),
    fileName: "jobs.xlsx",
    rows,
    decisions,
    overwrites: { 2: { id, version: 4 } },
  });
  assert.equal(ok.overwrites["2"].version, 4);
  assert.throws(() =>
    importCommitSchema.parse({
      requestId: "nope",
      fileName: "a",
      rows,
      decisions,
      overwrites: {},
    }),
  );
  assert.throws(() =>
    importCommitSchema.parse({
      requestId: randomUUID(),
      fileName: "a",
      rows,
      decisions,
      overwrites: { 2: { id, version: 0 } },
    }),
  );
});

test("File names keep only a safe base name", () => {
  const backslash = String.fromCharCode(92);
  assert.equal(
    safeImportFileName(["C:", "Users", "a", "jobs v1.xlsx"].join(backslash)),
    "jobs v1.xlsx",
  );
  assert.equal(safeImportFileName("/tmp/x/y.xlsx"), "y.xlsx");
  assert.equal(safeImportFileName("a\u0000b\nc.xlsx"), "a b c.xlsx");
  assert.equal(safeImportFileName("   "), "import.xlsx");
  assert.equal(
    safeImportFileName("x".repeat(400)).length,
    importLimits.maxFileNameChars,
  );
});
