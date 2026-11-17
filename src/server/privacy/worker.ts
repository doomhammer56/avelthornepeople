import "server-only";
import { withPrivacyWorker } from "./database.ts";
import { createPrivacyStorage } from "./storage.ts";
import { storageAdminClient } from "../adapters/storage/config.ts";
import { StaffAuthError } from "../auth/errors.ts";

const defaults = {
  runTransaction: withPrivacyWorker,
  storage: () => createPrivacyStorage(storageAdminClient()),
};
type Claim = {
  applicationId: string;
  uploadId: string;
  provider: string;
  bucket: string;
  objectKey: string;
  leaseToken: string;
};
export async function processPrivacyCleanup(dependencies = defaults) {
  const prepared = await dependencies.runTransaction(
    async (db) =>
      (
        await db.query(
          "SELECT portal_private.prepare_privacy_cleanup(20) result",
        )
      ).rows[0].result,
  );
  const claims: Claim[] = await dependencies.runTransaction(
    async (db) =>
      (await db.query("SELECT portal_private.claim_privacy_cleanup(5) result"))
        .rows[0].result,
  );
  let removed = 0,
    failed = 0,
    skipped = 0;
  // Five bounded leases, external I/O outside transactions; never report a
  // successful erase when the provider failed or a later worker owns the lease.
  const outcomes = await Promise.allSettled(
    claims.map(async (claim) => {
      let success = false;
      try {
        await dependencies
          .storage()
          .purgeUpload(claim.uploadId, claim.provider, {
            bucket: claim.bucket,
            objectKey: claim.objectKey,
          });
        success = true;
      } catch {
        failed++;
      }
      const finished = await dependencies.runTransaction(
        async (db) =>
          (
            await db.query(
              "SELECT portal_private.finish_privacy_cleanup($1,$2,$3) removed",
              [claim.applicationId, claim.leaseToken, success],
            )
          ).rows[0].removed,
      );
      if (finished) removed++;
      else if (success) skipped++;
    }),
  );
  if (outcomes.some((outcome) => outcome.status === "rejected"))
    throw new StaffAuthError(503);
  const summary = await dependencies.runTransaction(
    async (db) =>
      (await db.query("SELECT portal_private.privacy_cleanup_summary() result"))
        .rows[0].result,
  );
  return {
    queued: Number(prepared.queued),
    removed,
    failed,
    skipped,
    completed: Number(prepared.completed) + Number(summary.completed),
    pending: Number(summary.pending),
    overdue: Number(summary.overdue),
  };
}
