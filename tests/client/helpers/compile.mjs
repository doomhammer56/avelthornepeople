import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Compile a real TS/TSX source file for Node's renderer without starting Next.
// Imports named in `mocks` are replaced. Presentational shadcn primitives
// (`@/components/ui/*`, `./ui/*`, `@/lib/utils`) are compiled from source too,
// so markup assertions see the same elements the browser renders.
const srcRoot = fileURLToPath(new URL("../../../src/", import.meta.url));
const cache = new Map();

function resolveSource(id, fromFile) {
  const base = id.startsWith("@/")
    ? resolve(srcRoot, id.slice(2))
    : resolve(dirname(fromFile), id);
  for (const candidate of [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    resolve(base, "index.tsx"),
    resolve(base, "index.ts"),
  ])
    if (existsSync(candidate) && /\.(tsx?)$/.test(candidate)) return candidate;
  return null;
}

const compiledPrefixes = [
  "@/components/ui/",
  "@/components/admin/ui/",
  "./ui/",
  "@/lib/utils",
];

export function loadSource(file, mocks = {}) {
  const require = createRequire(pathUrl(file));
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const compiled = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (id) => {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (compiledPrefixes.some((prefix) => id.startsWith(prefix))) {
        const target = resolveSource(id, file);
        if (target) {
          if (!cache.has(target)) cache.set(target, loadSource(target));
          return cache.get(target);
        }
      }
      return require(id);
    },
    compiled,
    compiled.exports,
  );
  return compiled.exports;
}

function pathUrl(file) {
  return new URL(`file:///${file.replaceAll("\\", "/")}`);
}
