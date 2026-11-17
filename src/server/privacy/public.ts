import "server-only";
import { createHash } from "node:crypto";
import { prepareRequest } from "../applications/intake.ts";
import { withRuntime } from "../database/runtime.ts";
import { publicDeletionRequest } from "./contract.ts";

export async function requestCandidateDeletion(
  request: Request,
  runTransaction = withRuntime,
) {
  // Reuse same-origin, trusted-proxy IP, committed rate limits, bounded JSON and
  // idempotency-header validation. No email/name or candidate ID is accepted.
  const { requestId, body } = await prepareRequest(request, runTransaction);
  const { resumeToken } = publicDeletionRequest.parse(body);
  const [upload, capability] = resumeToken.split(".");
  await runTransaction(null, (db) =>
    db.query("SELECT portal_private.request_privacy_from_receipt($1,$2,$3)", [
      upload,
      createHash("sha256").update(capability).digest(),
      requestId,
    ]),
  );
  // The same response is returned for unknown, expired, duplicate and valid
  // receipts. Registration does not authorize erasure; ADMIN verification does.
  return { status: "received" };
}
