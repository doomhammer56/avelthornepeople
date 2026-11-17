// Removes rules from src/app/admin/admin.css whose selectors reference an
// `.admin-*` class that no source file mentions any more. Run it after
// migrating a screen to shadcn components:
//
//   node scripts/admin/prune-admin-css.mjs          # dry run, prints a summary
//   node scripts/admin/prune-admin-css.mjs --write  # rewrite admin.css
//
// A class counts as "used" if its name appears anywhere under src/ outside
// admin.css (including partial names built with template strings).
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const cssPath = join(root, "src/app/admin/admin.css");
const write = process.argv.includes("--write");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|mjs|css)$/.test(name) && full !== cssPath) out.push(full);
  }
  return out;
}
const source = walk(join(root, "src"))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
// Tests reference a few markers by name too.
const tests = walk(join(root, "tests"))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
const haystack = source + "\n" + tests;

const css = readFileSync(cssPath, "utf8");

const used = new Map();
function classUsed(name) {
  if (!used.has(name)) {
    // Also keep a class if a template literal builds it, e.g. `admin-tone-${x}`.
    const parts = name.split("-");
    let hit = haystack.includes(name);
    for (let i = parts.length - 1; !hit && i >= 2; i--) {
      const prefix = parts.slice(0, i).join("-") + "-";
      if (haystack.includes(prefix + "${")) hit = true;
    }
    used.set(name, hit);
  }
  return used.get(name);
}

// Minimal brace-aware tokenizer: yields top-level chunks (comments, rules, at-rules).
function chunks(text) {
  const result = [];
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i) + 2;
      result.push({ type: "comment", text: text.slice(i, end) });
      i = end;
      continue;
    }
    if (/\s/.test(text[i])) {
      let j = i;
      while (j < text.length && /\s/.test(text[j])) j++;
      result.push({ type: "space", text: text.slice(i, j) });
      i = j;
      continue;
    }
    const open = text.indexOf("{", i);
    const semi = text.indexOf(";", i);
    if (semi !== -1 && (open === -1 || semi < open)) {
      result.push({ type: "statement", text: text.slice(i, semi + 1) });
      i = semi + 1;
      continue;
    }
    let depth = 0;
    let j = open;
    do {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
      j++;
    } while (depth > 0 && j < text.length);
    const prelude = text.slice(i, open).trim();
    const body = text.slice(open + 1, j - 1);
    result.push({ type: prelude.startsWith("@") ? "at" : "rule", prelude, body });
    i = j;
  }
  return result;
}

let removedRules = 0;

// Split a selector list on top-level commas only, so :is(a, b) and :not(a, b)
// stay in one piece.
function splitSelectors(prelude) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < prelude.length; i++) {
    const char = prelude[i];
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === "," && depth === 0) {
      parts.push(prelude.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(prelude.slice(start).trim());
  return parts.filter(Boolean);
}
function selectorDead(selector) {
  const classes = [...selector.matchAll(/\.(admin-[A-Za-z0-9_-]+|instant-filter-form)/g)];
  return classes.some((match) => !classUsed(match[1]));
}

function prune(text, depth = 0) {
  const pieces = [];
  for (const chunk of chunks(text)) {
    if (chunk.type === "rule") {
      const selectors = splitSelectors(chunk.prelude);
      const alive = selectors.filter((s) => !selectorDead(s));
      if (alive.length === 0) {
        removedRules++;
        continue;
      }
      pieces.push(
        `${alive.join(",\n")} {${chunk.body}}`,
      );
    } else if (chunk.type === "at") {
      if (/^@(media|supports|layer)/.test(chunk.prelude)) {
        const inner = prune(chunk.body, depth + 1).trim();
        if (!inner) continue;
        pieces.push(`${chunk.prelude} {\n${inner
          .split("\n")
          .map((line) => (line ? "  " + line : line))
          .join("\n")}\n}`);
      } else pieces.push(`${chunk.prelude} {${chunk.body}}`);
    } else if (chunk.type === "space") {
      pieces.push(chunk.text.includes("\n\n") ? "\n\n" : "\n");
    } else pieces.push(chunk.text);
  }
  return pieces.join("");
}

let next = prune(css);
// Drop section-heading comments left orphaned, then collapse blank-line runs.
next = next.replace(/\n{3,}/g, "\n\n").replace(/(\/\*[^]*?\*\/\s*){2,}(?=\S)/g, (m) => m);
const before = css.split("\n").length;
const after = next.split("\n").length;
console.log(
  `${relative(root, cssPath)}: ${before} -> ${after} lines (${removedRules} rules removed)`,
);
if (write) writeFileSync(cssPath, next);
else console.log("dry run; pass --write to apply");
