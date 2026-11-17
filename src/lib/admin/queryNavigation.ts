import type { QueryClient } from "@tanstack/react-query";
import { parseJobQuery } from "./jobListQuery.ts";
import { parseQuery } from "../../server/applications/contract.ts";
import { parseDashboardRange } from "../../server/dashboard/contract.ts";
import {
  applicationOptions,
  applicationJobOptionsQuery,
  applicationDetailOptions,
  applicationQueryOptions,
  dashboardQueryOptions,
  jobsQueryOptions,
  referenceQueryOptions,
} from "./queries.ts";

export { isAdminQueryNavigation } from "./linkNavigation.ts";

export async function prefetchAdminQueries(client: QueryClient, url: URL) {
  const params = new URLSearchParams(url.search);
  if (url.pathname === "/admin/applications") {
    if (params.has("job")) {
      params.set("jobId", params.get("job")!);
      params.delete("job");
    }
    await Promise.all([
      client.prefetchQuery(applicationQueryOptions(parseQuery(params))),
      client.prefetchQuery(
        params.get("jobId")
          ? applicationJobOptionsQuery("", 1, params.get("jobId")!)
          : applicationOptions,
      ),
    ]);
  } else if (/^\/admin\/applications\/[0-9a-f-]{36}$/i.test(url.pathname)) {
    await client.prefetchQuery(
      applicationDetailOptions(url.pathname.split("/").pop()!),
    );
  } else if (url.pathname === "/admin/jobs") {
    await Promise.all([
      client.prefetchQuery(jobsQueryOptions(parseJobQuery(params))),
      client.prefetchQuery(referenceQueryOptions),
    ]);
  } else if (url.pathname === "/admin") {
    if (params.getAll("range").length > 1) throw new Error("Invalid range");
    await client.prefetchQuery(
      dashboardQueryOptions(
        parseDashboardRange(params.get("range") ?? undefined),
      ),
    );
  }
}
