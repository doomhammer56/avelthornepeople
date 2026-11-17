import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import { z } from "zod";
import { normalizeEmail, normalizePhone } from "./contacts.ts";

export class ProfileUnavailable extends Error {
  constructor() {
    super("Candidate profile unavailable");
  }
}
export const profileSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().pipe(z.email().max(254)),
    phone: z.string().min(1).max(40),
    phoneRegion: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
  })
  .strict();
export type CandidateProfile = z.infer<typeof profileSchema>;
function keys(kind: "ENCRYPTION" | "MATCH"): Map<number, Buffer> {
  try {
    const raw = JSON.parse(process.env[`CANDIDATE_${kind}_KEYS`] ?? "{}");
    const result = new Map<number, Buffer>();
    if (!raw || Array.isArray(raw) || typeof raw !== "object")
      throw new Error();
    for (const [version, value] of Object.entries(raw)) {
      if (
        !/^[1-9]\d{0,5}$/.test(version) ||
        typeof value !== "string" ||
        !/^[A-Za-z0-9+/]{43}=$/.test(value)
      )
        throw new Error();
      const key = Buffer.from(value, "base64");
      if (key.length !== 32) throw new Error();
      result.set(Number(version), key);
    }
    if (!result.size || result.size > 5) throw new Error();
    return result;
  } catch {
    throw new ProfileUnavailable();
  }
}
export function encryptProfileValue(value: unknown, context: string): Buffer {
  const version = Number(process.env.CANDIDATE_ACTIVE_KEY_VERSION),
    key = keys("ENCRYPTION").get(version);
  if (!key) throw new ProfileUnavailable();
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`portal-profile:v1:${context}`));
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.from(
    JSON.stringify({
      v: 1,
      k: version,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: data.toString("base64"),
    }),
  );
}
export function decryptProfileValue(value: unknown, context: string): unknown {
  try {
    if (!Buffer.isBuffer(value) || value.length > 30000) throw new Error();
    const e = z
      .object({
        v: z.literal(1),
        k: z.number().int().positive(),
        iv: z.string(),
        tag: z.string(),
        data: z.string(),
      })
      .strict()
      .parse(JSON.parse(value.toString("utf8")));
    const key = keys("ENCRYPTION").get(e.k),
      iv = Buffer.from(e.iv, "base64"),
      tag = Buffer.from(e.tag, "base64");
    if (!key || iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(`portal-profile:v1:${context}`));
    decipher.setAuthTag(tag);
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(e.data, "base64")),
        decipher.final(),
      ]).toString("utf8"),
    );
  } catch {
    throw new ProfileUnavailable();
  }
}
export function candidateProfile(
  row: Record<string, unknown>,
): CandidateProfile | null {
  try {
    return profileSchema.parse(
      Object.fromEntries(
        ["name", "email", "phone"].map((field) => [
          field,
          decryptProfileValue(
            row[`${field}_encrypted`],
            `candidate:${row.id}:${field}`,
          ),
        ]),
      ),
    );
  } catch {
    return null;
  }
}
export function contactKeys(email?: string, phone?: string, region?: string) {
  const normalized = {
    email: email ? normalizeEmail(email) : null,
    phone: phone ? normalizePhone(phone, region) : null,
  };
  return [...keys("MATCH")].flatMap(([version, key]) =>
    (["email", "phone"] as const).flatMap((field) =>
      normalized[field]
        ? [
            {
              version,
              field,
              hash: createHmac("sha256", key)
                .update(`portal-contact:v1:${field}:`)
                .update(normalized[field]!)
                .digest("hex"),
            },
          ]
        : [],
    ),
  );
}
// Shared by synthetic fixtures and future intake; contacts are stored in their
// canonical form so matching does not depend on a browser's country settings.
export function encryptedCandidate(id: string, value: CandidateProfile) {
  const profile = profileSchema.parse(value),
    email = normalizeEmail(profile.email),
    phone = normalizePhone(profile.phone, profile.phoneRegion);
  const version = Number(process.env.CANDIDATE_ACTIVE_KEY_VERSION),
    lookups = contactKeys(email, phone).filter((k) => k.version === version);
  if (lookups.length !== 2) throw new ProfileUnavailable();
  return {
    nameEncrypted: encryptProfileValue(profile.name, `candidate:${id}:name`),
    emailEncrypted: encryptProfileValue(email, `candidate:${id}:email`),
    phoneEncrypted: encryptProfileValue(phone, `candidate:${id}:phone`),
    emailHmac: Buffer.from(
      lookups.find((k) => k.field === "email")!.hash,
      "hex",
    ),
    phoneHmac: Buffer.from(
      lookups.find((k) => k.field === "phone")!.hash,
      "hex",
    ),
    hmacKeyVersion: version,
  };
}
