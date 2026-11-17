import { z } from "zod";
import parsePhoneNumber, {
  isSupportedCountry,
  type CountryCode,
} from "libphonenumber-js/max";

export type ContactSearch = { email: string; phone: string; region: string };

// Wait for complete contact values before issuing an exact-match search.
// Validation remains local and the resulting values are sent only in the existing POST body.
export function completeContactFilters(contact: ContactSearch) {
  const email = contact.email.trim();
  const phone = contact.phone.trim();
  const region = contact.region.trim().toUpperCase();
  if (email && !z.email().max(254).safeParse(email).success) return null;
  if (region && !isSupportedCountry(region)) return null;
  if (phone) {
    if (phone.length > 40 || !/^\+?[\d\s().-]+$/.test(phone)) return null;
    if (!phone.startsWith("+") && !region) return null;
    const parsed = parsePhoneNumber(phone, {
      defaultCountry: (region as CountryCode) || undefined,
      extract: false,
    });
    if (!parsed?.isValid() || parsed.ext) return null;
  }
  return {
    email: email || undefined,
    phone: phone || undefined,
    region: region || undefined,
  };
}
