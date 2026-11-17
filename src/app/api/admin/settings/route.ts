import type { NextRequest } from "next/server";
import { staffEndpoint } from "@/server/auth/middleware";
import { readAuthBody } from "@/server/auth/http";
import { readAdminSettings } from "@/server/admin/queries";
import {
  saveReference,
  referenceErrorResponse,
} from "@/server/settings/service";

export function GET(request: NextRequest) {
  return staffEndpoint(request, "lookups.read", readAdminSettings);
}

export async function POST(request: NextRequest) {
  return staffEndpoint(
    request,
    "settings.write",
    async (identity) => saveReference(identity, await readAuthBody(request)),
    { write: true, errorResponse: referenceErrorResponse },
  );
}
