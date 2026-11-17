import { uuid as uuidSchema, safeParse } from "zod/mini";

const filterFields = {
  "/admin/jobs": ["lang", "status", "q", "pageSize"],
  "/admin/log": [
    "lang",
    "action",
    "objectType",
    "actorId",
    "objectId",
    "requestId",
    "actor",
    "from",
    "to",
    "pageSize",
  ],
} as const;
export type InstantFilterAction = keyof typeof filterFields;
const uuidFields = new Set([
  "actorId",
  "objectId",
  "requestId",
  "jobId",
  "candidateId",
]);
const uuid = uuidSchema();

// Include only the query fields supported by each existing list endpoint.
// Pagination resets on criteria changes and candidate contact fields can never enter a URL.
export function instantFilterHref(
  action: InstantFilterAction,
  entries: Iterable<[string, FormDataEntryValue]>,
): string | null {
  const allowed: readonly string[] = filterFields[action];
  const params = new URLSearchParams();
  for (const [name, value] of entries) {
    if (!allowed.includes(name) || typeof value !== "string") continue;
    const text = value.trim();
    if (!text) continue;
    // The actor dropdown offers "System" for events with no staff member behind them.
    if (action === "/admin/log" && name === "actorId" && text === "system") {
      params.append("actor", "system");
      continue;
    }
    if (uuidFields.has(name) && !safeParse(uuid, text).success) return null;
    params.append(name, text);
  }
  params.sort();
  return `${action}${params.size ? `?${params}` : ""}`;
}

export const instantFilterText = {
  en: { updating: "Updating results…" },
  zh: { updating: "正在更新结果…" },
} as const;
