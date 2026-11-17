import test from "node:test";
import assert from "node:assert/strict";
import { applicationExport } from "../../../src/lib/admin/applicationExport.ts";
import { exportLineCount } from "../../../src/lib/admin/exportReport.ts";

const application = {
  id: "00000000-0000-4000-8000-000000000001",
  candidateId: "00000000-0000-4000-8000-000000000002",
  jobId: "job-1",
  name: "测试候选人",
  email: "candidate@example.invalid",
  phone: "+00123456789",
  jobTitle: { en: "Support Specialist", zh: "客服专员" },
  source: "site",
  status: "New",
  submittedAt: "2026-10-27T10:00:00Z",
};

test("application exports include only supplied records and preserve full references and contact strings", () => {
  const { headers, rows, report } = applicationExport(
    [application],
    "en",
    "Africa/Kigali",
    ["Status: New"],
  );
  assert.equal(headers.length, 9);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][0], application.id);
  assert.equal(rows[0][2], application.candidateId);
  assert.equal(rows[0][5], "+00123456789");
  assert.ok(rows[0][7].includes(application.submittedAt));
  assert.ok(rows[0][7].includes("12:00:00"));
  assert.equal(report.pdf.rows.length, 1);
  assert.ok(report.pdf.rows[0][0].includes(application.id));
  assert.equal(
    report.pdf.widths.reduce((sum, width) => sum + width, 0),
    269,
  );
  assert.deepEqual(report.summary, ["Status: New"]);
});

test("Chinese exports translate headers, job, source and recruitment stage without discarding names", () => {
  const { headers, rows, report } = applicationExport(
    [application],
    "zh",
    "UTC",
    [],
  );
  assert.equal(headers[0], "投递 ID");
  assert.equal(rows[0][1], "测试候选人");
  assert.equal(rows[0][3], "客服专员");
  assert.equal(rows[0][6], "官网");
  assert.equal(rows[0][8], "新投递");
  assert.equal(report.locale, "zh");
});

test("spreadsheet row sizing accounts for multiline content and wide Chinese characters", () => {
  assert.equal(exportLineCount("one\ntwo", 20), 2);
  assert.equal(exportLineCount("ABCD", 6), 1);
  assert.equal(exportLineCount("中文中文", 6), 2);
});
