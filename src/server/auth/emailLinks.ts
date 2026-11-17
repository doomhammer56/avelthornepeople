import "server-only";

// The confirm page only accepts `?token_hash=…&type=…`. Supabase's own
// `action_link` verifies the token on the provider and redirects with the
// session in the URL fragment instead, which the page treats as invalid. Email
// we send ourselves must therefore link to the app with the hashed token.
export function staffConfirmUrl(
  origin: string,
  tokenHash: string,
  type: "invite" | "recovery",
  lang: "en" | "zh",
) {
  const url = new URL("/auth/confirm", origin);
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", type);
  url.searchParams.set("lang", lang);
  return url.toString();
}
