import { AuthForm } from "@/components/auth/AuthForm";
import { authLanguage, currentStaff } from "@/server/auth/pages";
import { safeConsolePath, staffConsolePath } from "@/server/auth/http";
import { StaffAuthError } from "@/server/auth/errors";
import { redirect } from "next/navigation";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string; next?: string; updated?: string }>;
}) {
  const query = await searchParams;
  const lang = await authLanguage(query.lang);
  let staff;
  let sessionUnavailable = false;
  try {
    staff = await currentStaff();
  } catch (error) {
    if (
      !(error instanceof StaffAuthError) ||
      ![401, 403, 503].includes(error.status)
    )
      throw error;
    sessionUnavailable = error.status === 503;
  }
  // A provider cookie alone is insufficient: currentStaff also checks active
  // membership, live admission and revocation. Keep redirect outside the catch.
  if (staff) redirect(staffConsolePath(query.next, staff.role, lang));
  return (
    <>
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">
          {lang === "zh" ? "登录" : "Sign in"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {lang === "zh"
            ? "登录员工工作台。"
            : "Sign in to your staff workspace."}
        </p>
      </div>
      {sessionUnavailable ? (
        <p role="alert">
          {lang === "zh"
            ? "暂时无法验证您的会话，请稍后重试。"
            : "We could not verify your session. Please try again shortly."}
        </p>
      ) : null}
      {query.updated === "1" ? (
        <p role="status">
          {lang === "zh"
            ? "密码已更新，请重新登录。如果登录暂时被锁定，请等待锁定时间结束。"
            : "Your password has been updated. Sign in again. If sign-in is temporarily locked, wait until the lock expires."}
        </p>
      ) : null}
      <AuthForm
        intent="login"
        lang={lang}
        next={safeConsolePath(query.next)}
        siteKey={process.env.AUTH_TURNSTILE_SITE_KEY}
      />
    </>
  );
}
