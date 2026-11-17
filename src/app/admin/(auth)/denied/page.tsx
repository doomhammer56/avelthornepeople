import { AuthForm } from "@/components/auth/AuthForm";
import { authLanguage } from "@/server/auth/pages";
export default async function Denied() {
  const lang = await authLanguage();
  return (
    <>
      <h1 className="text-2xl font-semibold">
        {lang === "zh" ? "访问被拒绝" : "Access denied"}
      </h1>
      <p>
        {lang === "zh"
          ? "此账号没有控制台访问权限，请联系管理员。"
          : "This account does not have console access. Contact your administrator."}
      </p>
      <AuthForm intent="logout" lang={lang} />
    </>
  );
}
