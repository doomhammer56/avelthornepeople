import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { z } from "zod";

export function seedOptions(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      "env-file": { type: "string", default: ".env" },
      apply: { type: "boolean", default: false },
      reset: { type: "boolean", default: false },
      project: { type: "string" },
      "admin-id": { type: "string" },
      "with-staff": { type: "boolean", default: false },
      "staff-domain": {
        type: "string",
        default: "job-portal-web-self.vercel.app",
      },
      "staff-password-file": { type: "string" },
      "cleanup-file": { type: "string" },
    },
  });
  if (values.project !== undefined && !/^[a-z0-9]{20}$/.test(values.project))
    throw new Error("Invalid --project reference.");
  if (
    values.apply &&
    (values.reset || values["cleanup-file"]) &&
    !values.project
  )
    throw new Error(
      "Reset and cleanup require --project <Supabase project reference>.",
    );
  if (values["admin-id"]) z.uuid().parse(values["admin-id"]);
  if (values["staff-password-file"] && !values["with-staff"])
    throw new Error("--staff-password-file requires --with-staff.");
  if (values["cleanup-file"] && (values.reset || values["with-staff"]))
    throw new Error(
      "Cleanup cannot be combined with reset or staff provisioning.",
    );
  for (const name of ["hr", "readonly"])
    z.email().parse(`${name}@${values["staff-domain"]}`);
  return values;
}
export function seedEnvironment(file, expectedProject) {
  const env = parse(readFileSync(file, "utf8"));
  const api = new URL(env.SUPABASE_URL),
    connection = new URL(env.DIRECT_URL);
  const ref = api.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/)?.[1];
  if (
    !ref ||
    (expectedProject && expectedProject !== ref) ||
    api.protocol !== "https:" ||
    !["postgres:", "postgresql:"].includes(connection.protocol) ||
    !(
      connection.hostname === `db.${ref}.supabase.co` ||
      (connection.hostname.endsWith(".pooler.supabase.com") &&
        decodeURIComponent(connection.username).endsWith(`.${ref}`))
    )
  )
    throw new Error(
      "Seed refused: the selected environment, database and --project must match.",
    );
  // Do not mix inherited production credentials with a selected environment file.
  if (!env.SUPABASE_SECRET_KEY || !env.SUPABASE_PUBLISHABLE_KEY)
    throw new Error(
      "The selected environment must contain its Auth credentials.",
    );
  Object.assign(process.env, env);
  return ref;
}
