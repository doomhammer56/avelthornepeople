"use client";

import { useAdminLoading } from "./AdminNavigation";
import { usePathname, useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type SkeletonVariant =
  | "dashboard"
  | "jobs"
  | "applications"
  | "detail"
  | "editor"
  | "accounts"
  | "settings"
  | "audit"
  | "content";

function routeVariant(pathname: string): SkeletonVariant {
  if (pathname === "/admin") return "dashboard";
  if (/^\/admin\/jobs\/(new|[^/]+\/edit)$/.test(pathname)) return "editor";
  if (pathname === "/admin/jobs") return "jobs";
  if (pathname === "/admin/applications") return "applications";
  if (pathname.startsWith("/admin/applications/")) return "detail";
  if (pathname === "/admin/accounts") return "accounts";
  if (pathname === "/admin/settings") return "settings";
  if (pathname === "/admin/content") return "content";
  return "audit";
}

function Block({
  width = "100%",
  height = 14,
  className = "",
}: {
  width?: number | string;
  height?: number;
  className?: string;
}) {
  return (
    <Skeleton
      className={cn("max-w-full shrink-0", className)}
      style={{ width, height }}
    />
  );
}

const Stack = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={cn("flex min-w-0 flex-1 flex-col gap-2", className)}>
    {children}
  </div>
);

const Panel = ({
  children,
  className,
  ...props
}: React.ComponentProps<typeof Card>) => (
  <Card
    variant="panel"
    className={cn("flex flex-col gap-4 p-5", className)}
    {...props}
  >
    {children}
  </Card>
);

function Fields({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      {Array.from({ length: count }, (_, i) => (
        <Stack key={i}>
          <Block width="38%" height={10} />
          <Block height={38} />
        </Stack>
      ))}
    </div>
  );
}

function Tabs({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-2 overflow-hidden">
      {Array.from({ length: count }, (_, i) => (
        <Block key={i} width={86} height={32} className="rounded-full" />
      ))}
    </div>
  );
}

function Table({
  columns,
  avatar = false,
}: {
  columns: number;
  avatar?: boolean;
}) {
  return (
    <Card variant="panel" className="overflow-hidden">
      <div className="overflow-hidden">
        <div style={{ minWidth: columns * 120 }}>
          {Array.from({ length: 7 }, (_, row) => (
            <div
              key={row}
              className={cn(
                "grid items-center gap-4 border-b border-border px-5 py-3.5",
                row === 0 && "bg-background py-3",
              )}
              style={{
                gridTemplateColumns: `minmax(180px, 2fr) repeat(${columns - 1}, minmax(80px, 1fr))`,
              }}
            >
              {Array.from({ length: columns }, (_, column) => (
                <div className="flex items-center gap-3" key={column}>
                  {avatar && column === 0 && row > 0 && (
                    <Block width={32} height={32} className="rounded-full" />
                  )}
                  <Stack className="gap-1.5">
                    <Block
                      width={column === 0 ? "72%" : "65%"}
                      height={row === 0 ? 10 : 13}
                    />
                    {column === 0 && row > 0 && (
                      <Block width="88%" height={10} />
                    )}
                  </Stack>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3">
        <Block width={120} height={12} />
        <div className="flex items-center gap-2">
          <Block width={70} height={32} />
          <Block width={70} height={32} />
        </div>
      </div>
    </Card>
  );
}

function Dashboard() {
  return (
    <>
      <Panel className="flex-row flex-wrap items-center justify-between px-5 py-4">
        <Stack className="flex-none">
          <Block width={110} />
          <Block width={190} height={11} />
        </Stack>
        <Tabs count={3} />
      </Panel>
      <div
        data-skeleton-part="kpis"
        className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-3"
      >
        {Array.from({ length: 5 }, (_, i) => (
          <Panel key={i} className="gap-2.5 px-5 py-4">
            <Block width="62%" height={12} />
            <Block width={64} height={32} />
            <Block width="80%" height={10} />
          </Panel>
        ))}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-3">
        <Panel>
          <Block width={160} height={16} />
          <div className="flex h-44 items-end gap-1.5 border-b border-border">
            {[40, 65, 48, 85, 60, 95, 75, 55, 80, 65, 90, 70].map(
              (height, i) => (
                <Skeleton
                  key={i}
                  className="flex-1"
                  style={{ height: `${height}%` }}
                />
              ),
            )}
          </div>
        </Panel>
        <Panel>
          <Block width={150} height={16} />
          <div className="flex items-center gap-5">
            <Block width={140} height={140} className="rounded-full" />
            <Stack className="gap-3">
              {Array.from({ length: 4 }, (_, i) => (
                <Block key={i} width={`${85 - i * 10}%`} height={12} />
              ))}
            </Stack>
          </div>
        </Panel>
      </div>
    </>
  );
}

function Editor() {
  return (
    <div className="flex w-full flex-col gap-5">
      <div data-skeleton-part="steps" className="grid grid-cols-3 gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Panel key={i} className="flex-row items-center gap-2.5 px-3 py-2.5">
            <Block width={24} height={24} className="rounded-full" />
            <Block width="55%" height={12} />
          </Panel>
        ))}
      </div>
      <Panel className="gap-5 p-6">
        <Tabs count={2} />
        <Fields count={2} />
        <Stack>
          <Block width={120} height={11} />
          <Block height={160} />
        </Stack>
        <Stack>
          <Block width={130} height={11} />
          <Block height={120} />
        </Stack>
      </Panel>
      <div className="flex items-center justify-between gap-4">
        <Block width={90} height={36} />
        <Block width={130} height={36} />
      </div>
    </div>
  );
}

function Detail() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <Panel>
        <div className="flex items-center gap-3">
          <Block width={48} height={48} className="rounded-full" />
          <Stack>
            <Block width="45%" height={20} />
            <Block width="65%" height={12} />
          </Stack>
        </div>
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Stack key={i}>
              <Block width={80} height={12} />
              <Block width="60%" height={12} />
            </Stack>
          ))}
        </div>
        <Tabs count={5} />
      </Panel>
      <Panel>
        <Block width={170} height={18} />
        <Block width={150} />
        <Block width={220} />
      </Panel>
      <Panel>
        <Block width={160} height={18} />
        <Block height={14} />
        <Block width="85%" height={14} />
        <Block width="65%" height={14} />
      </Panel>
    </div>
  );
}

function Content() {
  return (
    <>
      <Panel className="flex-row flex-wrap items-center justify-between px-3 py-2.5">
        <Tabs count={3} />
        <Block width={100} height={34} />
      </Panel>
      <div className="grid items-start gap-3 min-[1100px]:grid-cols-[minmax(0,1fr)_340px]">
        <Panel className="gap-4">
          <div className="flex items-center justify-between gap-4">
            <Block width={100} height={22} />
            <Block width="35%" height={12} />
          </div>
          <Stack className="gap-3 py-6">
            <Block width="55%" height={30} />
            <Block width="70%" />
            <Block width={110} height={36} />
          </Stack>
          <div className="grid gap-4 sm:grid-cols-2">
            <Block height={140} />
            <Block height={140} />
          </div>
        </Panel>
        <Panel>
          <Tabs count={2} />
          <Fields count={2} />
          <Block height={90} />
          <Fields count={2} />
          <Block height={120} />
        </Panel>
      </div>
    </>
  );
}

export function AdminPageSkeleton({
  variant,
  lang,
  showHeader = true,
}: {
  variant?: SkeletonVariant;
  lang?: "en" | "zh";
  showHeader?: boolean;
}) {
  useAdminLoading(true);
  const pathname = usePathname();
  const selectedLanguage = useSearchParams().get("lang");
  const language = lang ?? (selectedLanguage === "zh" ? "zh" : "en");
  const shape = variant ?? routeVariant(pathname);
  return (
    <div
      className="w-full min-w-0"
      data-skeleton={shape}
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">
        {language === "zh" ? "正在加载…" : "Loading…"}
      </span>
      <div className="flex min-w-0 flex-col gap-5" aria-hidden="true">
        {showHeader && shape !== "content" && (
          <div
            data-skeleton-part="header"
            className="flex flex-wrap items-end justify-between gap-3"
          >
            <Stack className="max-w-sm gap-3">
              {(shape === "detail" || shape === "editor") && (
                <Block width={70} height={11} />
              )}
              <Block width={shape === "accounts" ? 220 : 180} height={28} />
              <Block width="85%" height={13} />
            </Stack>
            <Block width={110} height={36} />
          </div>
        )}
        {shape === "dashboard" ? (
          <Dashboard />
        ) : shape === "editor" ? (
          <Editor />
        ) : shape === "detail" ? (
          <Detail />
        ) : shape === "content" ? (
          <Content />
        ) : (
          <>
            {shape === "jobs" && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Tabs count={6} />
                <Block width={220} height={38} />
              </div>
            )}
            {(shape === "applications" || shape === "audit") && (
              <Panel>
                <Fields count={shape === "applications" ? 6 : 2} />
                {shape === "audit" && <Block width={150} height={12} />}
              </Panel>
            )}
            {shape === "applications" && (
              <div
                data-skeleton-part="pipeline"
                className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
              >
                {Array.from({ length: 5 }, (_, i) => (
                  <Panel key={i} className="gap-1.5 px-4 py-3">
                    <Block width="75%" height={12} />
                    <Block width={35} height={26} />
                  </Panel>
                ))}
              </div>
            )}
            {shape === "settings" && (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 4 }, (_, i) => (
                  <Panel
                    key={i}
                    className="flex-row items-start gap-3 px-4 py-3.5"
                  >
                    <Block width={20} height={20} />
                    <Stack className="gap-1.5">
                      <Block width="80%" />
                      <Block height={10} />
                      <Block width="75%" height={10} />
                    </Stack>
                    <Block width={24} height={24} />
                  </Panel>
                ))}
              </div>
            )}
            <Table
              columns={
                shape === "jobs"
                  ? 8
                  : shape === "applications" || shape === "accounts"
                    ? 6
                    : shape === "settings"
                      ? 4
                      : 5
              }
              avatar={shape === "applications" || shape === "accounts"}
            />
            {shape === "settings" && (
              <Panel>
                <Block width={160} />
                <Fields count={2} />
              </Panel>
            )}
          </>
        )}
      </div>
    </div>
  );
}
