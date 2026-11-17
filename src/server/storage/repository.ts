import "server-only";
import pg from "pg";
import { CvAccessError, type CvRepository } from "./cv-url.ts";
import { CLEAN_BUCKET } from "../adapters/storage/config.ts";
import { runtimePool, withRuntime } from "../database/runtime.ts";

export function cvRepository(sessionId: string): CvRepository {
  return createCvRepository(runtimePool(), sessionId);
}

export function createCvRepository(
  connectionPool: pg.Pool,
  sessionId?: string,
): CvRepository {
  return {
    async withSubject(subject, action) {
      return withRuntime(
        subject,
        async (db) => {
          const checkSession = async () => {
            if (
              sessionId &&
              !(
                await db.query(
                  "SELECT portal_private.staff_session_is_admitted($1::uuid) AS live",
                  [sessionId],
                )
              ).rows[0].live
            )
              throw new CvAccessError(401);
          };
          await checkSession();
          const result = await action({
            async role() {
              return (
                await db.query(
                  "SELECT portal_private.current_staff_role() AS role",
                )
              ).rows[0].role;
            },
            async findCv(applicationId) {
              const result = await db.query(
                `SELECT u.id, u.object_key, u.detected_type,
              u.size_bytes, u.sha256, u.scan_state FROM portal.applications a
              JOIN portal.uploads u ON u.id=a.cv_upload_id
              JOIN portal.candidates c ON c.id=a.candidate_id
              WHERE a.id=$1 AND a.intake_state='CONFIRMED' AND u.scan_state IN('CLEAN','UNSCANNED')
                AND u.access_revoked_at IS NULL AND NOT portal_private.candidate_group_blocked(c.id)
                AND u.storage_provider='SUPABASE'
                AND ((u.scan_state='CLEAN' AND u.bucket=$2 AND u.scanned_at IS NOT NULL)
                  OR(u.scan_state='UNSCANNED' AND u.bucket='cv-quarantine' AND u.scanned_at IS NULL))`,
                [applicationId, CLEAN_BUCKET],
              );
              const row = result.rows[0];
              return row
                ? {
                    id: row.id,
                    objectKey: row.object_key,
                    contentType: row.detected_type,
                    sizeBytes: Number(row.size_bytes),
                    sha256: row.sha256,
                    scanState: row.scan_state,
                  }
                : null;
            },
            async recordAccess(applicationId, requestId, expected) {
              try {
                await checkSession();
                await db.query(
                  "SELECT portal_private.record_bound_cv_access($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::bigint)",
                  [
                    applicationId,
                    requestId,
                    expected.id,
                    expected.objectKey,
                    Buffer.from(expected.sha256),
                    expected.contentType,
                    expected.sizeBytes,
                  ],
                );
              } catch (error) {
                if (
                  typeof error === "object" &&
                  error !== null &&
                  "code" in error &&
                  error.code === "42501"
                ) {
                  throw new CvAccessError(403);
                }
                throw error;
              }
            },
          });
          return result;
        },
        connectionPool,
        sessionId,
      );
    },
  };
}
