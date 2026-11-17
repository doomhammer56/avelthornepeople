import { AdminRequestError } from "./staffClient.ts";
import { adminDataChanged } from "./cacheEvents.ts";
import { adminRead } from "./queries.ts";
import type {
  ImportDecisions,
  ImportRowInput,
  ImportRowResult,
  ImportValidation,
} from "./jobImport/validate.ts";
import type {
  ImportCommitResult,
  ImportHistoryEntry,
} from "../../server/jobs/import-contract.ts";

export type ImportPreview = Pick<ImportValidation, "summary" | "canConfirm"> & {
  rows: ImportRowResult[];
};

/** The server refused the rows; `preview` is what is wrong right now. */
export class ImportRejectedError extends AdminRequestError {
  readonly preview: ImportPreview;
  constructor(preview: ImportPreview) {
    super(400);
    this.preview = preview;
  }
}

async function post<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const response = await fetcher(path, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.any([
      ...(signal ? [signal] : []),
      AbortSignal.timeout(60_000),
    ]),
  });
  if (!response.ok) {
    const data =
      response.status === 400 ? await response.json().catch(() => null) : null;
    if (data?.error === "import_invalid" && Array.isArray(data.rows))
      throw new ImportRejectedError({
        rows: data.rows,
        summary: data.summary,
        canConfirm: false,
      });
    throw new AdminRequestError(response.status);
  }
  return response.json();
}

export function previewImport(
  rows: readonly ImportRowInput[],
  decisions: ImportDecisions,
  signal?: AbortSignal,
) {
  return post<ImportPreview>(
    "/api/admin/jobs/import/preview",
    { rows, decisions },
    signal,
  );
}

export async function commitImport(
  input: {
    requestId: string;
    fileName: string;
    rows: readonly ImportRowInput[];
    decisions: ImportDecisions;
    preview: ImportPreview;
  },
  fetcher?: typeof fetch,
) {
  const overwrites: Record<string, { id: string; version: number }> = {};
  for (const row of input.preview.rows)
    if (row.action === "overwrite" && row.duplicate)
      overwrites[String(row.row)] = {
        id: row.duplicate.id,
        version: row.duplicate.version,
      };
  const result = await post<ImportCommitResult>(
    "/api/admin/jobs/import",
    {
      requestId: input.requestId,
      fileName: input.fileName,
      rows: input.rows,
      decisions: input.decisions,
      overwrites,
    },
    undefined,
    fetcher,
  );
  adminDataChanged("jobs");
  return result;
}

export const importHistoryQueryKey = ["admin", "job-imports"] as const;
export const importHistoryQueryOptions = {
  queryKey: importHistoryQueryKey,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    adminRead<{ imports: ImportHistoryEntry[] }>(
      "/api/admin/jobs/import",
      signal,
    ),
  staleTime: 15_000,
};
