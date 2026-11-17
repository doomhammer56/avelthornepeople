import { readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const routes = [
  "admin/(console)/page",
  "admin/(console)/jobs/page",
  "admin/(console)/applications/page",
  "admin/(console)/applications/[id]/page",
  "admin/(console)/content/page",
  "[locale]/careers/page",
];
const common = JSON.parse(await readFile(".next/build-manifest.json", "utf8"));
const rows = [];
for (const route of routes) {
  const source = await readFile(
    `.next/server/app/${route}_client-reference-manifest.js`,
    "utf8",
  );
  const start = source.indexOf(" = {", source.indexOf("\n"));
  if (start < 0)
    throw new Error("Unsupported generated Next.js manifest format");
  const manifest = JSON.parse(
    source
      .slice(start + 3)
      .trim()
      .replace(/;$/, ""),
  );
  const key = `[project]/src/app/${route}`;
  const js = [
    ...new Set([
      ...(common.rootMainFiles ?? []),
      ...(manifest.entryJSFiles[key] ?? []),
    ]),
  ];
  const css = [
    ...new Set((manifest.entryCSSFiles[key] ?? []).map((file) => file.path)),
  ];
  const size = async (files) => {
    const bytes = await Promise.all(
      files.map((file) => readFile(`.next/${file}`)),
    );
    return {
      raw: bytes.reduce((sum, file) => sum + file.length, 0),
      gzip: bytes.reduce((sum, file) => sum + gzipSync(file).length, 0),
    };
  };
  const [javascript, styles] = await Promise.all([size(js), size(css)]);
  rows.push({ route, javascript, styles, chunks: js.length });
}
const kib = (bytes) => (bytes / 1024).toFixed(1);
const report = `# Production asset snapshot\n\nGenerated from the current local Next.js build. Sizes are unique initial manifest assets, including shared runtime; gzip is calculated locally per file. This is not measured network transfer, CPU time, font download size, or a before/after latency claim. Lazy preview/export chunks are outside these initial entries.\n\n| Route | JS raw KiB | JS gzip KiB | CSS raw KiB | CSS gzip KiB | JS chunks |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${rows.map((row) => `| ${row.route} | ${kib(row.javascript.raw)} | ${kib(row.javascript.gzip)} | ${kib(row.styles.raw)} | ${kib(row.styles.gzip)} | ${row.chunks} |`).join("\n")}\n`;
console.log(report);
if (process.argv.includes("--save"))
  await writeFile(
    "docs/planning/admin-performance-assets-2026-10-28.md",
    report,
  );
