import { PasswordPage } from "@/components/auth/PasswordPage";
export default async function SetupPassword({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  return <PasswordPage lang={(await searchParams).lang} />;
}
