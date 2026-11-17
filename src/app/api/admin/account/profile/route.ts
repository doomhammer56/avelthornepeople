import type { NextRequest } from "next/server";
import { z } from "zod";
import { staffEndpoint } from "@/server/auth/middleware";
import { readAuthBody } from "@/server/auth/http";
import { profileCommand, renameOwnProfile } from "@/server/auth/account";
import { authErrorResponse, StaffAuthError } from "@/server/auth/errors";

export const runtime = "nodejs";

// Every role may edit their own name; the target is never taken from the body.
export function POST(request: NextRequest) {
  return staffEndpoint(
    request,
    "console.read",
    async (identity) => {
      const command = profileCommand.parse(await readAuthBody(request));
      return renameOwnProfile(identity, command.displayName);
    },
    {
      write: true,
      errorResponse: (error) =>
        authErrorResponse(
          error instanceof z.ZodError ? new StaffAuthError(400) : error,
        ),
    },
  );
}
