import { AdminRequestError } from "./staffClient.ts";

export async function requestCvDownload(
  applicationId: string,
  fetcher: typeof fetch = fetch,
) {
  return requestCvUrl(applicationId, "download", fetcher);
}

export async function requestCvPreview(
  applicationId: string,
  fetcher: typeof fetch = fetch,
) {
  return requestCvUrl(applicationId, "preview", fetcher);
}

async function requestCvUrl(
  applicationId: string,
  mode: "preview" | "download",
  fetcher: typeof fetch,
) {
  const response = await fetcher(
    `/api/admin/applications/${encodeURIComponent(applicationId)}/cv-url?mode=${mode}`,
    {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok) throw new AdminRequestError(response.status);
  const data = await response.json();
  const url = new URL(data.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !Number.isFinite(Date.parse(data.expiresAt)) ||
    !["inline", "attachment"].includes(data.disposition)
  )
    throw new AdminRequestError(503);
  if (mode === "preview" && data.disposition !== "inline")
    throw new AdminRequestError(415);
  if (mode === "download" && data.disposition !== "attachment")
    throw new AdminRequestError(503);
  return url.href;
}
