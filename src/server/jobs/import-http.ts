import "server-only";
import { revalidateTag } from "next/cache";
import type { NextRequest } from "next/server";
import { staffEndpoint } from "../auth/middleware.ts";
import { privateHeaders } from "../auth/errors.ts";
import type { StaffIdentity } from "../auth/identity.ts";
import { jobErrorResponse } from "./http.ts";
import { ImportRejected } from "./import.ts";

// 200 rows of long Chinese text stay well under this, and under typical host limits.
export const importBodyLimit = 3_000_000;

export function importEndpoint(
  request: NextRequest,
  // `mutate` writes jobs (and refreshes the public cache); `post` only makes the
  // request carry a body, so it still has to come from the console's own origin.
  options: { mutate: boolean; post?: boolean; status?: number },
  action: (identity: StaffIdentity) => Promise<unknown>,
) {
  return staffEndpoint(
    request,
    "jobs.write",
    async (identity) => {
      try {
        const result = await action(identity);
        // Overwrites can touch jobs the public site caches.
        if (options.mutate) revalidateTag("public-jobs", { expire: 0 });
        return result;
      } catch (error) {
        // The rows changed since the preview (or the client skipped it): send the
        // fresh row-by-row result so the page can show what is wrong now.
        if (error instanceof ImportRejected)
          return Response.json(
            {
              error: "import_invalid",
              rows: error.validation.rows,
              summary: error.validation.summary,
              canConfirm: false,
            },
            { status: 400, headers: privateHeaders },
          );
        throw error;
      }
    },
    {
      write: options.mutate || options.post === true,
      status: options.status,
      errorResponse: jobErrorResponse,
    },
  );
}
