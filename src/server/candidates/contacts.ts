import "server-only";
import { z } from "zod";
import { parsePhoneNumber } from "../../lib/phoneNumber.ts";

export function normalizeEmail(raw: string) {
  return z.email().max(254).parse(raw.trim().toLowerCase());
}
export function normalizePhone(raw: string, region?: string) {
  const phone = parsePhoneNumber(raw, region);
  if (!phone) throw new Error("Invalid phone");
  return phone.number.toString();
}
