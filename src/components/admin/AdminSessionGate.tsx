"use client";

import { createContext, useContext, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AdminPageSkeleton } from "./AdminPageSkeleton";

export const AdminSessionContext = createContext({
  checking: false,
  admissionFailed: false,
  redirecting: false,
});

// Only gate page data. The authenticated shell and the mounted editor survive
// tab-resume checks, including the editor's unsaved local state.
export function AdminSessionGate({
  lang,
  children,
}: {
  lang: "en" | "zh";
  children: ReactNode;
}) {
  const { checking, admissionFailed, redirecting } =
    useContext(AdminSessionContext);
  return (
    <>
      <div
        className="admin-session-content"
        hidden={checking || admissionFailed || redirecting}
      >
        {children}
      </div>
      {redirecting ? (
        <div
          role="status"
          className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"
        >
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          {lang === "zh" ? "正在跳转…" : "Redirecting…"}
        </div>
      ) : admissionFailed ? (
        <Card
          variant="panel"
          role="alert"
          className="flex flex-col items-start gap-3 p-5"
        >
          <p className="m-0">
            {lang === "zh"
              ? "无法验证当前会话，请重试。"
              : "Unable to verify your session. Please retry."}
          </p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            {lang === "zh" ? "重试" : "Retry"}
          </Button>
        </Card>
      ) : checking ? (
        <AdminPageSkeleton lang={lang} />
      ) : null}
    </>
  );
}
