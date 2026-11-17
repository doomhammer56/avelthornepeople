import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { parse } from "dotenv";
import { loadAuthTestEnvironment } from "../auth/test-env.mjs";
try {
  if (process.argv.slice(2).some((value) => value !== "--apply"))
    throw new Error();
  const ref = loadAuthTestEnvironment(),
    files = [".env", ".env.test"].map((path) => ({
      path,
      text: readFileSync(path, "utf8"),
    }));
  const envs = files.map((file) => parse(file.text));
  for (const env of envs) {
    if (new URL(env.SUPABASE_URL).hostname !== `${ref}.supabase.co`)
      throw new Error();
    for (const key of ["DATABASE_URL", "DIRECT_URL"]) {
      const url = new URL(env[key]);
      if (
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        (url.hostname !== `db.${ref}.supabase.co` &&
          !(
            url.hostname.endsWith(".pooler.supabase.com") &&
            decodeURIComponent(url.username).endsWith(`.${ref}`)
          ))
      )
        throw new Error();
    }
    for (const name of ["AUTH_APP_ORIGIN", "PUBLIC_SITE_URL"]) {
      const url = new URL(env[name]);
      if (
        url.protocol !== "http:" ||
        !["localhost", "127.0.0.1"].includes(url.hostname) ||
        url.username ||
        url.password
      )
        throw new Error();
    }
  }
  const names = [
    "CANDIDATE_ENCRYPTION_KEYS",
    "CANDIDATE_MATCH_KEYS",
    "CANDIDATE_ACTIVE_KEY_VERSION",
  ];
  const values = Object.fromEntries(
    names.map((name) => {
      const existing = envs.map((env) => env[name]).filter(Boolean);
      if (new Set(existing).size > 1) throw new Error();
      return [name, existing[0]];
    }),
  );
  if (
    (values.CANDIDATE_ENCRYPTION_KEYS ||
      values.CANDIDATE_MATCH_KEYS ||
      values.CANDIDATE_ACTIVE_KEY_VERSION) &&
    names.some((name) => !values[name])
  )
    throw new Error();
  if (!values.CANDIDATE_ENCRYPTION_KEYS) {
    values.CANDIDATE_ENCRYPTION_KEYS = JSON.stringify({
      1: randomBytes(32).toString("base64"),
    });
    values.CANDIDATE_MATCH_KEYS = JSON.stringify({
      1: randomBytes(32).toString("base64"),
    });
    values.CANDIDATE_ACTIVE_KEY_VERSION = "1";
  }
  for (const name of names.slice(0, 2)) {
    const ring = JSON.parse(values[name]);
    const key = ring[values.CANDIDATE_ACTIVE_KEY_VERSION];
    if (typeof key !== "string" || Buffer.from(key, "base64").length !== 32)
      throw new Error();
  }
  if (!process.argv.includes("--apply"))
    console.log(
      "Dev/test project verified. Use --apply to save candidate keys locally; existing complete keys are preserved.",
    );
  else {
    for (const file of files) {
      let text = file.text;
      for (const name of names) {
        const line = `${name}='${values[name]}'`;
        const pattern = new RegExp(`^${name}=.*$`, "m");
        text = pattern.test(text)
          ? text.replace(pattern, () => line)
          : text.replace(/\s*$/, "") + `\n${line}\n`;
      }
      writeFileSync(file.path, text);
    }
    console.log(
      "Candidate keys saved in ignored local dev/test environments. No keys printed; restart the server.",
    );
  }
} catch {
  console.error(
    "Candidate key setup refused: verify matching dedicated local environments and complete, consistent existing key configuration. No automatic key rotation is performed.",
  );
  process.exitCode = 1;
}
