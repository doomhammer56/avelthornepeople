import { PasswordPage } from "@/components/auth/PasswordPage";
export default async function ResetPassword({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  return <PasswordPage lang={(await searchParams).lang} />;
}
