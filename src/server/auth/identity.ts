import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { identityClient, authConfig } from "../adapters/auth/config.ts";
import { UUID } from "../adapters/storage/cv-storage.ts";
import { StaffAuthError } from "./errors.ts";

export type StaffIdentity = {
  subject: string;
  sessionId: string;
  token: string;
};

export async function verifyIdentity(
  token: string,
  client: SupabaseClient = identityClient(),
): Promise<StaffIdentity> {
  if (!token || token.length > 16_384) throw new StaffAuthError(401);
  const { data, error } = await client.auth.getClaims(token);
  if (error)
    throw new StaffAuthError(!error.status || error.status >= 500 ? 503 : 401);
  const claims = data?.claims;
  if (
    !claims ||
    !UUID.test(claims.sub) ||
    !UUID.test(String(claims.session_id ?? "")) ||
    claims.iss !== `${authConfig().url}/auth/v1` ||
    !(
      claims.aud === "authenticated" ||
      (Array.isArray(claims.aud) && claims.aud.includes("authenticated"))
    ) ||
    typeof claims.exp !== "number" ||
    claims.exp <= Date.now() / 1000 ||
    claims.role !== "authenticated"
  )
    throw new StaffAuthError(401);
  // Network confirmation additionally rejects deleted/banned provider identities.
  const current = await client.auth.getUser(token);
  if (current.error)
    throw new StaffAuthError(
      !current.error.status || current.error.status >= 500 ? 503 : 401,
    );
  if (current.data.user?.id !== claims.sub) throw new StaffAuthError(401);
  return { subject: claims.sub, sessionId: String(claims.session_id), token };
}

export async function cookieIdentity(client: SupabaseClient) {
  // The raw token is only transported from the session; it is verified below.
  const { data, error } = await client.auth.getSession();
  if (error)
    throw new StaffAuthError(!error.status || error.status >= 500 ? 503 : 401);
  if (!data.session?.access_token) throw new StaffAuthError(401);
  return verifyIdentity(data.session.access_token, client);
}

export async function requestIdentity(
  request: Request,
  cookieClient: SupabaseClient,
) {
  if (request.headers.has("authorization")) {
    const token = /^Bearer ([^\s]+)$/i.exec(
      request.headers.get("authorization") ?? "",
    )?.[1];
    if (!token) throw new StaffAuthError(401);
    return verifyIdentity(token);
  }
  return cookieIdentity(cookieClient);
}
