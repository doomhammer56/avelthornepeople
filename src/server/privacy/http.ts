import "server-only";
import type { NextRequest } from "next/server";
import type { StaffIdentity } from "../auth/identity.ts";
import { staffEndpoint } from "../auth/middleware.ts";
import { recruitmentBody } from "../applications/http.ts";
import { privacyErrorResponse } from "./errors.ts";
export { privacyErrorResponse } from "./errors.ts";

export const privacyBody = recruitmentBody;
export function privacyEndpoint(
  request: NextRequest,
  write: boolean,
  action: (identity: StaffIdentity) => Promise<unknown>,
) {
  return staffEndpoint(request, "privacy.manage", action, {
    write,
    errorResponse: privacyErrorResponse,
  });
}
