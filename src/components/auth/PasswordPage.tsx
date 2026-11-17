import { cookies } from "next/headers";
import Link from "next/link";
import { AuthForm } from "./AuthForm";
import { PASSWORD_COOKIE, passwordGrantIsValid } from "@/server/auth/password";
import { authLanguage } from "@/server/auth/pages";
import { componentAuth } from "@/server/adapters/auth/ssr";
import { cookieIdentity } from "@/server/auth/identity";
import { StaffAuthError } from "@/server/auth/errors";

export async function PasswordPage({ lang: requested }: { lang?: string }) {
  const lang = await authLanguage(requested);
  const grant = (await cookies()).get(PASSWORD_COOKIE)?.value;
  let valid = false;
  try {
    if (grant)
      valid = await passwordGrantIsValid(
        await cookieIdentity(await componentAuth()),
        grant,
      );
  } catch (error) {
    if (!(error instanceof StaffAuthError) || error.status === 503)
      return (
        <p role="alert">
          {lang === "zh"
            ? "暂时无法验证此链接，请稍后刷新页面。"
            : "We cannot verify this link right now. Please reload shortly."}
        </p>
      );
  }
  if (!valid)
    return (
      <>
        <p>
          {lang === "zh"
            ? "请通过有效的邀请或密码重置邮件打开此页面。"
            : "Open a valid invitation or recovery email to set your password."}
        </p>
        <Link prefetch={false} href={`/admin/forgot-password?lang=${lang}`}>
          {lang === "zh" ? "获取新的链接" : "Request a new link"}
        </Link>
      </>
    );
  return (
    <>
      <h1 className="text-2xl font-semibold">
        {lang === "zh" ? "设置密码" : "Set your password"}
      </h1>
      <p className="text-sm">
        {lang === "zh"
          ? "请使用至少 12 个字符的新密码。保存后，您需要重新登录。"
          : "Choose a new password with at least 12 characters. After saving, sign in again with your new password."}
      </p>
      <AuthForm intent="password" lang={lang} />
    </>
  );
}
