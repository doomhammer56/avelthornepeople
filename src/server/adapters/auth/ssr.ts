import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authConfig, authFetch, appOrigin } from "./config.ts";
import { privateHeaders } from "../../auth/errors.ts";

export function requestAuth(request: NextRequest, isolated = false) {
  const { url, key } = authConfig();
  const pending = new Map<
    string,
    { name: string; value: string; options: CookieOptions }
  >();
  const extra = new Headers(privateHeaders);
  const client = createServerClient(url, key, {
    // This console uses server Auth endpoints, not a browser Supabase client.
    cookieOptions: {
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: appOrigin().startsWith("https:"),
    },
    global: { fetch: authFetch },
    cookies: {
      getAll: () =>
        isolated ? [...pending.values()] : request.cookies.getAll(),
      setAll(values, headers) {
        for (const item of values) {
          request.cookies.set(item.name, item.value);
          pending.set(item.name, item);
        }
        for (const [name, value] of Object.entries(headers))
          extra.set(name, value);
      },
    },
  });
  return {
    client,
    clearSessionCookies() {
      const base = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
      for (const { name } of request.cookies.getAll()) {
        if (
          name === base ||
          name.startsWith(base + ".") ||
          name === base + "-code-verifier"
        )
          pending.set(name, {
            name,
            value: "",
            options: {
              path: "/",
              maxAge: 0,
              httpOnly: true,
              sameSite: "lax",
              secure: appOrigin().startsWith("https:"),
            },
          });
      }
    },
    finish(response: NextResponse) {
      for (const item of pending.values())
        response.cookies.set(item.name, item.value, item.options);
      extra.forEach((value, name) => response.headers.set(name, value));
      return response;
    },
  };
}

export async function componentAuth() {
  const { url, key } = authConfig();
  const jar = await cookies();
  // Proxy owns refresh writes; Server Components are read-only cookie consumers.
  return createServerClient(url, key, {
    global: { fetch: authFetch },
    cookies: { getAll: () => jar.getAll() },
  });
}
