import { NextRequest } from "next/server";
import { jobBody } from "@/server/jobs/http";
import { importBodyLimit, importEndpoint } from "@/server/jobs/import-http";
import { previewJobImport } from "@/server/jobs/import";
export const runtime = "nodejs";
// Dry run: validates and reports, never writes. POST because the rows are the body.
export async function POST(request: NextRequest) {
  return importEndpoint(
    request,
    { mutate: false, post: true },
    async (identity) =>
      previewJobImport(identity, await jobBody(request, importBodyLimit)),
  );
}
