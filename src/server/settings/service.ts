import "server-only";
import { z } from "zod";
import { rolesFor } from "../../lib/auth/permissions.ts";
import { staffRead } from "../admin/read.ts";
import { StaffAuthError, privateHeaders } from "../auth/errors.ts";
import type { StaffIdentity } from "../auth/identity.ts";
import { referenceCommand } from "./contract.ts";
import { referenceDto } from "./dto.ts";

export function saveReference(identity: StaffIdentity, value: unknown) {
  const input = referenceCommand.parse(value);
  return staffRead(identity, rolesFor("settings.write"), async (db) => {
    await db.query(
      "SELECT portal_private.manage_job_reference($1,$2,$3,$4,$5)",
      [
        input.category,
        input.id,
        input.expectedVersion,
        input.requestId,
        JSON.stringify(input.value),
      ],
    );
    const table =
      input.category === "department"
        ? "departments"
        : input.category === "location"
          ? "locations"
          : "job_options";
    const row = (
      await db.query(`SELECT * FROM portal.${table} WHERE id=$1`, [input.id])
    ).rows[0];
    return { item: referenceDto(row) };
  });
}
export function referenceErrorResponse(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error ? error.code : null;
  const status =
    error instanceof StaffAuthError
      ? error.status
      : error instanceof z.ZodError || code === "22023"
        ? 400
        : code === "40001" || code === "23505"
          ? 409
          : code === "P0002"
            ? 404
            : code === "42501"
              ? 403
              : 503;
  return Response.json(
    {
      error:
        status === 409
          ? "Option changed or code already exists"
          : "Option could not be saved",
    },
    { status, headers: privateHeaders },
  );
}
