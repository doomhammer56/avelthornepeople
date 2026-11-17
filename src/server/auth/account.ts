import "server-only";
import { z } from "zod";
import { withRuntime } from "../database/runtime.ts";
import type { StaffIdentity } from "./identity.ts";
import { StaffAuthError } from "./errors.ts";

// Same rules as the team contract and the database function: 1-100 characters,
// no control characters. The database is the final authority.
export const profileCommand = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((value) => !/[\u0000-\u001f\u007f]/.test(value)),
  })
  .strict();

// A staff member may only ever rename themselves: the database function takes
// no target id and uses the verified session subject.
export async function renameOwnProfile(
  identity: StaffIdentity,
  displayName: string,
) {
  try {
    return await withRuntime(
      identity.subject,
      async (db) => {
        const { rows } = await db.query(
          "SELECT portal_private.rename_own_profile($1::text) AS result",
          [displayName],
        );
        const result = rows[0]?.result as
          | { displayName?: unknown; version?: unknown }
          | undefined;
        if (typeof result?.displayName !== "string")
          throw new StaffAuthError(503);
        return { displayName: result.displayName };
      },
      undefined,
      identity.sessionId,
    );
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
    if (code === "22023") throw new StaffAuthError(400);
    if (code === "42501") throw new StaffAuthError(403);
    throw error;
  }
}
