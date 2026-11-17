import type { ApplicationQuery } from "../../server/applications/contract.ts";
import type {
  ApplicationPage,
  ApplicationDetails,
} from "../../server/applications/service.ts";
import { AdminRequestError } from "./staffClient.ts";
import type { JobListQuery } from "./jobListQuery.ts";
import type { AdminJobPage } from "./jobFields.ts";
import type { AdminSettings } from "./adminSettings.ts";
import type {
  DashboardMetrics,
  DashboardRange,
} from "../../server/dashboard/contract.ts";

export async function adminRead<T>(
  path: string,
  signal?: AbortSignal,
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
      : AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new AdminRequestError(response.status);
  return response.json();
}

export type ApplicationJobs = readonly { id: string; en: string; zh: string }[];
export function applicationDetailOptions(id: string) {
  return {
    queryKey: ["admin", "application-detail", id] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      adminRead<ApplicationDetails>(
        `/api/admin/applications/${encodeURIComponent(id)}`,
        signal,
      ),
    staleTime: 15_000,
    gcTime: 60_000,
  };
}
export function applicationJobOptionsQuery(q = "", page = 1, selected = "") {
  const params = new URLSearchParams({ q: q.trim(), page: String(page) });
  if (selected) params.set("selected", selected);
  return {
    queryKey: ["admin", "application-options", q.trim(), page, selected],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      adminRead<ApplicationJobs>(
        `/api/admin/applications/options?${params}`,
        signal,
      ),
    staleTime: 5 * 60_000,
  };
}
export const applicationOptions = applicationJobOptionsQuery();

export const referenceQueryOptions = {
  queryKey: ["admin", "references"],
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    adminRead<AdminSettings>("/api/admin/settings", signal),
  staleTime: 5 * 60_000,
};

export function jobsQueryKey(query: JobListQuery) {
  return [
    "admin",
    "jobs",
    {
      ...query,
      q: query.q.trim(),
      statuses: [...new Set(query.statuses)].sort(),
    },
  ] as const;
}

export function jobsQueryOptions(query: JobListQuery) {
  const params = new URLSearchParams({
    q: query.q.trim(),
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  [...new Set(query.statuses)]
    .sort()
    .forEach((status) => params.append("status", status));
  return {
    queryKey: jobsQueryKey(query),
    queryFn: async ({ signal }: { signal: AbortSignal }) => ({
      page: await adminRead<AdminJobPage>(
        `/api/admin/jobs/summary?${params}`,
        signal,
      ),
      filters: query,
    }),
    staleTime: 30_000,
  };
}

export function dashboardQueryOptions(range: DashboardRange) {
  return {
    queryKey: ["admin", "dashboard", range] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      adminRead<DashboardMetrics>(
        `/api/admin/dashboard?range=${range}`,
        signal,
      ),
    staleTime: 30_000,
  };
}

export function applicationQueryKey(
  query: ApplicationQuery,
  privateSearchId: string | number = 0,
) {
  // Private contact searches deliberately do not share cached entries or expose terms in keys.
  if (query.email || query.phone)
    return ["admin", "applications", "private", privateSearchId] as const;
  return [
    "admin",
    "applications",
    {
      page: query.page,
      pageSize: query.pageSize,
      status: [...query.status].sort(),
      jobId: query.jobId ?? "",
      candidateId: query.candidateId ?? "",
      source: query.source ?? "",
      from: query.from ?? "",
      to: query.to ?? "",
    },
  ] as const;
}

export function applicationQueryOptions(
  query: ApplicationQuery,
  privateSearchId: string | number = 0,
) {
  const privateSearch = !!(query.email || query.phone);
  return {
    queryKey: applicationQueryKey(query, privateSearchId),
    queryFn: async ({ signal }: { signal: AbortSignal }) => ({
      page: await adminRead<ApplicationPage>(
        "/api/admin/applications/search",
        signal,
        query,
      ),
      criteria: query,
    }),
    staleTime: privateSearch ? 0 : 15_000,
    gcTime: privateSearch ? 0 : 5 * 60_000,
  };
}
