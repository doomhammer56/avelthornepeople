import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { requestAuth } from "./server/adapters/auth/ssr";
import { privateHeaders } from "./server/auth/errors";
import { AUTH_LANGUAGE_COOKIE } from "./server/auth/http";
import { isDocumentNavigation } from "./server/auth/language";

// Give public pages explicit English and Chinese URLs.
// next-intl remembers language choice without accessing backend services.
const publicLocale = createMiddleware({
  locales: ["en", "zh"],
  defaultLocale: "en",
  localePrefix: "always",
});

export default async function proxy(request: NextRequest) {
  if (
    !/^\/(admin|auth|api\/admin|api\/auth)(?:\/|$)/.test(
      request.nextUrl.pathname,
    )
  )
    return publicLocale(request);
  const selected =
    isDocumentNavigation(request) &&
    /^\/admin(?:\/|$)/.test(request.nextUrl.pathname)
      ? request.nextUrl.searchParams.get("lang")
      : null;
  const language = selected === "en" || selected === "zh" ? selected : null;
  if (language) {
    request.cookies.set("NEXT_LOCALE", language);
    request.cookies.set(AUTH_LANGUAGE_COOKIE, language);
  }
  const finish = (response: NextResponse) => {
    if (language) {
      const options = {
        path: "/",
        sameSite: "lax" as const,
        secure: request.nextUrl.protocol === "https:",
      };
      response.cookies.set("NEXT_LOCALE", language, {
        ...options,
        maxAge: 31536000,
      });
      response.cookies.set(AUTH_LANGUAGE_COOKIE, language, {
        ...options,
        httpOnly: true,
        maxAge: 1800,
      });
    }
    return response;
  };
  // POST handlers own cookie writes. Proxy refresh is needed for RSC/page reads.
  if (
    request.method !== "GET" ||
    request.nextUrl.pathname.startsWith("/auth/") ||
    request.headers.has("authorization")
  )
    return finish(NextResponse.next({ request, headers: privateHeaders }));
  try {
    const auth = requestAuth(request);
    await auth.client.auth.getClaims();
    return finish(auth.finish(NextResponse.next({ request })));
  } catch {
    // The page/service will render an availability error; never authorize here.
    return finish(NextResponse.next({ request, headers: privateHeaders }));
  }
}
export const config = {
  matcher: [
    "/",
    "/en/:path*",
    "/zh/:path*",
    "/admin/:path*",
    "/auth/:path*",
    "/api/admin/:path*",
    "/api/auth/:path*",
  ],
};
