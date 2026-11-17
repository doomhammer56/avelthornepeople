import "server-only";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { getSiteUrl, matchesSiteOrigin } from "../../lib/siteUrl.ts";
import { withRuntime } from "../database/runtime.ts";
import { readAuthBody } from "../auth/http.ts";
import { attemptKey } from "../auth/limiter.ts";
import { StaffAuthError, privateHeaders } from "../auth/errors.ts";
import {
  storageAdminClient,
  QUARANTINE_BUCKET,
  CvStorageError,
} from "../adapters/storage/config.ts";
import {
  createCvStorage,
  prepareUpload,
} from "../adapters/storage/cv-storage.ts";
import {
  contactKeys,
  encryptedCandidate,
  encryptProfileValue,
} from "../candidates/crypto.ts";
import { normalizeEmail, normalizePhone } from "../candidates/contacts.ts";
import { uploadRequest, intakeRequest } from "./intake-contract.ts";
import { validateCvBytes } from "./intake-file.ts";
import { publicJobAcceptsApplications } from "../jobs/public.ts";
import { ApplicationInputError, intakeIssues } from "./intake-feedback.ts";
import { assertTurnstileToken } from "../auth/turnstile.ts";

class ApplicationsClosed extends Error {}

const hash = (value: string) => createHash("sha256").update(value).digest();
const intakeDependencies = {
  runTransaction: withRuntime,
  storage: storageAdminClient,
};

export async function prepareRequest(
  request: Request,
  runTransaction = withRuntime,
) {
  const origin = getSiteUrl();
  if (
    !matchesSiteOrigin(request.headers.get("origin")) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new StaffAuthError(403);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new StaffAuthError(400);
  const requestId = z.uuid().parse(request.headers.get("idempotency-key"));
  const header = process.env.AUTH_TRUSTED_IP_HEADER;
  if (
    header &&
    !["x-vercel-forwarded-for", "cf-connecting-ip"].includes(header)
  )
    throw new StaffAuthError(503);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (!header && !local) throw new StaffAuthError(503);
  const ip = header
    ? request.headers.get(header)?.split(",")[0]?.trim()
    : "local-shared";
  if (!ip || (header && !isIP(ip))) throw new StaffAuthError(400);
  const retry = await runTransaction(
    null,
    async (db) =>
      (
        await db.query(
          "SELECT portal_private.consume_intake_traffic($1::uuid) retry",
          [attemptKey("application-intake", ip)],
        )
      ).rows[0].retry,
  );
  if (retry) throw new StaffAuthError(429, "traffic_limited", Number(retry));
  return { requestId, body: await readAuthBody(request) };
}

export async function createApplicationUpload(request: Request) {
  const { requestId, body } = await prepareRequest(request);
  const input = uploadRequest.parse(body);
  if (!(await publicJobAcceptsApplications(input.jobId)))
    throw new ApplicationsClosed();
  const intent = prepareUpload(input.contentType, input.size);
  const capability = randomBytes(32).toString("base64url");
  await withRuntime(null, (db) =>
    db.query(
      "SELECT portal_private.reserve_application_upload($1,$2,$3,$4,$5,$6)",
      [
        input.jobId,
        requestId,
        intent.id,
        intent.objectKey,
        intent.sizeBytes,
        hash(capability),
      ],
    ),
  );
  const grant = await createCvStorage(storageAdminClient()).issueUpload(intent);
  return {
    uploadUrl: grant.signedUrl,
    resumeToken: `${intent.id}.${capability}`,
  };
}

export async function receiveApplication(
  request: Request,
  dependencies = intakeDependencies,
) {
  const { requestId, body } = await prepareRequest(
    request,
    dependencies.runTransaction,
  );
  const captchaToken = (body as { captchaToken?: unknown }).captchaToken;
  await assertTurnstileToken(captchaToken, request);
  const input = intakeRequest.parse(body);
  let profile;
  try {
    profile = {
      name: input.name,
      email: normalizeEmail(input.email),
      phone: normalizePhone(input.phone),
    };
  } catch {
    throw new ApplicationInputError([{ field: "phone", code: "invalid" }]);
  }
  const [uploadId, capability] = input.resumeToken.split(".");
  z.uuid().parse(uploadId);
  const upload = await dependencies
    .runTransaction(
      null,
      async (db) =>
        (
          await db.query(
            "SELECT portal_private.application_upload($1,$2) upload",
            [uploadId, hash(capability)],
          )
        ).rows[0].upload,
    )
    .catch((error: unknown) => {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "22023"
      )
        throw new ApplicationInputError([
          { field: "resume", code: "upload_expired" },
        ]);
      throw error;
    });
  if (upload.jobId !== input.jobId || upload.requestId !== requestId)
    throw new StaffAuthError(400);
  const type = upload.objectKey.endsWith(".pdf")
    ? "application/pdf"
    : "application/msword";
  let sha: Buffer;
  const replay = upload.acceptedSha256 != null;
  if (replay) {
    if (
      typeof upload.acceptedSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(upload.acceptedSha256)
    )
      throw new CvStorageError("UNAVAILABLE");
    sha = Buffer.from(upload.acceptedSha256, "hex");
  } else {
    const bucket = dependencies.storage().storage.from(QUARANTINE_BUCKET);
    const info = await bucket.info(upload.objectKey);
    if (info.error || !info.data) throw new CvStorageError("PROVIDER");
    if (
      info.data.size !== Number(upload.size) ||
      info.data.contentType !== type
    )
      throw new ApplicationInputError([
        { field: "resume", code: "resume_invalid" },
      ]);
    const file = await bucket.download(upload.objectKey);
    if (file.error || !file.data) throw new CvStorageError("PROVIDER");
    try {
      sha = validateCvBytes(
        Buffer.from(await file.data.arrayBuffer()),
        type,
        Number(upload.size),
      );
    } catch {
      throw new ApplicationInputError([
        { field: "resume", code: "resume_invalid" },
      ]);
    }
  }
  // HMAC protects low-entropy contact data in the replay digest too.
  const digest = createHmac("sha256", process.env.AUTH_LIMITER_SECRET!)
    .update(
      JSON.stringify({
        jobId: input.jobId,
        locale: input.locale,
        ...profile,
        coverLetter: input.coverLetter || "",
        consentVersion: input.consentVersion,
        sha256: sha.toString("hex"),
      }),
    )
    .digest();
  if (replay) {
    await dependencies.runTransaction(null, (db) =>
      db.query("SELECT portal_private.replay_application($1,$2,$3,$4,$5)", [
        uploadId,
        hash(capability),
        input.jobId,
        requestId,
        digest,
      ]),
    );
    return { status: "duplicate", confirmationEmailSent: false };
  }
  const id = randomUUID(),
    candidateId = randomUUID();
  const candidate = encryptedCandidate(candidateId, profile);
  const keys = contactKeys(profile.email, profile.phone);
  const status = await dependencies.runTransaction(
    null,
    async (db) =>
      (
        await db.query(
          "SELECT portal_private.accept_application($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) status",
          [
            input.jobId,
            requestId,
            uploadId,
            hash(capability),
            type,
            Number(upload.size),
            sha,
            id,
            encryptProfileValue(profile, `application:${id}:profile`),
            input.coverLetter
              ? encryptProfileValue(
                  input.coverLetter,
                  `application:${id}:coverLetter`,
                )
              : null,
            input.locale,
            digest,
            candidateId,
            candidate.nameEncrypted,
            candidate.emailEncrypted,
            candidate.phoneEncrypted,
            JSON.stringify(keys),
            candidate.hmacKeyVersion,
          ],
        )
      ).rows[0].status,
  );
  return { status, confirmationEmailSent: false };
}

export function intakeErrorResponse(error: unknown) {
  const pgCode =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
  const status =
    error instanceof ApplicationInputError
      ? 400
      : error instanceof StaffAuthError
        ? error.status
        : error instanceof z.ZodError || pgCode === "22023"
          ? 400
          : pgCode === "P0002" || error instanceof ApplicationsClosed
            ? 410
            : pgCode === "40001"
              ? 409
              : pgCode === "55000"
                ? 400
                : 503;
  const captchaFailed =
    error instanceof StaffAuthError && error.code === "captcha_failed";
  const zodCaptcha =
    error instanceof z.ZodError &&
    error.issues.some((i) => i.path[0] === "captchaToken");
  const issues = status === 400 ? intakeIssues(error) : [];
  const responseCode =
    captchaFailed || zodCaptcha
      ? "captcha_failed"
      : issues.length
        ? "validation_failed"
        : undefined;
  return Response.json(
    {
      error:
        status === 410
          ? "Applications closed"
          : "Application could not be received",
      ...(responseCode ? { code: responseCode } : {}),
      ...(issues.length ? { issues } : {}),
    },
    {
      status,
      headers: {
        ...privateHeaders,
        ...(error instanceof StaffAuthError && error.retryAfterSeconds
          ? { "Retry-After": String(error.retryAfterSeconds) }
          : {}),
      },
    },
  );
}
