// One-off data preparation for the recruiting team's vacancy sheets.
//
//   node scripts/jobs/prepare-import.mjs <chinese.xlsx> <english.xlsx> [output.xlsx]
//
// The two source sheets have the same 18 columns and the same rows (matched by the
// number in the first column). This merges them into the Excel import template and
// writes a report listing every cleanup it applied and every row that still needs a
// person to look at it. It changes nothing in the database.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import ExcelJS from "exceljs";
import {
  genderOptions,
  importColumns,
  priorityOptions,
} from "../../src/lib/admin/jobImport/columns.ts";
import { buildJobImportTemplate } from "../../src/lib/admin/jobImport/template.ts";
import {
  importLines,
  validateImportRows,
} from "../../src/lib/admin/jobImport/validate.ts";

// ── Proposed references ────────────────────────────────────────────────────────
// The sheet's "Project" is a market (Dubai project, Vietnam SEO market, ...), not a
// function, so these are proposed as departments. The codes are what the output file
// contains, so renaming a label later never breaks an import.
export const PROJECTS = [
  {
    code: "PHILIPPINES_PROJECT",
    zh: "菲律宾项目",
    en: "Philippines Project",
    match: ["菲律賓項目"],
  },
  {
    code: "VIETNAM_PROJECT",
    zh: "越南项目",
    en: "Vietnam Project",
    match: ["越南項目"],
  },
  {
    code: "DUBAI_PROJECT",
    zh: "杜拜项目",
    en: "Dubai Project",
    match: ["杜拜項目"],
  },
  {
    code: "TAIWAN_PROJECT",
    zh: "台湾项目",
    en: "Taiwan Project",
    match: ["台灣項目"],
  },
  {
    code: "NIGERIA_MARKET",
    zh: "尼日利亚市场",
    en: "Nigeria Market",
    match: ["奈及利亞(尼日利亞)市場"],
  },
  {
    code: "SEO_VIETNAM_MARKET",
    zh: "SEO 越南市场",
    en: "SEO Vietnam Market",
    match: ["SEO越南市場"],
  },
  {
    code: "SEO_CHINA_MARKET",
    zh: "SEO 中国市场",
    en: "SEO China Market",
    match: ["SEO中國市場"],
  },
  {
    code: "ARMENIA_PROJECT",
    zh: "亚美尼亚项目",
    en: "Armenia Project",
    match: ["亞美尼亞項目", "亞美尼亞"],
  },
  {
    code: "CYPRUS_PROJECT",
    zh: "塞浦路斯项目",
    en: "Cyprus Project",
    match: ["塞普勒斯項目"],
  },
  {
    code: "OTHER_POSITIONS",
    zh: "其他岗位",
    en: "Other Positions",
    match: ["其他崗位"],
  },
];

// Places are matched by keyword in the "work location" cell. Remote work is a work
// arrangement, so it only becomes a location when no place is named.
export const PLACES = [
  {
    code: "ARMENIA",
    zh: "亚美尼亚",
    en: "Armenia",
    country: "AM",
    timezone: "Asia/Yerevan",
    keys: ["亞美尼亞"],
  },
  {
    code: "DUBAI",
    zh: "迪拜",
    en: "Dubai",
    country: "AE",
    timezone: "Asia/Dubai",
    keys: ["杜拜", "迪拜"],
  },
  {
    code: "PHILIPPINES",
    zh: "菲律宾",
    en: "Philippines",
    country: "PH",
    timezone: "Asia/Manila",
    keys: ["菲律賓", "在菲", "BGC"],
  },
  {
    code: "TAIPEI",
    zh: "台北",
    en: "Taipei",
    country: "TW",
    timezone: "Asia/Taipei",
    keys: ["台北", "台灣"],
  },
  {
    code: "ALBANIA",
    zh: "阿尔巴尼亚",
    en: "Albania",
    country: "AL",
    timezone: "Europe/Tirane",
    keys: ["阿爾巴尼亞"],
  },
  {
    code: "SERBIA",
    zh: "塞尔维亚",
    en: "Serbia",
    country: "RS",
    timezone: "Europe/Belgrade",
    keys: ["塞爾維亞"],
  },
  {
    code: "CYPRUS",
    zh: "塞浦路斯",
    en: "Cyprus",
    country: "CY",
    timezone: "Asia/Nicosia",
    keys: ["塞普勒斯"],
  },
  {
    code: "VIETNAM",
    zh: "越南",
    en: "Vietnam",
    country: "VN",
    timezone: "Asia/Ho_Chi_Minh",
    keys: ["越南"],
    notBefore: "市場",
  },
];
export const REMOTE = {
  code: "REMOTE",
  zh: "远程",
  en: "Remote",
  country: "ZZ",
  timezone: "UTC",
  keys: ["遠程", "居家"],
};

// ── Cell cleanup ───────────────────────────────────────────────────────────────
const PLACEHOLDER =
  /^(需補充|需补充|待補充|待补充|additional information needed|to be (added|supplemented)|tbd)$/i;
const FOOTER = /(第\s*\d+\s*頁|職位說明書|职位说明书|\bpage\s+\d+\b)/i;

export function cleanCell(value) {
  let text = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ");
  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();
  // A stray pair of quotes left by a CSV paste wraps some cells.
  if (text.length > 1 && text.startsWith('"') && text.endsWith('"'))
    text = text.slice(1, -1).replace(/""/g, '"').trim();
  text = text.replace(/\n{3,}/g, "\n\n");
  return PLACEHOLDER.test(text) ? "" : text;
}

const isBullet = (line) => /^\s*(?:[–—\-•·*➡→]|➡️)/u.test(line);
export function tidyLines(value, report) {
  let lines = importLines(cleanCell(value));
  const before = lines.length;
  lines = lines.filter((line) => !FOOTER.test(line));
  if (lines.length < before)
    report.fixes.push(`removed ${before - lines.length} page-footer line(s)`);
  if (lines.length > 50) {
    // Fold each heading into the first bullet below it so the list fits the 50-line limit.
    const folded = [];
    for (let i = 0; i < lines.length; i++) {
      if (
        !isBullet(lines[i]) &&
        i + 1 < lines.length &&
        isBullet(lines[i + 1])
      ) {
        folded.push(
          `${lines[i]} ${lines[i + 1].replace(/^\s*[–—\-•·*➡→]\s*/u, "")}`,
        );
        i++;
      } else folded.push(lines[i]);
    }
    if (folded.length < lines.length)
      report.fixes.push(
        `joined headings to their first item: ${lines.length} → ${folded.length} lines`,
      );
    lines = folded;
  }
  return lines.join("\n");
}

const DUTY =
  /^(?:\d+[.、]\s*)?(?:負責|负责|協助|协助|擔任|担任|處理|处理|responsible|assist|serve|manage|lead|develop)/i;
const QUALIFICATION =
  /^(?:\d+[.、]\s*)?(?:學歷|学历|大學|大学|大專|大专|本科|財務、|财务、|具備|具备|bachelor|education|degree|\d+\+?\s*years)/i;
const firstLine = (text) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean) ?? "";
export function fixSwap(qualifications, responsibilities, report, label) {
  if (
    DUTY.test(firstLine(qualifications)) &&
    QUALIFICATION.test(firstLine(responsibilities))
  ) {
    report.fixes.push(
      `${label}: qualifications and responsibilities were swapped; put back`,
    );
    return [responsibilities, qualifications];
  }
  return [qualifications, responsibilities];
}

export function matchProject(text) {
  const key = String(text).normalize("NFKC").replace(/\s+/g, "");
  return PROJECTS.find((p) =>
    p.match.some((m) => m.normalize("NFKC").replace(/\s+/g, "") === key),
  );
}

export function matchLocations(text) {
  const places = PLACES.filter((place) =>
    place.keys.some((key) => {
      const at = text.indexOf(key);
      return (
        at !== -1 &&
        !(
          place.notBefore &&
          text.slice(at + key.length).startsWith(place.notBefore)
        )
      );
    }),
  );
  const remote = REMOTE.keys.some((key) => text.includes(key));
  const found = places.length ? places : remote ? [REMOTE] : [];
  // Anything beyond the bare place names (remote work, travel, "project") is kept as a note.
  let rest = text;
  for (const place of places)
    for (const key of place.keys) rest = rest.replaceAll(key, "");
  rest = rest.replace(/項目|[\s/、,，;；()（）]/g, "");
  return { places: found, bare: found.length > 0 && !rest };
}

const canonical = (options, raw) => {
  const key = String(raw).normalize("NFKC").trim().toLowerCase();
  return options.find((o) =>
    [o.code, o.zh, o.en, ...o.aliases].some(
      (n) => n.normalize("NFKC").toLowerCase() === key,
    ),
  );
};

// ── Reading ────────────────────────────────────────────────────────────────────
const text = (v) => {
  if (v == null) return "";
  if (typeof v !== "object") return String(v);
  if (v.richText) return v.richText.map((p) => p.text).join("");
  if ("result" in v) return text(v.result);
  if (v.text) return text(v.text);
  return "";
};
async function readSheet(path) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(readFileSync(path));
  const sheet = workbook.worksheets[0];
  if (sheet.columnCount < 18)
    throw new Error(
      `${basename(path)} has ${sheet.columnCount} columns, expected 18`,
    );
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row, n) => {
    if (n === 1) return;
    const cells = Array.from({ length: 18 }, (_, i) =>
      text(row.getCell(i + 1).value).trim(),
    );
    if (cells.some(Boolean)) rows.push({ sheetRow: n, cells });
  });
  return rows;
}
// Zero-based positions in the source sheets.
const S = {
  no: 0,
  title: 1,
  project: 2,
  priority: 3,
  gender: 4,
  nationality: 5,
  age: 6,
  languages: 7,
  qualifications: 8,
  responsibilities: 9,
  location: 10,
  workingHours: 11,
  salaryNote: 12,
  other: 13,
  benefits: 14,
  precautions: 15,
  hardRequirements: 16,
  remark: 17,
};

// ── Conversion ─────────────────────────────────────────────────────────────────
export function convertRow(zh, en) {
  const report = {
    no: zh.cells[S.no],
    title: zh.cells[S.title],
    sheetRow: zh.sheetRow,
    fixes: [],
    todo: [],
  };
  const out = {};
  const note = (key, zhText, enText) => {
    out[`${key}_zh`] = cleanCell(zhText);
    out[`${key}_en`] = cleanCell(enText);
  };

  out.title_zh = cleanCell(zh.cells[S.title]);
  let [qualZh, respZh] = fixSwap(
    zh.cells[S.qualifications],
    zh.cells[S.responsibilities],
    report,
    "Chinese",
  );
  let [qualEn, respEn] = fixSwap(
    en.cells[S.qualifications],
    en.cells[S.responsibilities],
    report,
    "English",
  );
  out.responsibilities_zh = tidyLines(respZh, report);
  out.requirements_zh = tidyLines(qualZh, report);
  out.title_en = cleanCell(en.cells[S.title]);
  out.responsibilities_en = tidyLines(respEn, report);
  out.requirements_en = tidyLines(qualEn, report);
  if (cleanCell(qualEn) && cleanCell(qualEn) === cleanCell(respEn)) {
    // The English translation repeated the duties in the qualifications column.
    out.title_en = out.responsibilities_en = out.requirements_en = "";
    report.todo.push(
      "English qualifications duplicate the responsibilities; English left out, translate the qualifications and re-run",
    );
  }

  // Project → department, one value only.
  const projectParts = zh.cells[S.project]
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  const project = matchProject(projectParts[0] ?? "");
  out.project = project?.code ?? zh.cells[S.project];
  if (!project) report.todo.push(`unknown project "${zh.cells[S.project]}"`);
  const extraProjects = projectParts.slice(1);
  if (projectParts.length > 1)
    report.todo.push(
      `several projects (${zh.cells[S.project]}): only the first is the department; the full text is in Remark`,
    );

  // Location(s).
  const place = matchLocations(zh.cells[S.location]);
  out.location = place.places.map((p) => p.code).join(", ");
  if (!place.places.length)
    report.todo.push(`no location recognised in "${zh.cells[S.location]}"`);
  report.locationText = zh.cells[S.location];
  report.locationCodes = out.location;
  report.arrangementKept = !place.bare;
  const arrangementZh = place.bare ? "" : zh.cells[S.location];
  const arrangementEn = place.bare ? "" : en.cells[S.location];

  const priority = canonical(priorityOptions, zh.cells[S.priority]);
  out.priority = priority?.zh ?? zh.cells[S.priority];
  if (!priority) report.todo.push(`unknown priority "${zh.cells[S.priority]}"`);
  const gender = canonical(genderOptions, zh.cells[S.gender]);
  out.gender = gender?.zh ?? zh.cells[S.gender];
  if (!gender)
    report.todo.push(`unknown gender requirement "${zh.cells[S.gender]}"`);

  note("nationality", zh.cells[S.nationality], en.cells[S.nationality]);
  note("age", zh.cells[S.age], en.cells[S.age]);
  note("languages", zh.cells[S.languages], en.cells[S.languages]);
  note("working_hours", zh.cells[S.workingHours], en.cells[S.workingHours]);
  note("salary_note", zh.cells[S.salaryNote], en.cells[S.salaryNote]);
  note("work_arrangement", arrangementZh, arrangementEn);
  note("other", zh.cells[S.other], en.cells[S.other]);
  note("benefits", zh.cells[S.benefits], en.cells[S.benefits]);
  note("precautions", zh.cells[S.precautions], en.cells[S.precautions]);
  note(
    "hard_requirements",
    zh.cells[S.hardRequirements],
    en.cells[S.hardRequirements],
  );
  note("remark", zh.cells[S.remark], en.cells[S.remark]);
  if (extraProjects.length) {
    out.remark_zh = [out.remark_zh, `項目：${zh.cells[S.project]}`]
      .filter(Boolean)
      .join("\n");
    out.remark_en = [out.remark_en, `Project: ${en.cells[S.project]}`]
      .filter(Boolean)
      .join("\n");
  }
  return { out, report };
}

export async function prepare(zhPath, enPath, outPath) {
  const zh = await readSheet(zhPath);
  const en = await readSheet(enPath);
  if (zh.length !== en.length)
    throw new Error(`Row counts differ: ${zh.length} vs ${en.length}`);
  zh.forEach((row, i) => {
    if (row.cells[S.no] !== en[i].cells[S.no])
      throw new Error(
        `Row ${row.sheetRow}: number ${row.cells[S.no]} in the Chinese file but ${en[i].cells[S.no]} in the English file`,
      );
  });
  const converted = zh.map((row, i) => convertRow(row, en[i]));

  // Proposed references, as the importer will see them.
  const item = (code, label) => ({
    id: randomUUID(),
    code,
    version: 1,
    active: true,
    label: { zh: label.zh, en: label.en },
  });
  const refs = {
    departments: PROJECTS.map((p) => item(p.code, p)),
    locations: [...PLACES, REMOTE].map((p) => item(p.code, p)),
    jobTypes: [item("FULL_TIME", { zh: "全职", en: "Full-time" })],
    experienceLevels: [item("ANY", { zh: "经验不限", en: "Any experience" })],
  };
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildJobImportTemplate(refs));
  const sheet = workbook.getWorksheet("Jobs");
  converted.forEach(({ out }, index) => {
    importColumns.forEach((column, c) => {
      const value = out[column.key];
      if (value) sheet.getCell(index + 2, c + 1).value = value;
    });
  });
  writeFileSync(outPath, Buffer.from(await workbook.xlsx.writeBuffer()));

  // Dry run through the importer's own validation.
  const validation = validateImportRows(
    converted.map(({ out }, index) => ({ row: index + 2, cells: out })),
    refs,
    [],
  );
  return { converted, refs, validation, zhRows: zh };
}

export function renderReport({ converted, validation }, files) {
  const lines = [];
  const L = (s = "") => lines.push(s);
  L(`# Import preparation report`);
  L();
  L(`Source: ${files.zh} + ${files.en}  →  ${files.out}`);
  L(
    `Rows: ${converted.length}. Importer dry run against the proposed references: ` +
      `${validation.summary.create} ready, ${validation.summary.errors} with errors.`,
  );
  L();
  L(`## References to create first (Settings)`);
  L();
  L(`Departments (the sheet's "Project" column):`);
  for (const p of PROJECTS) L(`- ${p.code} — ${p.zh} / ${p.en}`);
  L();
  L(`Locations:`);
  for (const p of [...PLACES, REMOTE])
    L(`- ${p.code} — ${p.zh} / ${p.en} (${p.country}, ${p.timezone})`);
  L();
  L(`## Location mapping (check these)`);
  L();
  const seen = new Map();
  for (const { report } of converted)
    if (!seen.has(report.locationText)) seen.set(report.locationText, report);
  for (const [source, r] of seen)
    L(
      `- "${source.replaceAll("\n", " ")}" → ${r.locationCodes || "(none)"}${r.arrangementKept ? "  + kept as Work arrangement" : ""}`,
    );
  L();
  L(`## Needs a person`);
  let any = false;
  for (const { report } of converted)
    for (const todo of report.todo) {
      any = true;
      L(
        `- No. ${report.no} ${report.title} (sheet row ${report.sheetRow}): ${todo}`,
      );
    }
  if (!any) L(`- nothing`);
  L();
  L(`## Importer errors on the output file`);
  const errors = validation.rows.filter((r) => r.status === "error");
  if (!errors.length) L(`- none`);
  for (const row of errors) {
    const r = converted[row.row - 2].report;
    L(
      `- No. ${r.no} ${r.title} (output row ${row.row}): ${row.issues.map((i) => `${i.column ?? "row"}:${i.code}`).join(", ")}`,
    );
  }
  L();
  L(`## Cleanups applied automatically`);
  let fixes = false;
  for (const { report } of converted)
    for (const fix of report.fixes) {
      fixes = true;
      L(`- No. ${report.no} ${report.title}: ${fix}`);
    }
  if (!fixes) L(`- none`);
  return lines.join("\n");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [zhPath, enPath, outArg] = process.argv.slice(2);
  if (!zhPath || !enPath) {
    console.error(
      "Usage: node scripts/jobs/prepare-import.mjs <chinese.xlsx> <english.xlsx> [output.xlsx]",
    );
    process.exit(2);
  }
  const outPath = resolve(outArg ?? "job-import-ready.xlsx");
  const result = await prepare(resolve(zhPath), resolve(enPath), outPath);
  const reportPath = outPath.replace(/\.xlsx$/i, "") + ".report.md";
  writeFileSync(
    reportPath,
    renderReport(result, {
      zh: basename(zhPath),
      en: basename(enPath),
      out: basename(outPath),
    }),
  );
  console.log(`Wrote ${outPath}\nWrote ${reportPath}`);
  console.log(
    `${result.converted.length} rows · ${result.validation.summary.create} pass the importer · ${result.validation.summary.errors} with errors`,
  );
}
