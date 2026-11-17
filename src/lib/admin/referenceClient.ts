import { z } from "zod";
import { AdminRequestError } from "./staffClient.ts";
import { adminDataChanged } from "./cacheEvents.ts";
import type { ReferenceCommand } from "../../server/settings/contract.ts";

export async function sendReferenceCommand(command: ReferenceCommand) {
  const response = await fetch("/api/admin/settings", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new AdminRequestError(response.status);
  const result = z
    .object({
      item: z.object({ id: z.uuid(), version: z.number().int().positive() }),
    })
    .parse(await response.json());
  if (result.item.id !== command.id) throw new AdminRequestError(503);
  adminDataChanged("settings");
  return result;
}
