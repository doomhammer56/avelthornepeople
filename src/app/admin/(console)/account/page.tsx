import type { Metadata } from "next";
import { AccountBoard } from "@/components/admin/AccountBoard";
import { componentAuth } from "@/server/adapters/auth/ssr";
import { authLanguage, currentStaff } from "@/server/auth/pages";

export const metadata: Metadata = { title: "My account | Staff console" };

type Props = { searchParams: Promise<{ lang?: string }> };

// Open to every active role: it only ever edits the signed-in member's own
// name and password. Role and access changes remain in Accounts & Roles.
export default async function AccountPage({ searchParams }: Props) {
  const lang = await authLanguage((await searchParams).lang);
  const staff = await currentStaff();
  // The sign-in email lives with the identity provider, not the staff profile.
  const email = await componentAuth()
    .then((client) => client.auth.getUser())
    .then(({ data }) => data.user?.email ?? "")
    .catch(() => "");
  return (
    <AccountBoard
      lang={lang}
      displayName={staff.displayName}
      email={email}
      role={staff.role}
      siteKey={process.env.AUTH_TURNSTILE_SITE_KEY ?? ""}
    />
  );
}
