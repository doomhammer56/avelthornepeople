import { rolesFor } from "../../lib/auth/permissions.ts";
import "server-only";
import type { StaffIdentity } from "../auth/identity.ts";
import { staffRead } from "../admin/read.ts";
import { selectAdminJobs } from "./management-read.ts";
import {
  createJobSchema,
  saveJobSchema,
  duplicateJobSchema,
  jobActionSchema,
} from "./management-contract.ts";
import { StaffAuthError } from "../auth/errors.ts";
import { z } from "zod";
import { databaseJobError, zodJobError } from "./validation.ts";

export type JobCommand = "create" | "save" | "duplicate" | "action";
export function mapJobError(error: unknown) {
  if (error instanceof z.ZodError) return zodJobError(error);
  const validation = databaseJobError(error);
  if (validation) return validation;
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  if (["23505", "40001", "55000"].includes(code))
    return new StaffAuthError(409);
  if (
    ["22023", "22P02", "22007", "22008", "23514", "23503", "22003"].includes(
      code,
    ) ||
    error instanceof z.ZodError
  )
    return new StaffAuthError(400);
  if (code === "42501") return new StaffAuthError(403);
  return error;
}
export async function manageJob(
  identity: StaffIdentity,
  command: JobCommand,
  id: string | undefined,
  body: unknown,
) {
  try {
    const data =
      command === "create"
        ? createJobSchema.parse(body)
        : command === "save"
          ? saveJobSchema.parse(body)
          : command === "duplicate"
            ? duplicateJobSchema.parse(body)
            : jobActionSchema.parse(body);
    const target =
      command === "create" && "id" in data ? data.id : z.uuid().parse(id);
    const action =
      command === "action" && "action" in data ? data.action : command;
    return await staffRead(
      identity,
      action === "publish" || action === "resume"
        ? rolesFor("jobs.publish")
        : rolesFor("jobs.write"),
      async (db, staff) => {
        const { rows } = await db.query(
          "SELECT portal_private.manage_job($1,$2::uuid,$3,$4::uuid,$5::jsonb,$6,$7::uuid,$8) AS id",
          [
            action,
            target,
            "expectedVersion" in data ? data.expectedVersion : null,
            data.requestId,
            "draft" in data ? JSON.stringify(data.draft) : null,
            "slug" in data ? data.slug : null,
            command === "duplicate" && "id" in data ? data.id : null,
            "allowChineseFallback" in data
              ? data.allowChineseFallback === true
              : false,
          ],
        );
        return {
          job: (await selectAdminJobs(db, staff.role, [rows[0].id]))[0],
        };
      },
    );
  } catch (error) {
    throw mapJobError(error);
  }
}
