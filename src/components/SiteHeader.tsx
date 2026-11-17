"use client";

import { useState, type KeyboardEvent } from "react";
import { Menu, X } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PublicIntentLink as Link } from "./PublicIntentLink";
import { BrandLockup } from "./BrandLockup";
import { candidateAccountsEnabled } from "@/lib/accountContent";
import type { HomeContent, Locale } from "@/lib/homeContent";
import { siteContainerClass } from "@/lib/publicSite";

type Props = {
  locale: Locale;
  content: Pick<HomeContent, "brand" | "nav" | "cta_jobs">;
  activePage?:
    | "home"
    | "about"
    | "services"
    | "careers"
    | "contact"
    | "account"
    | "none";
  languageQuery?: string;
  localePath?: string;
};

// Keep the shared navigation independent of page content and API data.
// Only the mobile disclosure requires client-side state.
export function SiteHeader({
  locale,
  content,
  activePage = "home",
  languageQuery = "",
  localePath,
}: Props) {
  // Track the mobile disclosure independently from the server-rendered sections.
  // Navigation closes it so the selected section remains visible on small screens.
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  // Keep company navigation and language switching on the current public page.
  // Every company destination now resolves to its own public screen.
  const home = `/${locale}`;
  const destinations = [
    home,
    `${home}/about`,
    `${home}/services`,
    `${home}/careers`,
    `${home}/contact`,
  ];
  const activeIndex = {
    home: 0,
    about: 1,
    services: 2,
    careers: 3,
    contact: 4,
    account: -1,
    none: -1,
  }[activePage];
  const languagePath = `${localePath ?? (activePage === "home" ? "" : `/${activePage}`)}${languageQuery ? `?${languageQuery}` : ""}`;

  // Share Escape handling between the toggle and its navigation panel.
  // Keyboard users can dismiss the disclosure from either focus position.
  const handleEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") closeMenu();
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-[#13261c]/10 bg-[#edf3ec]/95 backdrop-blur-md supports-backdrop-filter:bg-[#edf3ec]/90 transition-all">
      {/* Scroll Progress Indicator */}
      <div
        className="absolute bottom-0 left-0 h-[2px] w-full origin-left scale-x-0 bg-brand-teal"
        data-scroll-progress
        aria-hidden="true"
      />

      <div className={`${siteContainerClass} flex h-[72px] items-center justify-between`}>
        {/* Left: Brand Logo & Desktop Navigation with generous breathing room */}
        <div className="flex h-full items-center gap-8 md:gap-10 lg:gap-12 xl:gap-16">
          <Link
            href={`/${locale}`}
            className="inline-flex shrink-0 items-center py-2 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal/40 rounded-sm"
            aria-label={content.brand}
          >
            <BrandLockup variant="dark" priority />
          </Link>

          {/* Desktop Navigation Links */}
          <nav
            className="hidden md:flex items-center gap-1.5 lg:gap-2.5 xl:gap-3"
            aria-label={locale === "en" ? "Main navigation" : "主导航"}
          >
            {content.nav.map((label, index) => {
              const isActive = index === activeIndex;
              return (
                <Link
                  key={label}
                  href={destinations[index]}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "inline-flex items-center rounded-lg px-3.5 py-1.5 text-[15px] transition-colors duration-150 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal/40 hover:bg-muted/70 hover:text-foreground",
                    isActive
                      ? "text-foreground font-semibold"
                      : "text-muted-foreground font-medium"
                  )}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right Actions: Language Switch, CTA Button, Account Link, Hamburger */}
        <div className="flex items-center gap-3 sm:gap-4 md:gap-5">
          {/* Reload the document when changing language so its root lang updates */}
          <div
            className="hidden md:flex items-center gap-0.5 text-[13px] font-medium"
            aria-label={locale === "en" ? "Language" : "语言"}
          >
            <a
              href={`/zh${languagePath}`}
              hrefLang="zh"
              lang="zh-CN"
              aria-current={locale === "zh" ? "page" : undefined}
              className={cn(
                "rounded-md px-2 py-1 transition-colors hover:bg-muted/70 hover:text-foreground",
                locale === "zh"
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground"
              )}
            >
              中文
            </a>
            <span
              className="text-border/80 select-none px-0.5 text-xs"
              aria-hidden="true"
            >
              |
            </span>
            <a
              href={`/en${languagePath}`}
              hrefLang="en"
              lang="en"
              aria-current={locale === "en" ? "page" : undefined}
              className={cn(
                "rounded-md px-2 py-1 transition-colors hover:bg-muted/70 hover:text-foreground",
                locale === "en"
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground"
              )}
            >
              EN
            </a>
          </div>

          {/* CTA Button using customized shadcn Button */}
          <Link
            href={`${home}/careers`}
            className={cn(
              buttonVariants({ variant: "default", size: "default" }),
              "hidden sm:inline-flex rounded-lg px-5 font-medium shadow-xs"
            )}
          >
            {content.cta_jobs}
          </Link>

          {/* Candidate Accounts link if enabled */}
          {candidateAccountsEnabled && (
            <Link
              href={`${home}/login`}
              className="hidden md:inline-flex items-center text-sm font-medium text-foreground/80 hover:text-foreground hover:underline underline-offset-4"
            >
              {locale === "en" ? "Log In" : "登录"}
            </Link>
          )}

          {/* Mobile Menu Toggle Button */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden size-10 rounded-lg text-foreground hover:bg-muted/80"
            type="button"
            aria-label={
              locale === "en"
                ? menuOpen
                  ? "Close menu"
                  : "Open menu"
                : menuOpen
                  ? "关闭菜单"
                  : "打开菜单"
            }
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
            onClick={() => setMenuOpen(!menuOpen)}
            onKeyDown={handleEscape}
          >
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {menuOpen && (
        <nav
          id="mobile-navigation"
          className="md:hidden border-t border-border/80 bg-background/98 px-5 py-5 shadow-lg backdrop-blur-md"
          aria-label={locale === "en" ? "Mobile navigation" : "手机导航"}
          onKeyDown={handleEscape}
        >
          <div className="flex flex-col space-y-1.5">
            {content.nav.map((label, index) => {
              const isActive = index === activeIndex;
              return (
                <Link
                  key={label}
                  href={destinations[index]}
                  onClick={closeMenu}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex items-center rounded-lg px-3.5 py-2.5 text-base font-medium transition-colors",
                    isActive
                      ? "bg-brand-teal/10 text-brand-teal font-semibold"
                      : "text-foreground/85 hover:bg-muted/70 hover:text-foreground"
                  )}
                >
                  {label}
                </Link>
              );
            })}
          </div>

          {candidateAccountsEnabled && (
            <div className="pt-2">
              <Link
                href={`${home}/login`}
                onClick={closeMenu}
                className="flex items-center rounded-lg px-3.5 py-2.5 text-base font-medium text-foreground/80 hover:bg-muted/70 hover:text-foreground"
              >
                {locale === "en" ? "Log In" : "登录"}
              </Link>
            </div>
          )}

          {/* Mobile Language Switch */}
          <div className="pt-3 mt-1 border-t border-border/60 flex items-center justify-between px-3.5">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {locale === "en" ? "Language" : "语言"}
            </span>
            <div className="flex items-center gap-1 text-sm">
              <a
                href={`/zh${languagePath}`}
                hrefLang="zh"
                lang="zh-CN"
                aria-current={locale === "zh" ? "page" : undefined}
                className={cn(
                  "rounded-md px-2.5 py-1 transition-colors",
                  locale === "zh"
                    ? "font-semibold text-foreground bg-muted"
                    : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                )}
              >
                中文
              </a>
              <span className="text-border/80 select-none text-xs" aria-hidden="true">
                |
              </span>
              <a
                href={`/en${languagePath}`}
                hrefLang="en"
                lang="en"
                aria-current={locale === "en" ? "page" : undefined}
                className={cn(
                  "rounded-md px-2.5 py-1 transition-colors",
                  locale === "en"
                    ? "font-semibold text-foreground bg-muted"
                    : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                )}
              >
                EN
              </a>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-border/60 sm:hidden">
            <Link
              href={`${home}/careers`}
              onClick={closeMenu}
              className={cn(
                buttonVariants({ variant: "default", size: "default" }),
                "w-full justify-center rounded-lg font-medium shadow-xs"
              )}
            >
              {content.cta_jobs}
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
