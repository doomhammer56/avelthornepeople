import type { Metadata } from "next";
import { Host_Grotesk } from "next/font/google";
import { getLocale } from "next-intl/server";
import { getSiteUrl } from "@/lib/siteUrl";
import "@fontsource-variable/noto-sans-sc";
import "./globals.css";

// Site face: Host Grotesk — used for body, headings, and UI across the public site.
const hostGrotesk = Host_Grotesk({
  variable: "--font-host-grotesk",
  subsets: ["latin"],
  display: "swap",
});

// Resolve every relative URL (canonical, OG, sitemap) against the real origin.
// Pages already append "| Avelthorne People Group" themselves, so no title template here.
export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  title: "Avelthorne People Group",
  description:
    "Customer operations, risk & compliance, and technology services.",
  robots: { index: true, follow: true },
  icons: {
    icon: [
      { url: "/brand/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/icon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/brand/icon-180.png", sizes: "180x180", type: "image/png" }],
  },
};

// Render the document language before hydration for both public locales.
// Screen readers can then interpret translated content correctly.
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  return (
    <html
      lang={locale === "zh" ? "zh-CN" : "en"}
      className={`${hostGrotesk.variable} antialiased`}
    >
      <body>
        {children}
      </body>
    </html>
  );
}
