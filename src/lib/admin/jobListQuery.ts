// Shared URL parsing stays independent of editor/mutation validation.
export const jobStatuses = {
  draft: "DRAFT",
  pending: "PENDING_REVIEW",
  published: "PUBLISHED",
  paused: "PAUSED",
  closed: "CLOSED",
} as const;
export type JobListQuery = {
  statuses: (keyof typeof jobStatuses)[];
  q: string;
  page: number;
  pageSize: number;
};
export function parseJobQuery(params: URLSearchParams): JobListQuery {
  const statuses = [...new Set(params.getAll("status"))];
  const q = (params.get("q") ?? "").trim();
  const integer = (key: string, fallback: number, max: number) => {
    const raw = params.get(key) ?? String(fallback);
    if (!/^[1-9]\d*$/.test(raw) || Number(raw) > max)
      throw new Error("Invalid job query");
    return Number(raw);
  };
  if (statuses.some((s) => !Object.hasOwn(jobStatuses, s)) || q.length > 200)
    throw new Error("Invalid job query");
  return {
    statuses: statuses as JobListQuery["statuses"],
    q,
    page: integer("page", 1, 10000),
    pageSize: integer("pageSize", 20, 100),
  };
}
