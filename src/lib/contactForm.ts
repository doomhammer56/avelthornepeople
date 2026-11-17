import { z } from "zod";
import type { ContactContent } from "./contactContent";
import type { Locale } from "./homeContent";

// Validate only the public contact fields with translated, predictable messages.
// Company remains optional; whitespace-only names and messages cannot be submitted.
export function createContactSchema(messages: ContactContent["validation"]) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, messages.required)
      .max(120, messages.nameLength),
    company: z.string().trim().max(160, messages.companyLength),
    email: z
      .string()
      .trim()
      .min(1, messages.required)
      .pipe(z.email(messages.email).max(254, messages.email)),
    message: z
      .string()
      .trim()
      .min(1, messages.required)
      .max(5000, messages.messageLength),
  });
}

export type ContactValues = z.infer<ReturnType<typeof createContactSchema>>;

// Send a minimal contact DTO only to the explicitly configured public endpoint.
// No form values are stored, logged, placed in URLs, or copied into analytics.
export async function sendContactMessage(
  endpoint: string,
  values: ContactValues,
  locale: Locale,
  signal: AbortSignal,
) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "omit",
    cache: "no-store",
    body: JSON.stringify({ ...values, locale }),
    signal,
  });
  if (!response.ok) throw new Error("Contact submission unavailable");
  const acknowledgement = z
    .object({ accepted: z.literal(true) })
    .safeParse(await response.json());
  if (!acknowledgement.success)
    throw new Error("Contact acknowledgement missing");
}
