"use client";

import { AdminLink as Link } from "./AdminNavigation";
import { useCvDownload } from "./useCvDownload";
import type { AdminLang } from "@/lib/admin/nav";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Props = {
  detailHref: string;
  viewLabel: string;
  downloadLabel: string;
  pendingTitle: string;
  applicationId: string;
  canDownload: boolean;
  lang: AdminLang;
};

// One menu per row instead of several inline buttons.
export function ApplicationRowActions({
  detailHref,
  viewLabel,
  downloadLabel,
  pendingTitle,
  applicationId,
  canDownload,
  lang,
}: Props) {
  const { pending, download } = useCvDownload(lang);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={viewLabel}
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem render={<Link href={detailHref}>{viewLabel}</Link>} />
        <DropdownMenuItem
          disabled={!canDownload || pending}
          title={!canDownload ? pendingTitle : undefined}
          onClick={() => download(applicationId)}
        >
          {downloadLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
