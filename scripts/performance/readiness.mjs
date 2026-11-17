import "dotenv/config";
import { withRuntime, runtimePool } from "../../src/server/database/runtime.ts";

try {
  const checks = await withRuntime(
    null,
    async (db) =>
      (
        await db.query(`SELECT
    to_regprocedure('portal_private.read_staff_accounts(integer)') IS NOT NULL AS staff_directory,
    to_regprocedure('portal_private.claim_staff_provider_operation(uuid,uuid)') IS NOT NULL AS staff_provider_claim,
    to_regprocedure('portal_private.finish_staff_provider_claim(uuid,uuid,boolean)') IS NOT NULL AS staff_provider_completion,
    to_regprocedure('portal_private.replay_application(uuid,bytea,uuid,uuid,bytea)') IS NOT NULL AS application_replay,
    to_regprocedure('portal_private.claim_application_upload_cleanup()') IS NOT NULL AS upload_cleanup,
    to_regprocedure('portal_private.record_bound_cv_access(uuid,uuid,uuid,text,bytea,text,bigint)') IS NOT NULL AS bound_cv_access,
    EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='portal' AND c.relname='candidates_group_idx' AND i.indisvalid) AS candidate_group_index`)
      ).rows[0],
  );
  console.log(
    JSON.stringify({ database: "configured runtime", checks }, null, 2),
  );
  if (Object.values(checks).some((value) => !value)) {
    console.error(
      "Backend rollout prerequisites are missing. Review pending migrations and runbooks/team.md before switching the application. Stop/drain old account synchronization requests before the provider-claim migration.",
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error(
    JSON.stringify({
      check: "performance-readiness",
      result: "failed",
      code: /^[0-9A-Z_]{2,32}$/.test(String(error?.code ?? ""))
        ? error.code
        : "UNAVAILABLE",
    }),
  );
  process.exitCode = 1;
} finally {
  await runtimePool()
    .end()
    .catch(() => {});
}
