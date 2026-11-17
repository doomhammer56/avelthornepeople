import { AuthForm } from "@/components/auth/AuthForm";
import { authLanguage } from "@/server/auth/pages";

export default async function ForgotPassword({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const lang = await authLanguage((await searchParams).lang);
  return (
    <>
      <h1 className="text-2xl font-semibold">
        {lang === "zh" ? "重置密码" : "Reset your password"}
      </h1>
      <p className="text-sm">
        {lang === "zh"
          ? "请输入员工账号的邮箱，我们将发送密码重置链接。"
          : "Enter the email address you use for staff sign-in to request a password reset link."}
      </p>
      <AuthForm
        intent="recover"
        lang={lang}
        siteKey={process.env.AUTH_TURNSTILE_SITE_KEY}
      />
    </>
  );
}
