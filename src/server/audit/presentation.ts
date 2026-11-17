import "server-only";
import type { AuditEntry } from "./contract.ts";
import { contentNames } from "../../lib/content/contract.ts";

function text(value: unknown): string | null {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, 200) || null
    : null;
}
function label(en: unknown, zh: unknown) {
  const english = text(en),
    chinese = text(zh);
  return english || chinese
    ? { en: english ?? chinese!, zh: chinese ?? english! }
    : null;
}
// Current display labels are resolved only during the protected ADMIN read.
// Never copy them back into audit rows or resolve candidate contacts/profiles.
export function auditPresentation(
  entry: AuditEntry,
  row: Record<string, unknown>,
): AuditEntry {
  let objectLabel: AuditEntry["objectLabel"] = null;
  if (
    entry.objectType === "CONTENT" &&
    typeof row.content_type === "string" &&
    Object.hasOwn(contentNames, row.content_type)
  )
    objectLabel = contentNames[row.content_type as keyof typeof contentNames];
  else if (entry.objectType === "JOB")
    objectLabel = label(row.job_en, row.job_zh);
  else if (
    entry.objectType === "STAFF_PROFILE" ||
    entry.objectType === "AUTH_ACCOUNT"
  )
    objectLabel = label(row.target_name, row.target_name);
  else if (["DEPARTMENT", "LOCATION", "JOB_OPTION"].includes(entry.objectType))
    objectLabel = label(row.lookup_en, row.lookup_zh);
  else if (entry.objectType === "APPLICATION") {
    const job = label(row.application_job_en, row.application_job_zh);
    if (job)
      objectLabel = { en: `Application for ${job.en}`, zh: `${job.zh}的申请` };
  }
  return {
    ...entry,
    actorName: entry.actorId ? text(row.actor_name) : null,
    objectLabel,
  };
}
