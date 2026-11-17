import "dotenv/config";
import { storageAdminClient } from "../../src/server/adapters/storage/config.ts";
import { configureContentBucket } from "../../src/server/content/bucket.ts";

try {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply")) throw new Error();
  const result = await configureContentBucket(
    storageAdminClient(),
    args.includes("--apply"),
  );
  console.log(JSON.stringify(result, null, 2));
  if (!result.configured) process.exitCode = 1;
} catch {
  console.error(
    "Content image storage setup failed; check SUPABASE_URL, SUPABASE_SECRET_KEY and connectivity.",
  );
  process.exitCode = 1;
}
