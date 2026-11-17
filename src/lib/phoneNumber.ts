import {
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/max";

// One parser for candidate matching, API intake, and the browser form. Never
// guess a country for a local number or extract a number from arbitrary text.
export function parsePhoneNumber(raw: string, country?: string) {
  const input = raw.trim();
  if (
    input.length > 40 ||
    !/^\+?[\d\s().-]+$/.test(input) ||
    (country && !isSupportedCountry(country)) ||
    (!input.startsWith("+") && !country)
  )
    return undefined;
  const phone = parsePhoneNumberFromString(input, {
    defaultCountry: country as CountryCode | undefined,
    extract: false,
  });
  return phone?.isValid() && !phone.ext ? phone : undefined;
}
