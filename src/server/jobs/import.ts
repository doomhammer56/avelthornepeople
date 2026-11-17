import { rolesFor } from "../../lib/auth/permissions.ts";
import "server-only";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { StaffIdentity } from "../auth/identity.ts";
import { StaffAuthError } from "../auth/errors.ts";
import { staffRead } from "../admin/read.ts";
import { adminReferenceSql } from "../admin/queries.ts";
import { referenceDto } from "../settings/dto.ts";
import { jobDraftSchema } from "./management-contract.ts";
import { mapJobError } from "./management.ts";
import {
  importCommitSchema,
  importPreviewSchema,
  safeImportFileName,
  type ImportCommit,
  type ImportCommitResult,
  type ImportHistoryEntry,
} from "./import-contract.ts";
import {
  validateImportRows,
  type ExistingJob,
  type ImportRefs,
  type ImportRowInput,
  type ImportValidation,
} from "../../lib/admin/jobImport/validate.ts";

/** The submitted rows cannot be imported as they stand; the body is the fresh preview. */
export class ImportRejected extends Error {
  readonly validation: ImportValidation;
  constructor(validation: ImportValidation) {
    super("Import rejected");
    this.validation = validation;
  }
}

type Context = {
  refs: ImportRefs;
  existing: ExistingJob[];
  slugs: Map<string, string>;
};

// References and the non-closed jobs that could collide with the file.
async function loadContext(
  db: pg.PoolClient,
  rows: readonly ImportRowInput[],
): Promise<Context> {
  const {
    rows: [data],
  } = await db.query(adminReferenceSql);
  const options = data.options as Record<string, unknown>[];
  const refs: ImportRefs = {
    departments: (data.departments as Record<string, unknown>[]).map(
      referenceDto,
    ),
    locations: (data.locations as Record<string, unknown>[]).map(referenceDto),
    jobTypes: options.filter((o) => o.kind === "jobType").map(referenceDto),
    experienceLevels: options
      .filter((o) => o.kind === "experience")
      .map(referenceDto),
  };
  // Only jobs in a department the file mentions can match, so the list stays small.
  const departmentIds = refs.departments
    .filter((department) =>
      rows.some((row) => {
        const name = (row.cells.project ?? "")
          .normalize("NFKC")
          .trim()
          .toLowerCase();
        return [department.code, department.label.zh, department.label.en].some(
          (label) =>
            label && label.normalize("NFKC").trim().toLowerCase() === name,
        );
      }),
    )
    .map((department) => department.id);
  const { rows: jobs } = departmentIds.length
    ? await db.query(
        `SELECT id,canonical_slug,version,status,settings_locked,draft_content FROM portal.jobs
         WHERE status<>'CLOSED' AND draft_content#>>'{settings,departmentId}'=ANY($1::text[])
         ORDER BY created_at,id`,
        [departmentIds],
      )
    : { rows: [] };
  const existing: ExistingJob[] = [];
  const slugs = new Map<string, string>();
  for (const job of jobs) {
    // A draft the contract cannot read (legacy fixtures) cannot be matched or overwritten.
    const draft = jobDraftSchema.safeParse(job.draft_content);
    if (!draft.success) continue;
    existing.push({
      id: job.id,
      version: Number(job.version),
      status: job.status,
      settingsLocked: job.settings_locked === true,
      draft: draft.data,
    });
    slugs.set(job.id, job.canonical_slug);
  }
  return { refs, existing, slugs };
}

export function previewJobImport(identity: StaffIdentity, body: unknown) {
  const input = importPreviewSchema.parse(body);
  return staffRead(identity, rolesFor("jobs.write"), async (db) => {
    const context = await loadContext(db, input.rows);
    const { rows, summary, canConfirm } = validateImportRows(
      input.rows,
      context.refs,
      context.existing,
      input.decisions,
    );
    return { rows, summary, canConfirm };
  });
}

const failureCounts = (input: ImportCommit) => ({
  total: input.rows.length,
  failed: input.rows.length,
});

async function recordImport(
  db: pg.PoolClient,
  id: string,
  fileName: string,
  status: "COMPLETED" | "FAILED",
  mode: string,
  counts: [number, number, number, number, number],
) {
  await db.query(
    "SELECT portal_private.record_job_import($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9)",
    [id, fileName, status, mode, ...counts],
  );
}

export async function commitJobImport(
  identity: StaffIdentity,
  body: unknown,
): Promise<ImportCommitResult> {
  const input = importCommitSchema.parse(body);
  const fileName = safeImportFileName(input.fileName);
  try {
    // One transaction (see withRuntime): any failure below rolls the whole
    // batch back, including every audit and outbox row the job commands wrote.
    return await staffRead(identity, rolesFor("jobs.write"), async (db) => {
      // Two imports must not both decide a title is new.
      await db.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('portal.job_import',0))",
      );
      const context = await loadContext(db, input.rows);
      const validation = validateImportRows(
        input.rows,
        context.refs,
        context.existing,
        input.decisions,
      );
      if (!validation.canConfirm) throw new ImportRejected(validation);
      for (const item of validation.plan) {
        if (item.action === "create") {
          const id = randomUUID();
          await db.query(
            "SELECT portal_private.manage_job($1,$2::uuid,$3,$4::uuid,$5::jsonb,$6,$7::uuid,$8) AS id",
            [
              "create",
              id,
              null,
              input.requestId,
              JSON.stringify(item.draft),
              `job-${id}`,
              null,
              false,
            ],
          );
          continue;
        }
        const seen = input.overwrites[String(item.row)];
        // Previewed against a different job or version: refuse, never overwrite blindly.
        if (
          !seen ||
          seen.id !== item.existingId ||
          seen.version !== item.existingVersion
        )
          throw new StaffAuthError(409);
        await db.query(
          "SELECT portal_private.manage_job($1,$2::uuid,$3,$4::uuid,$5::jsonb,$6,$7::uuid,$8) AS id",
          [
            "save",
            item.existingId,
            seen.version,
            input.requestId,
            JSON.stringify(item.draft),
            context.slugs.get(item.existingId!),
            null,
            false,
          ],
        );
      }
      const { create, overwrite, skipped, total } = validation.summary;
      const duplicates = validation.rows.filter((r) => r.duplicate);
      const mode = !duplicates.length
        ? "NONE"
        : duplicates.every((r) => r.action === "skip")
          ? "SKIP"
          : duplicates.every((r) => r.action === "overwrite")
            ? "OVERWRITE"
            : "MIXED";
      await recordImport(db, input.requestId, fileName, "COMPLETED", mode, [
        total,
        create,
        overwrite,
        skipped,
        0,
      ]);
      return {
        importId: input.requestId,
        created: create,
        overwritten: overwrite,
        skipped,
      };
    });
  } catch (error) {
    // The failed batch left nothing behind, so note the attempt in its own
    // transaction. Rejections and permission errors are not import failures.
    if (
      !(error instanceof ImportRejected) &&
      !(error instanceof StaffAuthError && error.status !== 409)
    ) {
      const { total, failed } = failureCounts(input);
      await staffRead(identity, rolesFor("jobs.write"), (db) =>
        recordImport(db, input.requestId, fileName, "FAILED", "NONE", [
          total,
          0,
          0,
          0,
          failed,
        ]),
      ).catch(() => {});
    }
    if (error instanceof ImportRejected) throw error;
    throw mapJobError(error);
  }
}

export function listJobImports(identity: StaffIdentity) {
  return staffRead(identity, rolesFor("jobs.write"), async (db) => {
    const { rows } = await db.query(
      `SELECT i.id,i.file_name,i.status,i.total_rows,i.created_count,i.overwritten_count,
         i.skipped_count,i.failed_count,i.created_at,s.display_name AS actor_name
       FROM portal.job_imports i LEFT JOIN portal.staff_profiles s ON s.id=i.actor_id
       ORDER BY i.created_at DESC,i.id DESC LIMIT 25`,
    );
    return {
      imports: rows.map((row): ImportHistoryEntry => ({
        id: row.id,
        fileName: row.file_name,
        status: row.status,
        // HR can only read their own profile, so other people's names come back empty.
        actorName: row.actor_name ?? null,
        totalRows: Number(row.total_rows),
        created: Number(row.created_count),
        overwritten: Number(row.overwritten_count),
        skipped: Number(row.skipped_count),
        failed: Number(row.failed_count),
        createdAt: new Date(row.created_at).toISOString(),
      })),
    };
  });
}
