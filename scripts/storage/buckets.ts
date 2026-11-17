import "dotenv/config";
import {
  storageAdminClient,
  CvStorageError,
} from "../../src/server/adapters/storage/config.ts";
import { configureCvBuckets } from "../../src/server/adapters/storage/buckets.ts";
import { configureContentBucket } from "../../src/server/content/bucket.ts";

try {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply"))
    throw new Error("Use --apply to provision; omit it to verify.");
  const client = storageAdminClient();
  const apply = args.includes("--apply");
  const results = [
    ...(await configureCvBuckets(client, apply)),
    await configureContentBucket(client, apply),
  ];
  console.log(JSON.stringify(results, null, 2));
  if (results.some((result) => !result.configured)) process.exitCode = 1;
} catch (error) {
  console.error(
    error instanceof CvStorageError
      ? error.message
      : "Storage bucket setup failed; check credentials and connectivity.",
  );
  process.exitCode = 1;
}
