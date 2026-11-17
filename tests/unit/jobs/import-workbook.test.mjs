import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import { buildJobImportTemplate } from "../../../src/lib/admin/jobImport/template.ts";
import { parseJobImportWorkbook } from "../../../src/lib/admin/jobImport/parse.ts";
import {
  importColumns,
  headerLabel,
  importLimits,
} from "../../../src/lib/admin/jobImport/columns.ts";

const item = (code, zh, en) => ({
  id: randomUUID(),
  code,
  version: 1,
  active: true,
  label: { zh, en },
});
const refs = {
  departments: [item("DUBAI", "杜拜项目", "Dubai")],
  locations: [item("DXB", "杜拜", "Dubai")],
  jobTypes: [item("FULL_TIME", "全职", "Full-time")],
  experienceLevels: [item("ANY", "经验不限", "Any")],
};
async function load(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}
async function save(workbook) {
  return workbook.xlsx.writeBuffer();
}
const column = (key) => importColumns.findIndex((c) => c.key === key) + 1;

test("The template has the Jobs, Guide, Reference and hidden marker sheets", async () => {
  const workbook = await load(await buildJobImportTemplate(refs));
  assert.deepEqual(
    workbook.worksheets.map((s) => [s.name, s.state]),
    [
      ["Jobs", "visible"],
      ["Guide", "visible"],
      ["Reference", "visible"],
      ["_meta", "hidden"],
    ],
  );
  const jobs = workbook.getWorksheet("Jobs");
  assert.deepEqual(
    importColumns.map((c, i) => jobs.getCell(1, i + 1).value),
    importColumns.map(headerLabel),
  );
  assert.equal(
    workbook.getWorksheet("Reference").getCell("A2").value,
    "杜拜项目",
  );
  assert.equal(jobs.getCell(2, column("project")).dataValidation.type, "list");
});

test("A filled template parses to text rows keyed by spreadsheet row number", async () => {
  const workbook = await load(await buildJobImportTemplate(refs));
  const jobs = workbook.getWorksheet("Jobs");
  jobs.getCell(2, column("title_zh")).value = "部门助理";
  jobs.getCell(2, column("project")).value = "杜拜项目";
  jobs.getCell(2, column("salary_min")).value = 1500;
  jobs.getCell(2, column("responsibilities_zh")).value = {
    richText: [{ text: "1.处理" }, { text: "事务\n2.协助" }],
  };
  jobs.getCell(2, column("requirements_zh")).value = {
    formula: "A1",
    result: "学历",
  };
  jobs.getCell(5, column("title_zh")).value = "第二个";
  const parsed = await parseJobImportWorkbook(await save(workbook));
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.missingMarker, false);
  assert.deepEqual(
    parsed.rows.map((r) => r.row),
    [2, 5],
  );
  assert.equal(parsed.rows[0].cells.title_zh, "部门助理");
  assert.equal(parsed.rows[0].cells.salary_min, "1500");
  assert.equal(parsed.rows[0].cells.responsibilities_zh, "1.处理事务\n2.协助");
  assert.equal(parsed.rows[0].cells.requirements_zh, "学历");
});

test("An empty template reports empty", async () => {
  const parsed = await parseJobImportWorkbook(
    await buildJobImportTemplate(refs),
  );
  assert.deepEqual(parsed.issues, [{ code: "empty" }]);
});

test("A wrong template version is rejected; a missing marker is only flagged", async () => {
  const workbook = await load(await buildJobImportTemplate(refs));
  workbook.getWorksheet("Jobs").getCell(2, 1).value = "x";
  workbook.getWorksheet("_meta").getCell("B1").value = 99;
  assert.deepEqual(
    (await parseJobImportWorkbook(await save(workbook))).issues,
    [{ code: "template_mismatch" }],
  );
  const plain = await load(await buildJobImportTemplate(refs));
  plain.getWorksheet("Jobs").getCell(2, 1).value = "x";
  plain.removeWorksheet("_meta");
  const parsed = await parseJobImportWorkbook(await save(plain));
  assert.equal(parsed.missingMarker, true);
  assert.deepEqual(parsed.issues, []);
});

test("Missing required columns and unknown columns are reported", async () => {
  const workbook = await load(await buildJobImportTemplate(refs));
  const jobs = workbook.getWorksheet("Jobs");
  jobs.getCell(1, column("project")).value = "招聘渠道";
  jobs.getCell(2, 1).value = "x";
  const parsed = await parseJobImportWorkbook(await save(workbook));
  assert.deepEqual(parsed.issues, [
    { code: "missing_columns", columns: ["project"] },
  ]);
  assert.deepEqual(parsed.unknownColumns, ["招聘渠道"]);
  assert.deepEqual(parsed.rows, []);
});

test("Duplicate headers, row cap, size and non-xlsx files are rejected", async () => {
  const dup = await load(await buildJobImportTemplate(refs));
  dup.getWorksheet("Jobs").getCell(1, 20).value = "岗位名称";
  assert.deepEqual((await parseJobImportWorkbook(await save(dup))).issues, [
    { code: "duplicate_columns", columns: ["title_zh"] },
  ]);

  const many = await load(await buildJobImportTemplate(refs));
  const jobs = many.getWorksheet("Jobs");
  for (let r = 2; r <= importLimits.maxRows + 2; r++)
    jobs.getCell(r, 1).value = `t${r}`;
  const capped = await parseJobImportWorkbook(await save(many));
  assert.deepEqual(capped.issues, [{ code: "too_many_rows" }]);

  assert.deepEqual(
    (await parseJobImportWorkbook(new TextEncoder().encode("a,b\n1,2"))).issues,
    [{ code: "not_xlsx" }],
  );
  assert.deepEqual(
    (await parseJobImportWorkbook(new Uint8Array([0x50, 0x4b, 1, 2, 3])))
      .issues,
    [{ code: "not_xlsx" }],
  );
  assert.deepEqual(
    (
      await parseJobImportWorkbook(
        new Uint8Array(importLimits.maxFileBytes + 1),
      )
    ).issues,
    [{ code: "file_too_large" }],
  );
});
