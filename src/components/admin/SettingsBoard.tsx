"use client";

import {
  useId,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Building2,
  CircleAlert,
  MapPin,
  BriefcaseBusiness,
  Layers,
  Plus,
  Pencil,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { EmptyState } from "./ui/empty-state";
import { Bone, TableRowsSkeleton } from "./ui/data-skeleton";
import { FormField } from "./ui/form-field";
import { AdminPageHeader } from "./ui/page-header";
import { SectionCard } from "./ui/section-card";
import { useAdminRouter as useRouter } from "./AdminNavigation";
import { toast } from "sonner";
import {
  settingsContent,
  type SettingsCategoryId,
} from "@/lib/admin/settingsContent";
import type { ReferenceItem } from "@/lib/admin/referenceData";
import type { AdminLang } from "@/lib/admin/nav";
import { AdminRequestError, signInAgain } from "@/lib/admin/staffClient";
import { sendReferenceCommand } from "@/lib/admin/referenceClient";
import { referenceCommand } from "@/server/settings/contract";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Props = {
  /** Omit the lists while loading: labels render for real, rows are placeholders. */
  departments?: ReferenceItem[];
  locations?: ReferenceItem[];
  jobTypes?: ReferenceItem[];
  experienceLevels?: ReferenceItem[];
  lang: AdminLang;
  canEdit: boolean;
  preferences?: ReactNode;
};
type EditForm = {
  id: string;
  version: number;
  code: string;
  nameEn: string;
  nameZh: string;
  active: boolean;
  countryCode: string;
  timeZone: string;
  addressEn: string;
  addressZh: string;
};
const categories: SettingsCategoryId[] = [
  "department",
  "location",
  "jobType",
  "experience",
];

const categoryIcons = {
  department: Building2,
  location: MapPin,
  jobType: BriefcaseBusiness,
  experience: Layers,
};

// Give each reference category an explicit place without sharing Content editor styles.
// Versioned saves and edit permissions remain governed by the existing settings contract.
export function SettingsBoard({
  departments,
  locations,
  jobTypes,
  experienceLevels,
  lang,
  canEdit,
  preferences,
}: Props) {
  const t = settingsContent[lang],
    router = useRouter();
  const loading = !departments;
  const lists = {
    department: departments ?? [],
    location: locations ?? [],
    jobType: jobTypes ?? [],
    experience: experienceLevels ?? [],
  };
  const [category, setCategory] = useState<SettingsCategoryId>("department");
  const [form, setForm] = useState<EditForm | null>(null);
  const [pending, setPending] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState("");
  const attempt = useRef<{ signature: string; requestId: string } | null>(null);
  const inFlight = useRef(false);
  const formId = useId();
  const busy = pending || refreshing;
  // Initialize a focused option dialog from the selected record or a fresh draft.
  // Existing identifiers and versions stay intact for optimistic concurrency checks.
  function edit(item?: ReferenceItem) {
    setForm({
      id: item?.id ?? crypto.randomUUID(),
      version: item?.version ?? 0,
      code: item?.code ?? "",
      nameEn: item?.label.en ?? "",
      nameZh: item?.label.zh ?? "",
      active: item?.active ?? true,
      countryCode: item?.countryCode ?? "",
      timeZone: item?.timeZone ?? "",
      addressEn: item?.addressEn ?? "",
      addressZh: item?.addressZh ?? "",
    });
    setError("");
    attempt.current = null;
  }
  // Apply consistent labels, limits and native validation to the settings fields.
  // Optional addresses use multiline inputs while immutable codes stay protected.
  function field(
    key: keyof EditForm,
    label: string,
    maxLength: number,
    disabled = false,
  ) {
    return (
      <FormField
        label={label}
        htmlFor={`${formId}-${key}`}
        hint={key === "code" ? t.codeHelp : undefined}
        hintId={key === "code" ? `${formId}-code-help` : undefined}
      >
        {key === "addressEn" || key === "addressZh" ? (
          <Textarea
            id={`${formId}-${key}`}
            rows={4}
            className="min-h-28 field-sizing-content"
            value={String(form?.[key] ?? "")}
            maxLength={maxLength}
            disabled={disabled}
            onChange={(event) =>
              setForm((current) =>
                current ? { ...current, [key]: event.target.value } : null,
              )
            }
          />
        ) : (
          <Input
            id={`${formId}-${key}`}
            aria-describedby={
              key === "code" ? `${formId}-code-help` : undefined
            }
            value={String(form?.[key] ?? "")}
            maxLength={maxLength}
            disabled={disabled}
            required
            pattern={
              key === "code"
                ? "[A-Z][A-Z0-9_]{0,63}"
                : key === "countryCode"
                  ? "[A-Z]{2}"
                  : undefined
            }
            autoComplete="off"
            placeholder={
              key === "countryCode"
                ? "MY"
                : key === "timeZone"
                  ? "Asia/Kuala_Lumpur"
                  : undefined
            }
            onChange={(event) =>
              setForm((current) =>
                current ? { ...current, [key]: event.target.value } : null,
              )
            }
          />
        )}
      </FormField>
    );
  }
  // Validate and submit the same reference command used before the redesign.
  // Invalid or conflicting drafts remain open and retries retain their request identity.
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || busy || inFlight.current || !canEdit) return;
    const value = {
      code: form.code.trim(),
      nameEn: form.nameEn.trim(),
      nameZh: form.nameZh.trim(),
      active: form.active,
      ...(category === "location"
        ? {
            countryCode: form.countryCode.trim(),
            timeZone: form.timeZone.trim(),
            addressEn: form.addressEn.trim(),
            addressZh: form.addressZh.trim(),
          }
        : {}),
    };
    const command = {
      category,
      id: form.id,
      expectedVersion: form.version,
      value,
    };
    const signature = JSON.stringify(command);
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, requestId: crypto.randomUUID() };
    const parsed = referenceCommand.safeParse({
      ...command,
      requestId: attempt.current.requestId,
    });
    if (!parsed.success) {
      setError(t.invalid);
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      await sendReferenceCommand(parsed.data);
      setForm(null);
      attempt.current = null;
      toast.success(t.savedNotice);
      startTransition(() => router.refresh());
    } catch (error) {
      if (error instanceof AdminRequestError && error.status === 401) {
        signInAgain(lang);
        return;
      }
      setError(
        error instanceof AdminRequestError && error.status === 409
          ? t.conflict
          : t.failed,
      );
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  return (
    <>
      <AdminPageHeader title={t.title} description={t.subtitle} />
      <div
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        role="group"
        aria-label={t.title}
      >
        {categories.map((value) => {
          const Icon = categoryIcons[value];
          return (
            <button
              key={value}
              type="button"
              disabled={busy}
              aria-pressed={category === value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60",
                category === value
                  ? "border-primary/50 bg-accent"
                  : "border-border bg-card hover:bg-muted",
              )}
              onClick={() => {
                setCategory(value);
                setForm(null);
                setError("");
              }}
            >
              <Icon
                className="mt-0.5 size-5 shrink-0 text-primary"
                aria-hidden="true"
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <strong className="text-sm">{t.categories[value]}</strong>
                <span className="text-xs text-muted-foreground">
                  {t.descriptions[value]}
                </span>
              </span>
              <Badge tone="gray" className="tabular-nums">
                {loading ? (
                  <Bone width={14} height={11} />
                ) : (
                  lists[value].length
                )}
              </Badge>
            </button>
          );
        })}
      </div>
      <SectionCard
        padded={false}
        aria-busy={busy}
        title={t.categories[category]}
        description={t.descriptions[category]}
        actions={
          canEdit && (
            <Button disabled={busy || loading} onClick={() => edit()}>
              <Plus aria-hidden="true" />
              {t.adding}
            </Button>
          )
        }
      >
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow>
              <TableHead>{t.code}</TableHead>
              <TableHead>{t.columns.nameEn}</TableHead>
              <TableHead>{t.columns.nameZh}</TableHead>
              <TableHead>{t.columns.status}</TableHead>
              {canEdit && (
                <TableHead className="text-right">
                  {t.columns.actions}
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRowsSkeleton
                columns={canEdit ? 5 : 4}
                rows={5}
                trailingRight={canEdit}
              />
            ) : null}
            {lists[category].map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {item.code}
                  </code>
                </TableCell>
                <TableCell>
                  <span className="block text-sm font-medium text-foreground">
                    {item.label.en}
                  </span>
                  {category === "location" && item.timeZone && (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {item.timeZone.replaceAll("_", " ")}
                    </span>
                  )}
                </TableCell>
                <TableCell lang="zh-CN">{item.label.zh}</TableCell>
                <TableCell>
                  <Badge tone={item.active ? "green" : "gray"}>
                    {item.active ? t.active : t.inactive}
                  </Badge>
                </TableCell>
                {canEdit && (
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      aria-label={`${t.edit}: ${item.label[lang]}`}
                      onClick={() => edit(item)}
                    >
                      <Pencil aria-hidden="true" />
                      {t.edit}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!loading && !lists[category].length && (
          <EmptyState icon={Layers} title={t.empty} />
        )}
      </SectionCard>
      {preferences && <SectionCard>{preferences}</SectionCard>}
      <Dialog
        open={!!form && canEdit}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setForm(null);
            setError("");
          }
        }}
      >
        <DialogContent showCloseButton={!busy} className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {form?.version ? t.editing : t.adding} · {t.categories[category]}
            </DialogTitle>
            <DialogDescription>{t.editorHelp}</DialogDescription>
          </DialogHeader>
          {form && (
            <form onSubmit={save} className="grid gap-4">
              <fieldset disabled={busy} className="m-0 grid gap-4 border-0 p-0">
                {field("code", t.code, 64, form.version > 0)}
                <div className="grid gap-4 sm:grid-cols-2">
                  {field("nameEn", t.nameEnPlaceholder, 120)}
                  {field("nameZh", t.nameZhPlaceholder, 120)}
                </div>
                {category === "location" && (
                  <div className="grid gap-4 border-t border-border pt-4">
                    <h3 className="m-0 text-sm font-semibold">
                      {t.locationDetails}
                    </h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {field("countryCode", t.countryCode, 2)}
                      {field("timeZone", t.timeZone, 100)}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {field("addressEn", t.addressEn, 300)}
                      {field("addressZh", t.addressZh, 300)}
                    </div>
                  </div>
                )}
                <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3">
                  <Switch
                    checked={form.active}
                    onCheckedChange={(checked) =>
                      setForm((current) =>
                        current ? { ...current, active: checked } : null,
                      )
                    }
                  />
                  <strong className="text-sm">{t.activeLabel}</strong>
                </label>
              </fieldset>
              {error && (
                <Alert variant="destructive">
                  <CircleAlert aria-hidden="true" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setForm(null);
                    setError("");
                  }}
                >
                  {t.cancel}
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? t.saving : t.save}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
