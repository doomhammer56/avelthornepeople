import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { componentAuth } from "../adapters/auth/ssr.ts";
import { cookieIdentity } from "./identity.ts";
import { requireStaff } from "./staff.ts";
import { AUTH_LANGUAGE_COOKIE } from "./http.ts";

export const currentStaffIdentity = cache(async () =>
  cookieIdentity(await componentAuth()),
);
export const currentStaff = cache(async () =>
  requireStaff(await currentStaffIdentity()),
);
export async function authLanguage(value?: string) {
  const jar = await cookies();
  return value === "zh" ||
    (!value &&
      (jar.get(AUTH_LANGUAGE_COOKIE)?.value ??
        jar.get("NEXT_LOCALE")?.value) === "zh")
    ? ("zh" as const)
    : ("en" as const);
}
