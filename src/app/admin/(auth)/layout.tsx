// The narrow sign-in card shared by login, recovery and password screens.
// Moved out of admin/layout.tsx so the console shell can use its own chrome.
export default function AdminAuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="grid min-h-svh place-items-center bg-background px-4 py-8 text-foreground">
      <div className="w-full max-w-md space-y-6 rounded-[10px] border bg-card p-5 shadow-[0_12px_48px_-16px_rgba(51,54,61,0.18)] sm:p-8">
        {children}
      </div>
    </main>
  );
}
