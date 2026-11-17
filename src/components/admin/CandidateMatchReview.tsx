"use client";
import { useRef, useState } from "react";
import { AdminLink as Link } from "./AdminNavigation";
import { useAdminRouter as useRouter } from "./AdminNavigation";
import type { AdminLang } from "@/lib/admin/nav";
import type { CandidateSummary, MatchPage } from "@/lib/admin/recruitment";
import {
  recruitmentRequest,
  recruitmentContent,
} from "@/lib/admin/recruitmentClient";
import { AdminRequestError, signInAgain } from "@/lib/admin/staffClient";
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  GitCompareArrows,
  Merge,
  TriangleAlert,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { EmptyState } from "./ui/empty-state";
import { SectionCard } from "./ui/section-card";
type Props = {
  candidate: CandidateSummary;
  applicationId: string;
  lang: AdminLang;
  onSaved?: () => void;
};
export function CandidateMatchReview({
  candidate,
  lang,
  onSaved,
}: Props) {
  const t = recruitmentContent[lang],
    router = useRouter();
  const [data, setData] = useState<MatchPage | null>(null),
    [selected, setSelected] = useState<CandidateSummary | null>(null),
    [survivor, setSurvivor] = useState(candidate.id),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const inFlight = useRef(false),
    command = useRef<{
      path: string;
      body: {
        sourceId: string;
        sourceVersion: number;
        expectedVersion: number;
        requestId: string;
      };
    } | null>(null);
  function failed(cause: unknown) {
    if (cause instanceof AdminRequestError && cause.status === 401) {
      signInAgain(lang);
      return;
    }
    setError(
      cause instanceof AdminRequestError && cause.status === 503
        ? t.unavailable
        : t.failed,
    );
  }
  async function load(page = 1) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      setData(
        await recruitmentRequest<MatchPage>(
          `/api/admin/candidates/${candidate.id}/matches?page=${page}`,
        ),
      );
      setSelected(null);
    } catch (cause) {
      failed(cause);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function merge() {
    if (!selected || inFlight.current) return;
    if (!window.confirm(t.confirm)) return;
    const target = survivor === candidate.id ? candidate : selected,
      source = survivor === candidate.id ? selected : candidate;
    const path = `/api/admin/candidates/${target.id}/merge`,
      body = {
        sourceId: source.id,
        sourceVersion: source.version,
        expectedVersion: target.version,
      };
    if (
      !command.current ||
      command.current.path !== path ||
      command.current.body.sourceId !== body.sourceId ||
      command.current.body.sourceVersion !== body.sourceVersion ||
      command.current.body.expectedVersion !== body.expectedVersion
    )
      command.current = {
        path,
        body: { ...body, requestId: crypto.randomUUID() },
      };
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await recruitmentRequest(
        command.current.path,
        "POST",
        command.current.body,
      );
      command.current = null;
      setData(null);
      setSelected(null);
      if (onSaved) onSaved();
      else router.refresh();
    } catch (cause) {
      failed(cause);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <SectionCard
      className="mx-auto w-full max-w-3xl"
      title={t.matches}
      actions={
        <Button
          variant="outline"
          disabled={busy || !candidate.mergeAllowed}
          onClick={() => load()}
        >
          <GitCompareArrows aria-hidden="true" />
          {t.review}
        </Button>
      }
      bodyClassName="flex flex-col gap-4"
    >
      <p className="m-0 text-xs text-muted-foreground">
        {t.current}: {candidate.name || candidate.id} ·{" "}
        <Link
          className="font-medium text-primary hover:underline"
          href={`/admin/applications?candidateId=${candidate.id}&lang=${lang}`}
        >
          {t.history} ({candidate.applicationCount})
        </Link>
      </p>
      {!candidate.mergeAllowed ? (
        <p className="m-0 text-xs text-muted-foreground">{t.unavailable}</p>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {data ? (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-xs text-muted-foreground">
            {data.total} {t.results}
          </p>
          {data.matches.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {data.matches.map((match) => (
                <article
                  key={match.candidate.id}
                  className="flex flex-col gap-2 rounded-lg border border-border p-4 data-[selected=true]:border-primary/50 data-[selected=true]:bg-accent"
                  data-selected={selected?.id === match.candidate.id}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium">
                      {match.candidate.name || match.candidate.id}
                    </span>
                    <Badge tone="accent">{t.reason[match.reason]}</Badge>
                  </div>
                  <p className="m-0 text-xs break-all text-muted-foreground">
                    {match.candidate.email} · {match.candidate.phone}
                  </p>
                  <p className="m-0 text-xs text-muted-foreground">
                    {t.history}: {match.candidate.applicationCount}
                  </p>
                  {match.conflict ? (
                    <p className="m-0 flex items-center gap-1.5 text-xs text-tone-amber-foreground">
                      <TriangleAlert className="size-3.5" aria-hidden="true" />
                      {t.conflict}
                    </p>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-auto w-fit"
                    disabled={busy || !match.candidate.mergeAllowed}
                    onClick={() => {
                      setSelected(match.candidate);
                      setSurvivor(candidate.id);
                    }}
                  >
                    {t.compare}
                  </Button>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title={t.noMatches} />
          )}
          <div className="flex items-center justify-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={busy || data.page <= 1}
              onClick={() => load(data.page - 1)}
            >
              <ChevronLeft aria-hidden="true" />
              {t.previous}
            </Button>
            <span className="text-xs tabular-nums">{data.page}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || data.page * data.pageSize >= data.total}
              onClick={() => load(data.page + 1)}
            >
              {t.next}
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </div>
      ) : null}
      {selected ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-4">
          <p className="m-0 text-[13px]">{t.confirm}</p>
          <RadioGroup
            aria-label={t.keep}
            value={survivor}
            onValueChange={(value) => setSurvivor(String(value))}
            disabled={busy}
          >
            {[candidate, selected].map((item) => (
              <label
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3 text-sm has-data-checked:border-primary/50 has-data-checked:bg-accent"
                key={item.id}
              >
                <RadioGroupItem value={item.id} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block font-medium">{t.keep}</span>
                  <span className="block text-xs break-words text-muted-foreground">
                    {item.name} · {item.email} · {item.phone} ·{" "}
                    {item.applicationCount}
                  </span>
                </span>
              </label>
            ))}
          </RadioGroup>
          <Button className="w-fit" disabled={busy} onClick={merge}>
            <Merge aria-hidden="true" />
            {t.merge}
          </Button>
        </div>
      ) : null}
    </SectionCard>
  );
}
