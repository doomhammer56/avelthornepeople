import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { AUTH_LANGUAGE_COOKIE } from "../server/auth/http.ts";

// Resolve a supported locale from the public route.
// Content lives separately so future API data can replace local fixtures.
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const jar = requested === "en" || requested === "zh" ? null : await cookies();
  const fallback =
    jar?.get(AUTH_LANGUAGE_COOKIE)?.value ?? jar?.get("NEXT_LOCALE")?.value;
  const locale =
    requested === "en" || requested === "zh"
      ? requested
      : fallback === "zh"
        ? "zh"
        : "en";
  return { locale, messages: {} };
});
