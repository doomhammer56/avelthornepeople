import "server-only";
import { currentStaffIdentity } from "../../server/auth/pages.ts";
import { readContent } from "../../server/content/service.ts";
import type { ManagedContentBlock } from "../content/contract.ts";
export type ContentBlockId = string;

export type AdminContentBlock = ManagedContentBlock;

export async function getAdminContentBlocks() {
  return readContent(await currentStaffIdentity());
}
