"use client";
import {
  ArrowDown,
  ArrowUp,
  Briefcase,
  CircleAlert,
  EyeOff,
  FileText,
  Plus,
  RotateCw,
  Save,
  Send,
  Trash2,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "./ui/empty-state";
import { FormField } from "./ui/form-field";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  contentTypes,
  contentNames,
  emptyDraft,
  contentDraft,
  contentIssues,
  type ManagedContentBlock,
  type ContentDraft,
  type ContentItem,
  type ContentIssue,
  type ContentType,
} from "@/lib/content/contract";
import { blockStateTone, contentContent } from "@/lib/admin/contentContent";
import {
  contentEditorText,
  sendContentCommand,
  ContentRequestError,
} from "@/lib/admin/contentClient";
import { AdminRequestError, signInAgain } from "@/lib/admin/staffClient";
import type { AdminLang } from "@/lib/admin/nav";
import {
  contentSections,
  fieldHint,
  itemFields,
} from "@/lib/admin/contentFields";
import {
  defaultSection,
  pageSections,
  sectionOf,
} from "@/lib/admin/contentLayout";
import { AdminLink as Link } from "./AdminNavigation";
import { ContentImagePicker } from "./ContentImagePicker";
import type { PublicJobSummary } from "@/lib/publicJobs";
import { ContentPagePreview } from "./ContentPagePreview";
import { ContentEditorToolbar } from "./ContentEditorToolbar";
import {
  contentPreviewText,
  contentUsage,
  type ContentPreviewPage,
  type ContentSelection,
} from "@/lib/admin/contentPreview";
type Props = {
  blocks: ManagedContentBlock[];
  lang: AdminLang;
  canEdit: boolean;
  title: string;
  jobs: readonly PublicJobSummary[];
  jobsTotal?: number;
  jobsFailed: boolean;
};
// Compare only fields persisted by a save command.
// Publication metadata must not create false unsaved warnings.
const signature = (block: ManagedContentBlock) =>
  JSON.stringify({ draft: block.draft, sortOrder: block.sortOrder });
// Own drafts and publication state for the visual content workspace.
// The existing transport and backend permissions remain authoritative.
export function ContentBlocksBoard({
  blocks: initial,
  lang,
  canEdit,
  title,
  jobs,
  jobsTotal,
  jobsFailed,
}: Props) {
  const t = contentContent[lang],
    m = contentEditorText[lang];
  const [blocks, setBlocks] = useState(initial),
    [baselines, setBaselines] = useState(() =>
      Object.fromEntries(initial.map((block) => [block.id, signature(block)])),
    );
  const [sectionKey, setSectionKey] = useState(
      defaultSection("home")?.key ?? "",
    ),
    [tab, setTab] = useState<AdminLang>(lang),
    [newKind, setNewKind] = useState<ContentItem["kind"] | "">(""),
    [busy, setBusy] = useState(false),
    [uploads, setUploads] = useState(0),
    [error, setError] = useState(""),
    [issues, setIssues] = useState<ContentIssue[]>([]),
    [fallback, setFallback] = useState<Record<string, boolean>>(() =>
      Object.fromEntries(initial.map((b) => [b.id, b.approvedChineseFallback])),
    );
  // Keep navigation and selection separate from section drafts and command state.
  // Preview changes must not discard edits or issue backend requests.
  const previewBlocks = useDeferredValue(blocks);
  const [page, setPage] = useState<ContentPreviewPage>("home");
  const [mobile, setMobile] = useState(false);
  const [selection, setSelection] = useState<ContentSelection | null>(null);
  const inspector = useRef<HTMLDivElement>(null);
  const v = contentPreviewText[lang];
  const inFlight = useRef(false),
    pending = useRef<{ key: string; requestId: string } | null>(null),
    newId = useRef<string | null>(null);
  // The inspector follows the public page: one entry per section the page
  // really renders. Several sections can read the same stored block.
  const section = sectionOf(page, sectionKey) ?? defaultSection(page);
  const selected = section?.type
      ? blocks.find((block) => block.type === section.type)
      : undefined,
    blocked = busy || uploads > 0,
    dirty = !!selected && signature(selected) !== baselines[selected.id];
  const available = contentTypes.filter(
    (type) =>
      contentUsage[type].length > 0 && !blocks.some((b) => b.type === type),
  );
  // Track every edited section rather than only the currently selected one.
  // Staff can switch preview pages without hiding an earlier unsaved change.
  const hasUnsavedChanges = blocks.some(
    (block) => signature(block) !== baselines[block.id],
  );

  // Warn before leaving any unsaved section, including drafts from another preview page.
  // Content stays in memory and is never written to browser storage.
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    let approved = false;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (approved) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const navigate = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]");
      if (
        !anchor ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        anchor.getAttribute("target") === "_blank" ||
        anchor.getAttribute("href")?.startsWith("#")
      )
        return;
      if (!window.confirm(v.leave)) {
        event.preventDefault();
        event.stopPropagation();
      } else approved = true;
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", navigate, true);
    };
  }, [hasUnsavedChanges, v.leave]);

  // Focus the matching control after selecting text, images or repeated cards.
  // Stable item IDs keep the inspector aligned when staff reorder content.
  useEffect(() => {
    if (!selection || !inspector.current) return;
    const scope = selection.itemId
      ? Array.from(
          inspector.current.querySelectorAll<HTMLElement>("[data-editor-item]"),
        ).find((node) => node.dataset.editorItem === selection.itemId)
      : inspector.current;
    const field = scope?.querySelector<HTMLElement>(
      `[data-editor-field="${selection.field ?? "title"}"]`,
    );
    field?.focus({ preventScroll: true });
    field?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [selection]);

  // Select a section without discarding other drafts or navigating the website.
  // The preview communicates content identity rather than issuing backend commands.
  const selectContent = useCallback(
    (value: ContentSelection) => {
      if (!value.section || blocked) return;
      setSectionKey(value.section);
      setSelection(value);
      setError("");
      setIssues([]);
    },
    [blocked],
  );

  // Update one selected section while keeping all other drafts intact.
  // Shared content immediately stays consistent across preview pages.
  function edit(change: (draft: ContentDraft) => ContentDraft) {
    if (!selected) return;
    setBlocks((current) =>
      current.map((b) =>
        b.id === selected.id
          ? {
              ...b,
              draft: change(b.draft),
              state: b.publishedAt ? "unpublished" : "draft",
            }
          : b,
      ),
    );
  }
  // Reveal the language containing the first validation issue.
  // Staff can correct bilingual content without losing their input.
  function showIssues(value: ContentIssue[]) {
    setIssues(value);
    const field = value[0]?.field ?? "";
    if (field.split(".").includes("en")) setTab("en");
    else if (field.split(".").includes("zh")) setTab("zh");
  }
  // Use the established sign-in recovery for expired sessions.
  // Other errors retain draft input for review and safe retries.
  function showError(cause: unknown) {
    if (cause instanceof AdminRequestError && cause.status === 401) {
      signInAgain(lang);
      return;
    }
    if (cause instanceof ContentRequestError) {
      showIssues(cause.issues);
    }
    setError(m.failed);
  }
  // Reuse a command identity only while the retry payload is unchanged.
  // Backend idempotency prevents duplicate writes from repeated clicks.
  const requestId = (key: string) => {
    if (pending.current?.key !== key)
      pending.current = { key, requestId: crypto.randomUUID() };
    return pending.current.requestId;
  };
  // Send versioned commands for one section through the existing content client.
  // In-flight uploads and unsaved changes cannot bypass publication rules.
  async function commit(
    action: "save" | "publish" | "unpublish" | "create",
    createType?: ContentType,
  ) {
    if (inFlight.current || !canEdit || uploads > 0) return;
    if (action !== "create" && !selected) return;
    if (action === "publish" && dirty) {
      setError(m.dirty);
      return;
    }
    if (action === "unpublish" && !window.confirm(m.confirm)) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setIssues([]);
    try {
      let path = "/api/admin/content",
        method: "POST" | "PATCH" = "POST",
        body: Record<string, unknown>;
      if (action === "create") {
        const type = createType;
        if (!type || !available.includes(type)) return;
        newId.current ??= crypto.randomUUID();
        const draft = emptyDraft();
        draft.en.title = contentNames[type].en;
        draft.zh.title = contentNames[type].zh;
        body = {
          id: newId.current,
          type,
          draft,
          sortOrder: contentTypes.indexOf(type) * 10,
        };
      } else {
        const block = selected;
        if (!block) return;
        path += `/${block.id}`;
        if (action === "save") {
          const parsed = contentDraft.safeParse(block.draft);
          if (!parsed.success) {
            showIssues(
              parsed.error.issues
                .slice(0, 20)
                .map((i) => ({ field: i.path.join("."), code: "invalid" })),
            );
            setError(m.failed);
            return;
          }
          const invalid = contentIssues(block.type, parsed.data);
          if (invalid.length) {
            showIssues(invalid);
            setError(m.failed);
            return;
          }
          method = "PATCH";
          body = {
            draft: parsed.data,
            sortOrder: block.sortOrder,
            expectedVersion: block.version,
          };
        } else {
          path += "/actions";
          body = {
            action,
            expectedVersion: block.version,
            allowChineseFallback:
              action === "publish" && (fallback[block.id] ?? false),
          };
        }
      }
      const saved = await sendContentCommand(
        path,
        {
          ...body,
          requestId: requestId(JSON.stringify({ path, method, body })),
        },
        method,
      );
      pending.current = null;
      newId.current = null;
      setBlocks((current) =>
        current.some((b) => b.id === saved.id)
          ? current.map((b) => (b.id === saved.id ? saved : b))
          : [...current, saved],
      );
      setBaselines((current) => ({ ...current, [saved.id]: signature(saved) }));
      setFallback((current) => ({
        ...current,
        [saved.id]: saved.approvedChineseFallback,
      }));
      toast.success(
        action === "publish"
          ? m.published
          : action === "unpublish"
            ? m.unpublished
            : m.saved,
      );
    } catch (cause) {
      showError(cause);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  // Attach backend and client validation to the same editing fields.
  // Staff can fix issues without resetting unrelated drafts.
  const fieldError = (field: string) => {
    const issue = issues.find(
      (i) => i.field === field || i.field === `draft.${field}`,
    );
    return issue ? (
      <small role="alert" className="text-xs text-destructive">
        {m[issue.code]}
      </small>
    ) : null;
  };
  // Expose bilingual section fields to both direct and canvas selection.
  // Data hooks let the preview focus the matching inspector control.
  const mainField = (
    field: "title" | "body" | "eyebrow" | "imageAlt",
    label: string,
  ) =>
    selected ? (
      <FormField
        label={label}
        hint={
          field !== "imageAlt" ? fieldHint(lang, selected.type, field) : null
        }
      >
        {field === "body" || field === "title" ? (
          <Textarea
            data-editor-field={field}
            rows={field === "body" ? 8 : 3}
            className={
              field === "body"
                ? "min-h-44 max-h-96 field-sizing-content"
                : "min-h-20 field-sizing-content"
            }
            disabled={!canEdit || blocked}
            value={selected.draft[tab][field]}
            onChange={(e) =>
              edit((d) => ({
                ...d,
                [tab]: { ...d[tab], [field]: e.target.value },
              }))
            }
          />
        ) : (
          <Input
            data-editor-field={field}
            disabled={!canEdit || blocked}
            value={selected.draft[tab][field]}
            onChange={(e) =>
              edit((d) => ({
                ...d,
                [tab]: { ...d[tab], [field]: e.target.value },
              }))
            }
          />
        )}
        {fieldError(`${tab}.${field}`)}
      </FormField>
    ) : null;
  // Reuse the image picker and block commands during pending transfers.
  // Image replacements update the preview without publishing the section.
  const picker = (item?: ContentItem) =>
    selected ? (
      <ContentImagePicker
        image={
          selected.images[
            item?.imageId ?? (!item ? selected.draft.imageId : null) ?? ""
          ]
        }
        alt={(item ? item[tab] : selected.draft[tab]).imageAlt}
        defaultImage={
          !item ? contentSections[selected.type].defaultImage : undefined
        }
        lang={lang}
        disabled={!canEdit || blocked}
        onPending={(delta) => setUploads((n) => n + delta)}
        onError={showError}
        onChange={(image) => {
          setBlocks((current) =>
            current.map((b) =>
              b.id === selected.id
                ? {
                    ...b,
                    state: b.publishedAt ? "unpublished" : "draft",
                    images: image
                      ? { ...b.images, [image.id]: image }
                      : b.images,
                    draft: item
                      ? {
                          ...b.draft,
                          items: b.draft.items.map((i) =>
                            i.id === item.id
                              ? { ...i, imageId: image?.id ?? null }
                              : i,
                          ),
                        }
                      : { ...b.draft, imageId: image?.id ?? null },
                  }
                : b,
            ),
          );
        }}
      />
    ) : null;
  // Reorder items of the section's kinds only, without changing IDs or
  // translations. Items of other kinds keep their places.
  function move(position: number, delta: number) {
    edit((d) => {
      const visible = d.items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) =>
          [...(section?.kinds ?? []), ...(section?.legacyKinds ?? [])].includes(
            item.kind,
          ),
        );
      const from = visible[position]?.index;
      const to = visible[position + delta]?.index;
      if (from === undefined || to === undefined) return d;
      const items = [...d.items];
      [items[from], items[to]] = [items[to], items[from]];
      return { ...d, items };
    });
  }
  const sections = pageSections[page];
  const shownKinds = section
    ? [...section.kinds, ...(section.legacyKinds ?? [])]
    : [];
  const visibleItems =
    selected && section
      ? selected.draft.items
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => shownKinds.includes(item.kind))
      : [];
  const itemKindChoices = (current: ContentItem["kind"]) =>
    section?.kinds.includes(current)
      ? section.kinds
      : [...(section?.kinds ?? []), current];
  const itemCap = section?.maxItems ?? 30;
  const canAdd =
    !!selected &&
    !!section &&
    section.kinds.length > 0 &&
    selected.draft.items.length < 30 &&
    visibleItems.length < itemCap;
  const goToPage = (destination: ContentPreviewPage) => {
    const target =
      pageSections[destination].find((item) => item.type === section?.type) ??
      defaultSection(destination);
    setPage(destination);
    setSectionKey(target?.key ?? "");
    setSelection(null);
    setError("");
    setIssues([]);
  };

  return (
    <>
      <h1 className="sr-only">{title}</h1>
      {error ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {issues
        .filter((i) => !i.field.includes("."))
        .map((i, index) => (
          <Alert key={index} variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{m[i.code]}</AlertDescription>
          </Alert>
        ))}
      <div className="flex min-w-0 flex-col gap-2">
        <ContentEditorToolbar
          lang={lang}
          locale={tab}
          page={page}
          mobile={mobile}
          blocked={blocked}
          unsaved={hasUnsavedChanges}
          onPage={(next) => {
            setPage(next);
            setSectionKey(defaultSection(next)?.key ?? "");
            setSelection(null);
            setError("");
            setIssues([]);
          }}
          onLocale={setTab}
          onMobile={setMobile}
        />
        <p className="m-0 text-xs text-muted-foreground">{v.guidance}</p>
        <div className="grid items-start gap-3 min-[1100px]:grid-cols-[minmax(0,1fr)_340px]">
          <ContentPagePreview
            blocks={previewBlocks}
            locale={tab}
            lang={lang}
            page={page}
            mobile={mobile}
            selectedSection={section?.key}
            disabled={blocked}
            jobs={jobs}
            jobsTotal={jobsTotal}
            jobsFailed={jobsFailed}
            onSelect={selectContent}
          />
          <Card
            ref={inspector}
            variant="panel"
            className="flex max-h-[460px] min-w-0 flex-col overflow-hidden max-[1099px]:order-first min-[1100px]:max-h-[calc(var(--content-editor-height,620px)+10px)]"
          >
            {!section ? (
              <EmptyState icon={FileText} title={v.noSections} />
            ) : (
              <>
                <div className="flex shrink-0 flex-col items-start gap-3 border-b border-border p-5">
                  <FormField
                    label={v.section}
                    htmlFor="content-section"
                    className="w-full"
                  >
                    <NativeSelect
                      className="w-full"
                      id="content-section"
                      value={section.key}
                      disabled={blocked}
                      onChange={(event) => {
                        setSectionKey(event.target.value);
                        setSelection(null);
                        setError("");
                        setIssues([]);
                      }}
                    >
                      {sections.map((item) => {
                        const block = item.type
                          ? blocks.find((b) => b.type === item.type)
                          : undefined;
                        const changed =
                          !!block && signature(block) !== baselines[block.id];
                        return (
                          <NativeSelectOption key={item.key} value={item.key}>
                            {item.label[lang]}
                            {item.type ? "" : ` · ${v.fixed}`}
                            {changed ? " *" : ""}
                          </NativeSelectOption>
                        );
                      })}
                    </NativeSelect>
                  </FormField>
                  {selected ? (
                    <Badge
                      tone={
                        dirty ? "amber" : blockStateTone[selected.state].tone
                      }
                    >
                      {dirty
                        ? v.unsaved
                        : selected.state === "published"
                          ? blockStateTone.published.label[lang]
                          : v.saved}
                    </Badge>
                  ) : section.type ? null : (
                    <Badge tone="gray">{v.fixed}</Badge>
                  )}
                  <p className="m-0 text-xs text-muted-foreground">
                    {section.note[lang]}
                  </p>
                  {section.maxItems ? (
                    <p className="m-0 text-xs text-muted-foreground">
                      {v.maxItems(section.maxItems)}
                    </p>
                  ) : null}
                  {selected && !canEdit && (
                    <p className="m-0 text-xs text-muted-foreground">
                      {v.readOnly}
                    </p>
                  )}
                  {selected && contentUsage[selected.type].length > 1 ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{v.shared}:</span>
                      {contentUsage[selected.type].map((destination) => (
                        <button
                          key={destination}
                          type="button"
                          className="cursor-pointer text-primary underline underline-offset-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
                          disabled={blocked}
                          onClick={() => goToPage(destination)}
                        >
                          {v.pages[destination]}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {selected ? (
                    <p className="m-0 text-xs text-muted-foreground">
                      {v.scope}
                    </p>
                  ) : null}
                  {selected && canEdit && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        disabled={blocked || !dirty}
                        onClick={() => commit("save")}
                      >
                        <Save aria-hidden="true" />
                        {m.save}
                      </Button>
                      <Button
                        disabled={blocked || dirty}
                        onClick={() => commit("publish")}
                      >
                        <Send aria-hidden="true" />
                        {t.publish}
                      </Button>
                    </div>
                  )}
                </div>
                <div className="flex min-h-0 flex-col gap-4 overflow-auto p-5 max-sm:p-4">
                  {!section.type && section.manageHref ? (
                    <Link
                      href={`${section.manageHref}?lang=${lang}`}
                      className={buttonVariants({
                        variant: "outline",
                        className: "w-fit",
                      })}
                    >
                      <Briefcase aria-hidden="true" />
                      {v.manage}
                    </Link>
                  ) : null}
                  {section.type && !selected ? (
                    <div className="flex flex-col items-start gap-3">
                      <p className="m-0 text-sm text-muted-foreground">
                        {v.notCreated}
                      </p>
                      {canEdit && available.includes(section.type) ? (
                        <Button
                          variant="outline"
                          disabled={blocked}
                          onClick={() => commit("create", section.type!)}
                        >
                          <Plus aria-hidden="true" />
                          {v.createSection}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                  {selected ? (
                    <>
                      {(
                        [
                          ["title", t.titleLabel],
                          ["eyebrow", m.eyebrow],
                          ["body", t.bodyLabel],
                        ] as const
                      ).map(([field, label]) =>
                        section.fields.includes(field) &&
                        contentSections[selected.type].fields.includes(
                          field,
                        ) ? (
                          <div key={field}>{mainField(field, label)}</div>
                        ) : null,
                      )}
                      {section.fields.includes("image") &&
                      contentSections[selected.type].fields.includes(
                        "image",
                      ) ? (
                        <>
                          {mainField("imageAlt", m.alt)}
                          {fieldHint(lang, selected.type, "image") ? (
                            <small className="text-xs text-muted-foreground">
                              {fieldHint(lang, selected.type, "image")}
                            </small>
                          ) : null}
                          {picker()}
                          {fieldError("imageId")}
                        </>
                      ) : null}
                      {section.kinds.length > 0 ? (
                        <h2 className="m-0 text-sm font-semibold">{m.items}</h2>
                      ) : null}
                      {visibleItems.map(({ item, index }, position) => (
                        <fieldset
                          key={item.id}
                          className="m-0 grid min-w-0 gap-3 rounded-lg border border-border p-3"
                          data-editor-item={item.id}
                          disabled={!canEdit || blocked}
                        >
                          <legend className="px-1 text-[13px] font-medium">
                            {position + 1}. {item[tab].title || m.items}
                          </legend>
                          {itemKindChoices(item.kind).length > 1 ? (
                            <FormField
                              label={m.kind}
                              htmlFor={`kind-${item.id}`}
                            >
                              <NativeSelect
                                className="w-full"
                                id={`kind-${item.id}`}
                                value={item.kind}
                                onChange={(e) =>
                                  edit((d) => ({
                                    ...d,
                                    items: d.items.map((i) =>
                                      i.id === item.id
                                        ? {
                                            ...i,
                                            kind: e.target
                                              .value as ContentItem["kind"],
                                          }
                                        : i,
                                    ),
                                  }))
                                }
                              >
                                {itemKindChoices(item.kind).map((kind) => (
                                  <NativeSelectOption key={kind} value={kind}>
                                    {m.kinds[kind]}
                                  </NativeSelectOption>
                                ))}
                              </NativeSelect>
                            </FormField>
                          ) : null}
                          {itemFields(selected.type, item.kind)
                            .filter(
                              (field): field is "title" | "body" | "label" =>
                                field === "title" ||
                                field === "body" ||
                                field === "label",
                            )
                            .map((field) => (
                              <FormField
                                key={field}
                                label={
                                  field === "title"
                                    ? t.titleLabel
                                    : field === "body"
                                      ? t.bodyLabel
                                      : item.kind === "history"
                                        ? m.year
                                        : m.label
                                }
                              >
                                <Textarea
                                  data-editor-field={field}
                                  rows={field === "body" ? 5 : 2}
                                  className={
                                    field === "body"
                                      ? "max-h-80 min-h-32 field-sizing-content"
                                      : "min-h-14 field-sizing-content"
                                  }
                                  value={item[tab][field]}
                                  onChange={(e) =>
                                    edit((d) => ({
                                      ...d,
                                      items: d.items.map((i) =>
                                        i.id === item.id
                                          ? {
                                              ...i,
                                              [tab]: {
                                                ...i[tab],
                                                [field]: e.target.value,
                                                // A year doubles as the required
                                                // title of a timeline entry.
                                                ...(item.kind === "history" &&
                                                field === "label"
                                                  ? { title: e.target.value }
                                                  : {}),
                                              },
                                            }
                                          : i,
                                      ),
                                    }))
                                  }
                                />
                                {fieldError(`items.${index}.${tab}.${field}`)}
                                {item.kind === "history" && field === "label"
                                  ? fieldError(`items.${index}.${tab}.title`)
                                  : null}
                              </FormField>
                            ))}
                          {itemFields(selected.type, item.kind).includes(
                            "image",
                          ) ? (
                            <FormField label={m.alt}>
                              <Textarea
                                data-editor-field="imageAlt"
                                rows={2}
                                className="min-h-14 field-sizing-content"
                                value={item[tab].imageAlt}
                                onChange={(e) =>
                                  edit((d) => ({
                                    ...d,
                                    items: d.items.map((i) =>
                                      i.id === item.id
                                        ? {
                                            ...i,
                                            [tab]: {
                                              ...i[tab],
                                              imageAlt: e.target.value,
                                            },
                                          }
                                        : i,
                                    ),
                                  }))
                                }
                              />
                              {fieldError(`items.${index}.${tab}.imageAlt`)}
                            </FormField>
                          ) : null}
                          {itemFields(selected.type, item.kind).includes(
                            "image",
                          )
                            ? picker(item)
                            : null}
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!canEdit || blocked || position === 0}
                              onClick={() => move(position, -1)}
                            >
                              <ArrowUp aria-hidden="true" />
                              {m.up}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={
                                !canEdit ||
                                blocked ||
                                position === visibleItems.length - 1
                              }
                              onClick={() => move(position, 1)}
                            >
                              <ArrowDown aria-hidden="true" />
                              {m.down}
                            </Button>
                            <Button
                              variant="destructive-outline"
                              size="sm"
                              onClick={() =>
                                edit((d) => ({
                                  ...d,
                                  items: d.items.filter(
                                    (i) => i.id !== item.id,
                                  ),
                                }))
                              }
                            >
                              <Trash2 aria-hidden="true" />
                              {m.remove}
                            </Button>
                          </div>
                        </fieldset>
                      ))}
                      {canEdit ? (
                        <>
                          {section.kinds.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-2">
                              {section.kinds.length > 1 ? (
                                <NativeSelect
                                  className="w-44"
                                  aria-label={m.kind}
                                  disabled={blocked}
                                  value={
                                    section.kinds.includes(
                                      newKind as ContentItem["kind"],
                                    )
                                      ? newKind
                                      : section.kinds[0]
                                  }
                                  onChange={(e) =>
                                    setNewKind(
                                      e.target.value as ContentItem["kind"],
                                    )
                                  }
                                >
                                  {section.kinds.map((kind) => (
                                    <NativeSelectOption key={kind} value={kind}>
                                      {m.kinds[kind]}
                                    </NativeSelectOption>
                                  ))}
                                </NativeSelect>
                              ) : null}
                              <Button
                                variant="outline"
                                disabled={blocked || !canAdd}
                                onClick={() => {
                                  const kind = section.kinds.includes(
                                    newKind as ContentItem["kind"],
                                  )
                                    ? (newKind as ContentItem["kind"])
                                    : section.kinds[0];
                                  const empty = {
                                    title: "",
                                    body: "",
                                    label: "",
                                    imageAlt: "",
                                  };
                                  edit((d) => ({
                                    ...d,
                                    items: [
                                      ...d.items,
                                      {
                                        id: crypto.randomUUID(),
                                        kind,
                                        zh: { ...empty },
                                        en: { ...empty },
                                        imageId: null,
                                        locationFilter: "",
                                      },
                                    ],
                                  }));
                                }}
                              >
                                <Plus aria-hidden="true" />
                                {m.add}
                              </Button>
                            </div>
                          ) : null}
                          <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                            <Checkbox
                              checked={fallback[selected.id] ?? false}
                              onCheckedChange={(checked) =>
                                setFallback((current) => ({
                                  ...current,
                                  [selected.id]: checked,
                                }))
                              }
                            />
                            {m.fallback}
                          </label>
                          <p className="m-0 text-xs text-muted-foreground">
                            {m.dirty}
                          </p>
                          {selected.publishedAt ? (
                            <Button
                              variant="outline"
                              className="w-fit"
                              disabled={blocked || dirty}
                              onClick={() => commit("unpublish")}
                            >
                              <EyeOff aria-hidden="true" />
                              {m.unpublish}
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                      <a
                        href={`/admin/content?lang=${lang}`}
                        className="flex w-fit items-center gap-1.5 text-[13px] font-medium text-primary hover:underline"
                      >
                        <RotateCw className="size-3.5" aria-hidden="true" />
                        {m.reload}
                      </a>
                    </>
                  ) : null}
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
