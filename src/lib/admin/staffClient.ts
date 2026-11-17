import { adminDataChanged } from "./cacheEvents.ts";

export class AdminRequestError extends Error {
  readonly status: number;
  /** Machine-readable reason from the API, e.g. "has_records" or "email_exists". */
  readonly code?: string;
  constructor(status: number, code?: string) {
    super("Admin request failed");
    this.status = status;
    this.code = code;
  }
}

async function failure(response: Response) {
  const code = await response
    .json()
    .then((body: unknown) =>
      body &&
      typeof body === "object" &&
      "code" in body &&
      typeof body.code === "string"
        ? body.code
        : undefined,
    )
    .catch(() => undefined);
  return new AdminRequestError(response.status, code);
}

export function signInAgain(lang: "en" | "zh") {
  // A rejected session must discard private client state and the router cache.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/admin/login?lang=${lang}`);
}
export async function sendStaffCommand(
  body: Record<string, unknown>,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher("/api/admin/staff", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw await failure(response);
  const data = await response.json();
  if (!data || typeof data !== "object") throw new AdminRequestError(503);
  const uuid = (value: unknown) =>
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    );
  if (body.action === "reconcile") {
    if (
      data.operationId !== body.operationId ||
      data.providerSync !== "complete"
    )
      throw new AdminRequestError(503);
  } else if (body.action === "delete") {
    if (data.userId !== body.userId || data.deleted !== true)
      throw new AdminRequestError(503);
  } else {
    if (
      !uuid(data.userId) ||
      ((body.action === "change" || body.action === "link") &&
        data.userId !== body.userId)
    )
      throw new AdminRequestError(503);
    if (
      body.action === "change" &&
      (!["pending", "complete"].includes(data.providerSync) ||
        !Number.isSafeInteger(data.version) ||
        data.version < 1)
    )
      throw new AdminRequestError(503);
    if (data.providerSync === "pending" && !uuid(data.operationId))
      throw new AdminRequestError(503);
  }
  adminDataChanged("staff");
  return data as {
    userId?: string;
    operationId?: string;
    providerSync?: "pending" | "complete";
    version?: number;
    /** invite/link: false when the chosen role/activation could not be applied. */
    accessApplied?: boolean;
    active?: boolean;
    /** invite: false when the member was created but the email did not send. */
    emailSent?: boolean;
    /** delete: false when the sign-in account could not be removed afterwards. */
    deleted?: boolean;
    providerDeleted?: boolean;
  };
}

export async function sendStaffPasswordReset(
  userId: string,
  lang: "en" | "zh",
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(
    `/api/admin/staff/${encodeURIComponent(userId)}/password-reset?lang=${lang}`,
    {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok) throw await failure(response);
}
