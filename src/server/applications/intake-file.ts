import { createHash } from "node:crypto";

// Basic byte/type validation only. This deliberately makes no malware verdict.
export function validateCvBytes(
  bytes: Buffer,
  type: string,
  expectedSize: number,
) {
  if (
    bytes.length !== expectedSize ||
    bytes.length < 1 ||
    bytes.length > 10_000_000
  )
    throw new Error("Invalid CV");
  const pdf =
    type === "application/pdf" &&
    bytes.subarray(0, 5).equals(Buffer.from("%PDF-")) &&
    bytes
      .subarray(Math.max(0, bytes.length - 4096))
      .includes(Buffer.from("%%EOF"));
  const doc =
    type === "application/msword" &&
    bytes.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex")) &&
    bytes.includes(Buffer.from("WordDocument", "utf16le"));
  if (!pdf && !doc) throw new Error("Invalid CV");
  return createHash("sha256").update(bytes).digest();
}
