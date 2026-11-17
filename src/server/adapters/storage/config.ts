import "server-only";
import { createClient } from "@supabase/supabase-js";

export const QUARANTINE_BUCKET = "cv-quarantine";
export const CLEAN_BUCKET = "cv-clean";
export const MAX_CV_BYTES = 10_000_000;
export const CV_MIME_TYPES = ["application/pdf", "application/msword"] as const;
export const DOWNLOAD_TTL_SECONDS = 60;
export const APPLICATION_TICKET_SECONDS = 15 * 60;
export const PROVIDER_UPLOAD_SECONDS = 2 * 60 * 60;
export const ORPHAN_GRACE_SECONDS = 5 * 60;

export class CvStorageError extends Error {
  readonly code: "CONFIGURATION" | "INVALID_FILE" | "UNAVAILABLE" | "PROVIDER";
  constructor(code: CvStorageError["code"]) {
    super(`CV storage: ${code}`);
    this.code = code;
    this.name = "CvStorageError";
  }
}

export function storageConfig(env: NodeJS.ProcessEnv = process.env) {
  let url: URL;
  try {
    url = new URL(env.SUPABASE_URL ?? "");
  } catch {
    throw new CvStorageError("CONFIGURATION");
  }
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  const secret = env.SUPABASE_SECRET_KEY;
  if (
    !secret ||
    secret.startsWith("sb_publishable_") ||
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new CvStorageError("CONFIGURATION");
  }
  if (!secret.startsWith("sb_secret_")) {
    try {
      if (
        JSON.parse(Buffer.from(secret.split(".")[1], "base64url").toString())
          .role !== "service_role"
      ) {
        throw new Error("Wrong key role");
      }
    } catch {
      throw new CvStorageError("CONFIGURATION");
    }
  }
  return { url: url.origin, secret };
}

export function storageAdminClient(env: NodeJS.ProcessEnv = process.env) {
  const { url, secret } = storageConfig(env);
  return createClient(url, secret, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          cache: "no-store",
          signal: init?.signal ?? AbortSignal.timeout(15_000),
        }),
    },
  });
}
