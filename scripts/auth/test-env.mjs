import { readFileSync } from "node:fs";
import { parse } from "dotenv";

export function loadAuthTestEnvironment() {
  let env;
  try {
    env = parse(readFileSync(new URL("../../.env.test", import.meta.url)));
  } catch {
    throw new Error(
      "Create the ignored .env.test with dedicated Supabase test credentials.",
    );
  }
  const required = [
    "DATABASE_URL",
    "DIRECT_URL",
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "TEST_STAFF_USER_ID",
    "AUTH_TEST_PROJECT_REF",
    "AUTH_LIMITER_SECRET",
  ];
  if (required.some((key) => !env[key]))
    throw new Error(
      "The dedicated .env.test is missing required variable values.",
    );
  const ref = env.AUTH_TEST_PROJECT_REF;
  if (!/^[a-z0-9]{20}$/.test(ref))
    throw new Error(
      "AUTH_TEST_PROJECT_REF must be the test project's reference ID.",
    );
  try {
    if (new URL(env.SUPABASE_URL).hostname !== `${ref}.supabase.co`)
      throw new Error();
    for (const name of ["DATABASE_URL", "DIRECT_URL"]) {
      const url = new URL(env[name]);
      const user = decodeURIComponent(url.username);
      if (
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        (url.hostname !== `db.${ref}.supabase.co` &&
          !(
            url.hostname.endsWith(".pooler.supabase.com") &&
            user.endsWith(`.${ref}`)
          ))
      )
        throw new Error();
    }
  } catch {
    throw new Error(
      "Test API/database settings must match AUTH_TEST_PROJECT_REF; no fixtures were created.",
    );
  }
  // Required values come from this file only, never from production .env fallback.
  Object.assign(process.env, env);
  process.env.AUTH_APP_ORIGIN = env.AUTH_APP_ORIGIN || "http://127.0.0.1:3000";
  if (env.AUTH_LIMITER_SECRET.length < 32)
    throw new Error(
      "The test limiter secret must be stable and at least 32 characters.",
    );
  return ref;
}

// Retry only initial DNS lookup, before any fixture transaction or mutation.
export async function connectAuthTestDatabase(createClient) {
  for (let attempt = 0; ; attempt++) {
    const client = createClient();
    try {
      await client.connect();
      return client;
    } catch (error) {
      await client.end().catch(() => {});
      if (attempt >= 2 || !["ENOTFOUND", "EAI_AGAIN"].includes(error.code))
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
}
