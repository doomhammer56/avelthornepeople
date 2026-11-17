"use client";

import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import {
  AdminLink as Link,
  useAdminRouter as useRouter,
} from "./AdminNavigation";
import { NewApplicationsBadge } from "./NewApplicationsBadge";
import { toast } from "sonner";
import {
  useEffect,
  useOptimistic,
  useSyncExternalStore,
  useTransition,
} from "react";
import {
  ExternalLink,
  FileText,
  History,
  Languages,
  LayoutGrid,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  Users,
  Briefcase,
  LoaderCircle,
  type LucideIcon,
} from "lucide-react";
import type { Staff } from "@/server/auth/staff";
import {
  visibleNavGroups,
  roleLabel,
  pageTitle,
  adminLanguageHref,
  type AdminLang,
  type NavIcon,
} from "@/lib/admin/nav";
import { darkModePreference } from "@/lib/admin/localPreferenceStore";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { AdminLogoutButton } from "./AdminLogoutButton";
import { AdminSessionGate } from "./AdminSessionGate";

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutGrid,
  jobs: Briefcase,
  applications: Users,
  content: FileText,
  log: History,
  accounts: ShieldCheck,
  settings: Settings,
};

const text = {
  en: { viewSite: "View public site" },
  zh: { viewSite: "查看公开官网" },
};

type Props = {
  staff: Staff;
  lang: AdminLang;
  /** Whether the sidebar should render expanded on first paint (read from the shadcn-managed cookie server-side). */
  sidebarDefaultOpen: boolean;
  children: React.ReactNode;
};

// Wrap every console screen in the sidebar/topbar chrome from the handoff.
// The sidebar itself is shadcn/ui's official Sidebar component (see
// src/components/ui/sidebar.tsx); only its contents are specific to this app.
export function AdminShell({
  staff,
  lang: initialLang,
  sidebarDefaultOpen,
  children,
}: Props) {
  const pathname = usePathname();
  // Read the active URL because shared layouts persist during client navigation.
  // Optimistic labels respond immediately while the translated page is loading.
  const queryLang = useSearchParams().get("lang");
  const resolvedLang =
    queryLang === "en" || queryLang === "zh" ? queryLang : initialLang;
  const [lang, setLanguage] = useOptimistic(resolvedLang);
  const router = useRouter();
  const [switchingLanguage, startLanguageTransition] = useTransition();
  // Let the visual editor use the full workspace without the standard page topbar.
  // Sidebar controls stay in the navigation while other console pages keep their layout.
  const contentEditor = pathname === "/admin/content";
  // Reads the persisted preference without an effect+setState pair, so the
  // first client render can't cascade into a second one for this value.
  const dark = useSyncExternalStore(
    darkModePreference.subscribe,
    darkModePreference.getSnapshot,
    darkModePreference.getServerSnapshot,
  );
  const t = text[lang];

  // Portalled menus, dialogs and tooltips render under <body>, outside this
  // shell. Mirror the theme there so they use the console palette and dark mode.
  useEffect(() => {
    document.body.dataset.adminTheme = dark ? "dark" : "light";
    return () => {
      delete document.body.dataset.adminTheme;
    };
  }, [dark]);

  const groups = visibleNavGroups(staff.role);
  const otherLang = lang === "en" ? "zh" : "en";
  const langQuery = `?lang=${lang}`;

  // Preserve the mounted shell and its theme while loading the other language.
  // The URL keeps page translations aligned without reloading the whole document.
  function switchLanguage() {
    startLanguageTransition(async () => {
      setLanguage(otherLang);
      try {
        const response = await fetch("/api/admin/language", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "x-admin-language": otherLang },
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) throw new Error("Language preference unavailable");
      } catch {
        toast.error(
          resolvedLang === "zh"
            ? "无法切换语言，请重试。"
            : "Could not switch language. Please retry.",
        );
        return;
      }
      startLanguageTransition(() => {
        router.replace(adminLanguageHref(window.location.href, otherLang), {
          scroll: false,
        });
      });
    });
  }

  return (
    <div className="admin-shell" data-admin-theme={dark ? "dark" : "light"}>
      <SidebarProvider defaultOpen={sidebarDefaultOpen}>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            {/* Keep collapse and expand controls inside the desktop sidebar.
                Stacking the control in icon mode leaves it reachable after collapse. */}
            <div className="flex items-center gap-2.5 px-1 py-1 group-data-[collapsible=icon]:flex-col">
              <span
                className="flex size-8 flex-none items-center justify-center rounded-md bg-[#edf3ec]"
                aria-hidden="true"
              >
                <Image
                  src="/brand/logo-symbol.webp"
                  alt=""
                  width={1536}
                  height={1550}
                  className="h-6 w-auto"
                />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5 overflow-hidden group-data-[collapsible=icon]:hidden">
                <strong className="text-[15px] leading-none font-bold whitespace-nowrap">
                  AVELTHORNE
                </strong>
                <span className="text-[11px] whitespace-nowrap text-muted-foreground">
                  {lang === "zh" ? "招聘管理后台" : "Staff Console"}
                </span>
              </span>
              <SidebarTrigger className="ml-auto shrink-0 group-data-[collapsible=icon]:mx-auto" />
            </div>
          </SidebarHeader>

          {/* Keep navigation labels out of the sidebar and space all links equally.
              Permission-filtered groups retain the same gap as links within a group. */}
          <SidebarContent className="gap-2.5 py-3">
            {groups.map((group) => (
              <SidebarGroup key={group.key} className="gap-2 py-0">
                <SidebarGroupContent>
                  <SidebarMenu className="gap-2.5">
                    {group.items.map((item) => {
                      const active =
                        pathname === item.href ||
                        (item.href !== "/admin" &&
                          pathname.startsWith(`${item.href}/`));
                      const Icon = ICONS[item.icon];
                      return (
                        <SidebarMenuItem key={item.key}>
                          <SidebarMenuButton
                            className="h-10"
                            isActive={active}
                            tooltip={item.label[lang]}
                            render={
                              <Link href={`${item.href}${langQuery}`}>
                                <Icon />
                                <span>{item.label[lang]}</span>
                              </Link>
                            }
                          />
                          {item.key === "applications" ? (
                            <NewApplicationsBadge />
                          ) : null}
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </SidebarContent>

          <SidebarFooter>
            <div className="flex items-center gap-2.5 px-1 py-1">
              <Avatar className="size-8 bg-accent" aria-hidden="true">
                <AvatarFallback className="bg-accent text-[13px] font-bold text-primary">
                  {staff.displayName.slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="flex min-w-0 flex-1 flex-col gap-1 overflow-hidden group-data-[collapsible=icon]:hidden">
                <strong className="truncate text-[13px] leading-none font-semibold">
                  {staff.displayName}
                </strong>
                <span className="truncate text-xs text-muted-foreground">
                  {roleLabel[staff.role][lang]}
                </span>
              </span>
              <span className="group-data-[collapsible=icon]:hidden">
                <AdminLogoutButton lang={lang} />
              </span>
            </div>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset>
          {!contentEditor && (
            <header className="sticky top-0 z-5 flex h-14 flex-none items-center gap-3 border-b border-border bg-card px-4">
              <SidebarTrigger className="md:hidden" />
              <Separator orientation="vertical" className="h-5 md:hidden" />
              <h1 className="m-0 text-[15px] font-semibold whitespace-nowrap">
                {pageTitle(pathname, lang)}
              </h1>
              <div className="ml-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={switchLanguage}
                  disabled={switchingLanguage}
                  aria-busy={switchingLanguage}
                  aria-label={
                    lang === "zh" ? "切换至英文" : "Switch to Chinese"
                  }
                  title={lang === "zh" ? "EN" : "中文"}
                >
                  {switchingLanguage ? (
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Languages aria-hidden="true" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => darkModePreference.set(!dark)}
                  title={dark ? "Switch to light mode" : "Switch to dark mode"}
                  aria-label={
                    lang === "zh"
                      ? dark
                        ? "切换至浅色模式"
                        : "切换至深色模式"
                      : dark
                        ? "Switch to light mode"
                        : "Switch to dark mode"
                  }
                >
                  {dark ? (
                    <Sun aria-hidden="true" />
                  ) : (
                    <Moon aria-hidden="true" />
                  )}
                </Button>
                <Link
                  href={`/${lang}`}
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "icon-sm" }),
                  )}
                  title={t.viewSite}
                  aria-label={t.viewSite}
                >
                  <ExternalLink aria-hidden="true" />
                </Link>
              </div>
            </header>
          )}
          <main
            aria-busy={switchingLanguage}
            className={`admin-content${contentEditor ? " admin-content-editor" : ""}`}
          >
            {/* A closed mobile drawer needs an external entry point.
                Desktop users expand and collapse from the sidebar itself. */}
            {contentEditor && (
              <div className="md:hidden">
                <SidebarTrigger />
              </div>
            )}
            <AdminSessionGate lang={lang}>{children}</AdminSessionGate>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
