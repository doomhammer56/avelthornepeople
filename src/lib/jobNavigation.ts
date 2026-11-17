// Whitelist listing filters before carrying them into detail-page navigation.
// Return links remain local and cannot become arbitrary redirect destinations.
export function getJobListingQuery(
  params: Pick<URLSearchParams, "get">,
): string {
  const clean = new URLSearchParams();
  for (const key of ["q", "department", "location", "type", "experience"]) {
    const value = params.get(key)?.slice(0, 200);
    if (value) clean.set(key, value);
  }
  const page = params.get("page");
  if (page && /^[1-9]\d{0,5}$/.test(page) && page !== "1")
    clean.set("page", page);
  return clean.toString();
}

// Timestamp deadlines use the same exclusive boundary as SQL close_at > now().
// Older preview/API date-only deadlines remain inclusive through that UTC date.
export function isPublicJobOpen(
  job: { status: "open" | "closed"; closesAt: string | null },
  now = new Date(),
): boolean {
  if (job.status !== "open") return false;
  if (!job.closesAt) return true;
  return job.closesAt.length === 10
    ? job.closesAt >= now.toISOString().slice(0, 10)
    : Date.parse(job.closesAt) > now.getTime();
}

export function formatPublicJobDeadline(deadline: string, locale: "en" | "zh") {
  if (deadline.length === 10) return deadline;
  // An explicit zone keeps server rendering and all visitors consistent.
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-GB", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(new Date(deadline));
}

/** Close date for candidate-facing UI (no time-of-day or UTC suffix). */
export function formatPublicJobCloseDisplay(
  deadline: string,
  locale: "en" | "zh",
) {
  const d =
    deadline.length === 10
      ? new Date(`${deadline}T12:00:00Z`)
      : new Date(deadline);
  if (locale === "zh") {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "UTC",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(d);
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

/** Posted date on listings and detail (ISO YYYY-MM-DD). */
export function formatPublicJobPostedDate(postedAt: string, locale: "en" | "zh") {
  const d = new Date(`${postedAt}T12:00:00`);
  if (locale === "zh") {
    return d.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
