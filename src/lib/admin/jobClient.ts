import { AdminRequestError } from "./staffClient.ts";
import { adminDataChanged } from "./cacheEvents.ts";
import type { AdminJob } from "./jobFields.ts";
import { safeJobIssues, type JobIssue } from "./jobValidation.ts";
export class JobRequestError extends AdminRequestError {
  readonly issues: JobIssue[];
  constructor(status: number, issues: unknown) {
    super(status);
    this.issues = safeJobIssues(issues);
  }
}
export async function sendJobCommand(
  path: string,
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
  fetcher: typeof fetch = fetch,
): Promise<AdminJob> {
  const response = await fetcher(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const data =
      response.status === 400 ? await response.json().catch(() => null) : null;
    throw new JobRequestError(
      response.status,
      data?.error === "validation_failed" ? data.issues : [],
    );
  }
  const data = await response.json();
  if (
    !data?.job ||
    typeof data.job.id !== "string" ||
    !Number.isSafeInteger(data.job.version) ||
    !data.job.draft
  )
    throw new AdminRequestError(503);
  adminDataChanged("jobs");
  return data.job;
}
