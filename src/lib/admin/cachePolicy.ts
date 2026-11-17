import type { QueryClient } from "@tanstack/react-query";
import type { AdminResource } from "./cacheEvents.ts";

const dependencies: Record<AdminResource, readonly string[]> = {
  applications: [
    "applications",
    "application-detail",
    "application-count",
    "jobs",
    "dashboard",
  ],
  jobs: [
    "applications",
    "application-count",
    "application-options",
    "application-detail",
    "jobs",
    "dashboard",
  ],
  settings: ["applications", "application-options", "references", "jobs"],
  content: [],
  staff: [],
  all: [],
};

export function invalidateAdminResource(
  client: QueryClient,
  resource: AdminResource,
) {
  return client.invalidateQueries({
    predicate: (query) =>
      query.queryKey[0] === "admin" &&
      (resource === "all" ||
        resource === "staff" ||
        dependencies[resource].includes(String(query.queryKey[1]))),
  });
}
