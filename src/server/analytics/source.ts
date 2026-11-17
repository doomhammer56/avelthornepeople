export const sourceKeys = [
  "direct",
  "linkedin",
  "jobstreet",
  "referral",
  "other",
] as const;
export type TrafficSource = (typeof sourceKeys)[number];
export function normalizeSource(value: string): TrafficSource {
  const key = value.trim().toLowerCase();
  return (sourceKeys as readonly string[]).includes(key)
    ? (key as TrafficSource)
    : "other";
}

export function detailSource(
  utmSource: string | null,
  referrer: string,
  origin: string,
): TrafficSource {
  if (utmSource && utmSource.length <= 100) {
    const source = normalizeSource(utmSource);
    if (source !== "other") return source;
  }
  if (!referrer) return "direct";
  try {
    const url = new URL(referrer);
    if (url.origin === origin) return "direct";
    const host = url.hostname.toLowerCase();
    if (host === "linkedin.com" || host.endsWith(".linkedin.com"))
      return "linkedin";
    if (
      [
        "jobstreet.com",
        "jobstreet.com.my",
        "jobstreet.com.sg",
        "jobstreet.com.ph",
        "jobstreet.co.id",
      ].some((domain) => host === domain || host.endsWith(`.${domain}`))
    )
      return "jobstreet";
  } catch {
    /* Invalid referrers are never persisted. */
  }
  return "other";
}
