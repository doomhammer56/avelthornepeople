import { NextRequest } from "next/server";
import { jobBody } from "@/server/jobs/http";
import { importBodyLimit, importEndpoint } from "@/server/jobs/import-http";
import { commitJobImport, listJobImports } from "@/server/jobs/import";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  return importEndpoint(request, { mutate: false }, listJobImports);
}
export async function POST(request: NextRequest) {
  return importEndpoint(
    request,
    { mutate: true, status: 201 },
    async (identity) =>
      commitJobImport(identity, await jobBody(request, importBodyLimit)),
  );
}
