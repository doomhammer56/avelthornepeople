import type { NextRequest } from "next/server";
import { privacyEndpoint, privacyBody } from "@/server/privacy/http";
import {
  readPrivacyPolicy,
  updatePrivacyPolicy,
} from "@/server/privacy/service";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  return privacyEndpoint(request, false, readPrivacyPolicy);
}
export async function PUT(request: NextRequest) {
  return privacyEndpoint(request, true, async (identity) =>
    updatePrivacyPolicy(identity, await privacyBody(request)),
  );
}
