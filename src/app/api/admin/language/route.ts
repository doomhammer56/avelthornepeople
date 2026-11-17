import { NextResponse, type NextRequest } from "next/server";
import { staffEndpoint } from "@/server/auth/middleware";
import { StaffAuthError } from "@/server/auth/errors";
import { AUTH_LANGUAGE_COOKIE } from "@/server/auth/http";

export const runtime = "nodejs";
export function POST(request: NextRequest) {
  return staffEndpoint(
    request,
    "console.read",
    async () => {
      // The preference is deliberately passed in a small, fixed-value header.
      const lang = request.headers.get("x-admin-language");
      if (lang !== "en" && lang !== "zh") throw new StaffAuthError(400);
      const response = NextResponse.json({ lang });
      const options = {
        path: "/",
        sameSite: "lax" as const,
        secure: request.nextUrl.protocol === "https:",
      };
      response.cookies.set("NEXT_LOCALE", lang, {
        ...options,
        maxAge: 31536000,
      });
      response.cookies.set(AUTH_LANGUAGE_COOKIE, lang, {
        ...options,
        httpOnly: true,
        maxAge: 1800,
      });
      return response;
    },
    { write: true },
  );
}
