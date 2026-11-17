import { QueryCache, QueryClient } from "@tanstack/react-query";

export function isAccessError(error: unknown): error is { status: 401 | 403 } {
  return (
    !!error &&
    typeof error === "object" &&
    "status" in error &&
    (error.status === 401 || error.status === 403)
  );
}

export function createAdminQueryClient(
  onAccessDenied?: (error: unknown) => void,
) {
  const client = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        // Let Query finish its settlement/GC bookkeeping before destroying it.
        if (isAccessError(error))
          queueMicrotask(() => {
            // Never keep denied resource data, including on failed refreshes.
            // The provider verifies a 403 against /me before expiring the shell.
            query.setState({ data: undefined, dataUpdatedAt: 0 });
            if (error.status === 401 || !onAccessDenied) client.clear();
            onAccessDenied?.(error);
          });
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        gcTime: 5 * 60_000,
        retry: (attempt, error) => {
          const status =
            error && typeof error === "object" && "status" in error
              ? error.status
              : undefined;
          return (
            attempt < 1 &&
            (status === undefined ||
              (typeof status === "number" && status >= 500))
          );
        },
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      mutations: { retry: false },
    },
  });
  return client;
}
