import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanCell,
  convertRow,
  fixSwap,
  matchLocations,
  matchProject,
  tidyLines,
} from "../../../scripts/jobs/prepare-import.mjs";

const report = () => ({ fixes: [], todo: [] });

test("Cells lose stray CSV quotes and 'to be added' placeholders", () => {
  assert.equal(cleanCell('"1.越南語母語\n2.經驗"'), "1.越南語母語\n2.經驗");
  assert.equal(cleanCell('"He said ""hi"""'), 'He said "hi"');
  assert.equal(cleanCell("需補充"), "");
  assert.equal(cleanCell("Additional information needed"), "");
  assert.equal(cleanCell("面試時告知"), "面試時告知");
  assert.equal(cleanCell("a\r\n\r\n\r\n\r\nb  "), "a\n\nb");
});

test("Page footers are removed and over-long lists fold headings into their first item", () => {
  const r = report();
  const heading = (n) => `${"一二三四五六七八"[n - 1]}、標題`;
  const lines = [];
  for (let section = 1; section <= 8; section++) {
    lines.push(heading(section));
    for (let i = 0; i < 6; i++) lines.push(`– 項目 ${section}.${i}`);
    if (section === 2) lines.push("真人遊戲風控組長 ｜ 職位說明書 第 2 頁");
  }
  assert.equal(lines.length, 57);
  const out = tidyLines(lines.join("\n"), r).split("\n");
  assert.equal(out.length, 48);
  assert.equal(out[0], "一、標題 項目 1.0");
  assert.ok(out.every((line) => !line.includes("職位說明書")));
  assert.equal(r.fixes.length, 2);
  // Short lists are left alone.
  assert.equal(tidyLines("a\nb\nc", report()), "a\nb\nc");
});

test("Swapped qualifications and responsibilities are put back, correct ones are not", () => {
  const r = report();
  assert.deepEqual(
    fixSwap(
      "負責公司整體財務管理\n負責資金",
      "本科以上學歷\n5年經驗",
      r,
      "Chinese",
    ),
    ["本科以上學歷\n5年經驗", "負責公司整體財務管理\n負責資金"],
  );
  assert.equal(r.fixes.length, 1);
  assert.deepEqual(
    fixSwap("Bachelor's degree", "Responsible for sales", report(), "English"),
    ["Bachelor's degree", "Responsible for sales"],
  );
  assert.deepEqual(
    fixSwap(
      "Responsible for finance",
      "Bachelor's degree",
      report(),
      "English",
    ),
    ["Bachelor's degree", "Responsible for finance"],
  );
});

test("Projects match their sheet spelling, including the variant without the 項目 suffix", () => {
  assert.equal(matchProject("杜拜項目").code, "DUBAI_PROJECT");
  assert.equal(matchProject(" 亞美尼亞 ").code, "ARMENIA_PROJECT");
  assert.equal(matchProject("亞美尼亞項目").code, "ARMENIA_PROJECT");
  assert.equal(matchProject("奈及利亞(尼日利亞)市場").code, "NIGERIA_MARKET");
  assert.equal(matchProject("火星項目"), undefined);
});

test("Locations: bare places stay plain, extra wording is kept as a work arrangement", () => {
  const codes = (text) => matchLocations(text).places.map((p) => p.code);
  assert.deepEqual(codes("杜拜"), ["DUBAI"]);
  assert.equal(matchLocations("杜拜").bare, true);
  assert.deepEqual(codes("菲律賓項目/杜拜項目"), ["DUBAI", "PHILIPPINES"]);
  assert.equal(matchLocations("菲律賓項目/杜拜項目").bare, true);
  assert.deepEqual(codes("BGC"), ["PHILIPPINES"]);
  assert.deepEqual(codes("在菲居家辦公"), ["PHILIPPINES"]);
  assert.equal(matchLocations("在菲居家辦公").bare, false);
  assert.deepEqual(codes("遠程"), ["REMOTE"]);
  assert.deepEqual(codes("遠程（非中國地區）"), ["REMOTE"]);
  assert.deepEqual(codes("杜拜(需去尼日利亞/奈及利亞出差)"), ["DUBAI"]);
  // "Vietnam market" names the market, not a place to work.
  assert.deepEqual(codes("越南市場；可遠程辦公或到迪拜到崗"), ["DUBAI"]);
  assert.deepEqual(codes("越南"), ["VIETNAM"]);
  assert.deepEqual(codes("火星"), []);
});

const sourceRow = (overrides = {}) => {
  const cells = Array(18).fill("");
  const base = {
    0: "7",
    1: "推廣專員",
    2: "菲律賓項目",
    3: "緊急",
    4: "不限",
    5: "非中國籍",
    6: "35歲以下",
    7: "中文流利",
    8: "1.會Excel\n2.有經驗",
    9: "1.回覆訊息\n2.開戶",
    10: "菲律賓",
    11: "需補充",
    12: "面議",
    13: "",
    14: "1.13薪",
    15: "",
    16: "",
    17: "",
  };
  Object.entries({ ...base, ...overrides }).forEach(([i, v]) => (cells[i] = v));
  return { sheetRow: 8, cells };
};

test("A source row becomes template cells with codes, canonical choices and bilingual notes", () => {
  const zh = sourceRow();
  const en = sourceRow({
    1: "Promotion Specialist",
    3: "urgent",
    4: "No limit",
    5: "Non-Chinese",
    11: "Additional information needed",
    12: "Negotiable",
    8: "1. Excel\n2. Experience",
    9: "1. Reply\n2. Open accounts",
  });
  const { out, report: rep } = convertRow(zh, en);
  assert.equal(out.title_zh, "推廣專員");
  assert.equal(out.title_en, "Promotion Specialist");
  assert.equal(out.project, "PHILIPPINES_PROJECT");
  assert.equal(out.location, "PHILIPPINES");
  assert.equal(out.priority, "紧急");
  assert.equal(out.gender, "不限");
  assert.equal(out.nationality_zh, "非中國籍");
  assert.equal(out.nationality_en, "Non-Chinese");
  assert.equal(out.working_hours_zh, "", "placeholder dropped");
  assert.equal(out.salary_note_en, "Negotiable");
  assert.equal(out.work_arrangement_zh, "");
  assert.deepEqual(rep.todo, []);
});

test("Rows that need a person are reported, not guessed", () => {
  const { out, report: rep } = convertRow(
    sourceRow({ 2: "菲律賓項目/杜拜項目", 10: "火星", 3: "ASAP" }),
    sourceRow({ 2: "Philippines Project/Dubai Project", 8: "Same", 9: "Same" }),
  );
  assert.equal(out.project, "PHILIPPINES_PROJECT");
  assert.match(out.remark_zh, /菲律賓項目\/杜拜項目/);
  assert.match(out.remark_en, /Philippines Project\/Dubai Project/);
  assert.equal(
    out.title_en,
    "",
    "duplicated English qualifications drop the English",
  );
  assert.equal(rep.todo.length, 4);
  assert.ok(rep.todo.some((t) => t.includes("火星")));
  assert.ok(rep.todo.some((t) => t.includes("ASAP")));
});
