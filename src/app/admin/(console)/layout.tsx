import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentStaff, authLanguage } from "@/server/auth/pages";
import { StaffAuthError } from "@/server/auth/errors";
import { AdminShell } from "@/components/admin/AdminShell";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AdminQueryProvider } from "@/components/admin/AdminQueryProvider";
import { AdminNavigationProvider } from "@/components/admin/AdminNavigation";
import { AdminContextProvider } from "@/components/admin/AdminContext";
import "../admin.css";

type Props = { children: React.ReactNode };

// Gate the shell behind a valid staff session. Each data service independently
// checks live admission and its own allowed roles on the protected transaction.
// Layouts can't read searchParams, so the shell's language comes from the
// NEXT_LOCALE cookie only; pages still honor an explicit ?lang= themselves.
export default async function ConsoleLayout({ children }: Props) {
  let staff;
  try {
    staff = await currentStaff();
  } catch (error) {
    if (error instanceof StaffAuthError && error.status === 401)
      redirect("/admin/login");
    if (error instanceof StaffAuthError && error.status === 403)
      redirect("/admin/denied");
    // A connectivity failure, not an auth decision: keep this retryable
    // rather than crashing into Next's generic error boundary.
    return (
      <main className="flex min-h-screen items-center justify-center p-6 text-center">
        <p>Console temporarily unavailable. Please try again shortly.</p>
      </main>
    );
  }
  const lang = await authLanguage();
  // shadcn's Sidebar writes this cookie itself on toggle; reading it here
  // lets the first server render already match the visitor's last choice.
  const sidebarDefaultOpen =
    (await cookies()).get("sidebar_state")?.value !== "false";
  return (
    <AdminQueryProvider
      key={`${staff.id}:${staff.role}`}
      staff={staff}
      lang={lang}
    >
      <AdminContextProvider lang={lang} role={staff.role}>
        <AdminNavigationProvider role={staff.role}>
          <TooltipProvider delay={200}>
            <AdminShell
              staff={staff}
              lang={lang}
              sidebarDefaultOpen={sidebarDefaultOpen}
            >
              {children}
              <Toaster />
            </AdminShell>
          </TooltipProvider>
        </AdminNavigationProvider>
      </AdminContextProvider>
    </AdminQueryProvider>
  );
}
