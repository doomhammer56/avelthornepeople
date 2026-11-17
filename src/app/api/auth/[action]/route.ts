import { NextRequest, NextResponse } from "next/server";
import { requestAuth } from "@/server/adapters/auth/ssr";
import {
  appOrigin,
  requireCaptchaConfiguration,
} from "@/server/adapters/auth/config";
import {
  StaffAuthError,
  authErrorResponse,
  privateHeaders,
} from "@/server/auth/errors";
import {
  assertSameOrigin,
  readAuthBody,
  safeConsolePath,
  authLang,
  AUTH_LANGUAGE_COOKIE,
} from "@/server/auth/http";
import { cookieIdentity } from "@/server/auth/identity";
import { loginStaff } from "@/server/auth/login";
import { limitAuthAttempt } from "@/server/auth/limiter";
import {
  createPasswordGrant,
  updatePassword,
  PASSWORD_COOKIE,
} from "@/server/auth/password";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ action: string }> },
) {
  let auth: ReturnType<typeof requestAuth> | undefined;
  let discardPasswordGrant = false;
  try {
    assertSameOrigin(request);
    const { action } = await context.params;
    if (!["login", "recover", "logout", "confirm", "password"].includes(action))
      throw new StaffAuthError(400);
    const body = await readAuthBody(request);
    auth = requestAuth(request, action === "login" || action === "confirm");
    const lang = authLang(body.lang);
    let destination = "/admin";
    if (action === "login" || action === "recover") {
      requireCaptchaConfiguration();
      const email =
        typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
        throw new StaffAuthError(400);
      await limitAuthAttempt(request, action === "recover" ? email : undefined);
      const captchaToken =
        typeof body.captchaToken === "string" ? body.captchaToken : "";
      if (!captchaToken || captchaToken.length > 4096)
        throw new StaffAuthError(400, "captcha_failed");
      if (action === "recover") {
        const result = await auth.client.auth.resetPasswordForEmail(email, {
          captchaToken,
          redirectTo: `${appOrigin()}/auth/confirm`,
        });
        if (result.error?.code === "captcha_failed")
          throw new StaffAuthError(400, "captcha_failed");
        if (
          result.error &&
          (!result.error.status ||
            result.error.status >= 500 ||
            result.error.status === 429)
        )
          throw new StaffAuthError(
            result.error.status === 429 ? 429 : 503,
            result.error.status === 429 ? "provider_limited" : undefined,
          );
        // Same result for unknown accounts and valid requests.
        const response = NextResponse.json(
          { sent: true },
          { headers: privateHeaders },
        );
        response.cookies.set(AUTH_LANGUAGE_COOKIE, lang, {
          path: "/",
          httpOnly: true,
          sameSite: "lax",
          secure: appOrigin().startsWith("https:"),
          maxAge: 1800,
        });
        return auth.finish(response);
      }
      const password = typeof body.password === "string" ? body.password : "";
      if (password.length < 8 || password.length > 256)
        throw new StaffAuthError(400);
      await loginStaff(auth.client, { email, password, captchaToken }, () =>
        auth!.clearSessionCookies(),
      );
      destination = safeConsolePath(
        typeof body.next === "string" ? body.next : null,
      );
    } else if (action === "logout") {
      const result = await auth.client.auth.signOut({ scope: "local" });
      auth.clearSessionCookies();
      if (result.error && (!result.error.status || result.error.status >= 500))
        throw new StaffAuthError(503);
      const response = NextResponse.json({ next: `/admin/login?lang=${lang}` });
      response.cookies.set(PASSWORD_COOKIE, "", {
        path: "/",
        maxAge: 0,
        httpOnly: true,
      });
      return auth.finish(response);
    } else if (action === "confirm") {
      discardPasswordGrant = true;
      if (
        !["invite", "recovery"].includes(String(body.type)) ||
        typeof body.token_hash !== "string" ||
        !/^[a-z0-9_-]{32,256}$/i.test(body.token_hash)
      )
        throw new StaffAuthError(400, "email_link_invalid");
      const result = await auth.client.auth.verifyOtp({
        token_hash: body.token_hash,
        type: body.type as "invite" | "recovery",
      });
      if (result.error)
        throw new StaffAuthError(
          !result.error.status || result.error.status >= 500 ? 503 : 401,
          !result.error.status || result.error.status >= 500
            ? undefined
            : "email_link_invalid",
        );
      let grant: string;
      try {
        grant = await createPasswordGrant(await cookieIdentity(auth.client));
      } catch (error) {
        await auth.client.auth.signOut({ scope: "local" }).catch(() => {});
        auth.clearSessionCookies();
        throw error;
      }
      const response = NextResponse.json({
        next:
          body.type === "invite"
            ? `/admin/setup-password?lang=${lang}`
            : `/admin/reset-password?lang=${lang}`,
      });
      response.cookies.set(PASSWORD_COOKIE, grant, {
        httpOnly: true,
        secure: appOrigin().startsWith("https:"),
        sameSite: "strict",
        path: "/",
        maxAge: 600,
      });
      return auth.finish(response);
    } else {
      try {
        const identity = await cookieIdentity(auth.client);
        await updatePassword(
          auth.client,
          identity,
          request.cookies.get(PASSWORD_COOKIE)?.value,
          typeof body.password === "string" ? body.password : "",
          () => auth!.clearSessionCookies(),
        );
      } catch (error) {
        discardPasswordGrant = !(
          error instanceof StaffAuthError &&
          ["password_weak", "password_reused", "provider_limited"].includes(
            error.code ?? "",
          )
        );
        if (
          error instanceof StaffAuthError &&
          [401, 403].includes(error.status)
        )
          throw new StaffAuthError(error.status, "email_link_invalid");
        throw error;
      }
      const response = NextResponse.json({
        next: `/admin/login?updated=1&lang=${lang}`,
      });
      response.cookies.set(PASSWORD_COOKIE, "", {
        path: "/",
        maxAge: 0,
        httpOnly: true,
      });
      return auth.finish(response);
    }
    return auth.finish(NextResponse.json({ next: destination }));
  } catch (error) {
    const response = authErrorResponse(error);
    if (auth) {
      const result = new NextResponse(response.body, {
        status: response.status,
        headers: response.headers,
      });
      if (discardPasswordGrant)
        result.cookies.set(PASSWORD_COOKIE, "", {
          path: "/",
          maxAge: 0,
          httpOnly: true,
        });
      return auth.finish(result);
    }
    return response;
  }
}
