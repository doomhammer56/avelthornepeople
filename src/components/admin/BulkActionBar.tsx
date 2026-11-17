"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import type { AdminLang } from "@/lib/admin/nav";
import { tableContent } from "@/lib/admin/tableContent";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "./ui/confirm-dialog";

// Appears above a table once rows are selected. Action buttons are passed in
// so each screen offers only the actions that make sense for its rows.
export function BulkActionBar({
  lang,
  count,
  busy = false,
  onClear,
  children,
}: {
  lang: AdminLang;
  count: number;
  busy?: boolean;
  onClear: () => void;
  children: ReactNode;
}) {
  const t = tableContent[lang];
  if (count === 0) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-accent px-5 py-2.5"
      role="region"
      aria-label={t.selected(count)}
    >
      <p className="m-0 text-[13px] font-medium" role="status">
        {t.selected(count)}
      </p>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto"
        disabled={busy}
        onClick={onClear}
      >
        <X aria-hidden="true" />
        {t.clear}
      </Button>
    </div>
  );
}

export function BulkConfirmDialog({
  lang,
  open,
  title,
  description,
  confirmLabel,
  destructive = false,
  pending,
  onConfirm,
  onCancel,
}: {
  lang: AdminLang;
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = tableContent[lang];
  return (
    <ConfirmDialog
      open={open}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      cancelLabel={t.cancel}
      pendingLabel={t.working}
      destructive={destructive}
      pending={pending}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
