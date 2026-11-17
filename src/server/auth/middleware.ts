import "server-only";
import { NextRequest, NextResponse } from "next/server";
import type { Permission } from "../../lib/auth/permissions.ts";
import { requestAuth } from "../adapters/auth/ssr.ts";
import { requestIdentity, type StaffIdentity } from "./identity.ts";
import { requirePermission, type Staff } from "./staff.ts";
import { assertSameOrigin } from "./http.ts";
import { authErrorResponse, privateHeaders } from "./errors.ts";
import {
  adminServerTiming,
  measureAdminPhase,
  withAdminTimings,
} from "../admin/timing.ts";

// Secure request middleware. Proxy only refreshes cookies; services and database
// commands independently recheck authorization at the actual data/change boundary.
export async function staffEndpoint(
  request: NextRequest,
  permission: Permission,
  action: (identity: StaffIdentity, staff: Staff) => Promise<unknown>,
  options: {
    write?: boolean;
    status?: number;
    errorResponse?: (error: unknown) => Response;
  } = {},
) {
  return withAdminTimings(async () => {
    let auth: ReturnType<typeof requestAuth> | undefined;
    const finish = (result: Response) => {
      const response = new NextResponse(result.body, {
        status: result.status,
        headers: result.headers,
      });
      for (const [name, value] of Object.entries(privateHeaders))
        response.headers.set(name, value);
      response.headers.set("Server-Timing", adminServerTiming());
      return auth ? auth.finish(response) : response;
    };
    try {
      auth = requestAuth(request);
      const identity = await measureAdminPhase("identity", () =>
        requestIdentity(request, auth!.client),
      );
      const staff = await measureAdminPhase("admission", () =>
        requirePermission(identity, permission),
      );
      if (options.write && !request.headers.has("authorization"))
        assertSameOrigin(request);
      const result = await measureAdminPhase("service", () =>
        action(identity, staff),
      );
      return finish(
        result instanceof Response
          ? result
          : NextResponse.json(result, { status: options.status ?? 200 }),
      );
    } catch (error) {
      return finish((options.errorResponse ?? authErrorResponse)(error));
    }
  });
}
