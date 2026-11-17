import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Staff console",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// Shared metadata only; (auth) and (console) each render their own chrome
// below, since a narrow sign-in card and the full console shell don't mix.
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
