// Resolve the public site origin once so metadata, sitemap and JSON-LD agree.
// PUBLIC_SITE_URL in env always wins (local dev or staging overrides).
// In production Vercel builds without an env override, fall back to the
// canonical domain so every URL is absolute and indexable from day one.
export function getSiteUrl(): URL {
  const configured = process.env.PUBLIC_SITE_URL;
  if (configured) return new URL(configured);
  const vercelHost =
    process.env.VERCEL_ENV === "production"
      ? process.env.VERCEL_PROJECT_PRODUCTION_URL
      : process.env.VERCEL_URL;
  if (vercelHost) return new URL(`https://${vercelHost}`);
  // Default to the canonical production domain so all generated URLs
  // (sitemap, robots, JSON-LD) always resolve against the real origin.
  return new URL("https://tricore.com.de");
}

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** True when the browser Origin matches the configured site (loopback aliases OK). */
export function matchesSiteOrigin(requestOrigin: string | null): boolean {
  if (!requestOrigin) return false;
  const site = getSiteUrl();
  if (requestOrigin === site.origin) return true;
  try {
    const request = new URL(requestOrigin);
    return (
      loopbackHosts.has(request.hostname) &&
      loopbackHosts.has(site.hostname) &&
      request.protocol === site.protocol &&
      request.port === site.port
    );
  } catch {
    return false;
  }
}
