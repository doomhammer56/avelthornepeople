import Link from "next/link";
import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/AuthForm";
import { authLanguage } from "@/server/auth/pages";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Confirm staff email",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function Confirm({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; lang?: string }>;
}) {
  const query = await searchParams;
  const lang = await authLanguage(query.lang);
  const valid =
    !!query.token_hash &&
    /^[a-z0-9_-]{32,256}$/i.test(query.token_hash) &&
    (query.type === "invite" || query.type === "recovery");
  return (
    <main className="mx-auto max-w-md space-y-6 px-5 py-16">
      <h1 className="text-2xl font-semibold">
        {lang === "zh" ? "验证邮件链接" : "Confirm email link"}
      </h1>
      {valid ? (
        <>
          <p>
            {lang === "zh"
              ? "请继续验证此邮件链接并设置密码。"
              : "Continue to verify this email link and choose your password."}
          </p>
          <AuthForm intent="confirm" lang={lang} />
        </>
      ) : (
        <>
          <p>
            {lang === "zh"
              ? "此链接无效或已过期。"
              : "This link is invalid or expired."}
          </p>
          <Link prefetch={false} href={`/admin/forgot-password?lang=${lang}`}>
            {lang === "zh" ? "获取新的链接" : "Request a new link"}
          </Link>
        </>
      )}
    </main>
  );
}
