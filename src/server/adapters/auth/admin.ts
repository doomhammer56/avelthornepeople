import "server-only";
import { createClient } from "@supabase/supabase-js";
import { authConfig, authFetch } from "./config.ts";
import { StaffAuthError } from "../../auth/errors.ts";

export function authAdminClient() {
  const { url } = authConfig();
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret || !secret.startsWith("sb_secret_")) {
    try {
      if (
        !secret ||
        JSON.parse(Buffer.from(secret.split(".")[1], "base64url").toString())
          .role !== "service_role"
      )
        throw new Error();
    } catch {
      throw new StaffAuthError(503);
    }
  }
  return createClient(url, secret!, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: authFetch },
  });
}
