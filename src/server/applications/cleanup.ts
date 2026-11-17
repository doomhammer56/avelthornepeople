import "server-only";
import { withRuntime } from "../database/runtime.ts";
import { createCvStorage } from "../adapters/storage/cv-storage.ts";
import { storageAdminClient } from "../adapters/storage/config.ts";

const cleanupDependencies = {
  runTransaction: withRuntime,
  storage: () => createCvStorage(storageAdminClient()),
  now: Date.now,
};
type CleanupClaim = {
  id: string;
  objectKey: string;
  providerExpiresAt: string;
  leaseToken: string;
};

export async function cleanupApplicationUploads(
  dependencies = cleanupDependencies,
) {
  const started = dependencies.now();
  let removed = 0,
    failed = 0,
    skipped = 0,
    batches = 0;
  // At most ten 20-object batches, and never start another after 20 seconds.
  // Storage calls have a 15-second ceiling, leaving time to finalize the lease
  // before the route's 60-second hosting limit. No DB transaction spans HTTP.
  while (batches < 10 && dependencies.now() - started < 20_000) {
    const claims: CleanupClaim[] = await dependencies.runTransaction(
      null,
      async (db) =>
        (
          await db.query(
            "SELECT portal_private.claim_application_upload_cleanup() uploads",
          )
        ).rows[0].uploads,
    );
    if (!claims.length) break;
    let status: "removed" | "failed" = "removed";
    try {
      await dependencies.storage().removeExpiredQuarantines(
        claims.map((claim) => ({
          ...claim,
          providerExpiresAt: new Date(claim.providerExpiresAt),
        })),
      );
    } catch {
      status = "failed";
    }
    const result = await dependencies.runTransaction(
      null,
      async (db) =>
        (
          await db.query(
            "SELECT portal_private.finish_application_upload_cleanup($1::jsonb) result",
            [
              JSON.stringify(
                claims.map((claim) => ({
                  id: claim.id,
                  leaseToken: claim.leaseToken,
                  status,
                })),
              ),
            ],
          )
        ).rows[0].result,
    );
    removed += Number(result.removed);
    failed += Number(result.failed);
    skipped += Number(result.skipped);
    batches++;
    // Let provider outages recover rather than exhausting the entire backlog.
    if (status === "failed" || claims.length < 20) break;
  }
  return { removed, failed, skipped, batches };
}
