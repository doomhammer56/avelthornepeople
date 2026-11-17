import { getCountries, getCountryCallingCode } from "libphonenumber-js/max";
import type { Locale } from "./homeContent.ts";

/**
 * ISO 3166-1 alpha-2 codes for European states we accept for job applications,
 * plus fixed allowlist entries (Philippines, Taiwan). Used to scope the phone
 * country dropdown without exposing the full global list.
 */
const EUROPEAN_COUNTRY_CODES = new Set<string>([
  "AD",
  "AL",
  "AT",
  "AX",
  "BA",
  "BE",
  "BG",
  "BY",
  "CH",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FO",
  "FR",
  "GB",
  "GG",
  "GI",
  "GR",
  "HR",
  "HU",
  "IE",
  "IM",
  "IS",
  "IT",
  "JE",
  "LI",
  "LT",
  "LU",
  "LV",
  "MC",
  "MD",
  "ME",
  "MK",
  "MT",
  "NL",
  "NO",
  "PL",
  "PT",
  "RO",
  "RS",
  "RU",
  "SE",
  "SI",
  "SJ",
  "SK",
  "SM",
  "UA",
  "VA",
  "XK",
]);

const EXTRA_ALLOWLIST = new Set<string>(["PH", "TW"]);

export function isApplicationPhoneCountry(code: string): boolean {
  if (!code) return false;
  return EUROPEAN_COUNTRY_CODES.has(code) || EXTRA_ALLOWLIST.has(code);
}

export type ApplicationPhoneCountryOption = {
  country: string;
  name: string;
  code: string;
};

/**
 * Labels and calling codes for the application form’s country select only.
 */
export function getApplicationPhoneCountryOptions(
  locale: Locale,
): ApplicationPhoneCountryOption[] {
  const names = new Intl.DisplayNames([locale], { type: "region" });
  return getCountries()
    .filter((c) => isApplicationPhoneCountry(c))
    .map((country) => ({
      country,
      name: names.of(country) ?? country,
      code: getCountryCallingCode(country),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}
