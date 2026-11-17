import { Monitor, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { FormField } from "./ui/form-field";
import { Segmented } from "./ui/segmented";
import type { AdminLang } from "@/lib/admin/nav";
import {
  contentPreviewText,
  type ContentPreviewPage,
} from "@/lib/admin/contentPreview";

type Props = {
  lang: AdminLang;
  locale: AdminLang;
  page: ContentPreviewPage;
  mobile: boolean;
  blocked: boolean;
  unsaved: boolean;
  onPage: (page: ContentPreviewPage) => void;
  onLocale: (locale: AdminLang) => void;
  onMobile: (mobile: boolean) => void;
};

// Keep preview controls separate from section editing and publication commands.
// Switching page, language or viewport preserves the workspace's unsaved drafts.
export function ContentEditorToolbar({
  lang,
  locale,
  page,
  mobile,
  blocked,
  unsaved,
  onPage,
  onLocale,
  onMobile,
}: Props) {
  const t = contentPreviewText[lang];
  return (
    <Card
      variant="panel"
      className="flex-row flex-wrap items-end gap-x-4 gap-y-3 px-3 py-2.5 max-sm:p-3"
    >
      <FormField label={t.page} htmlFor="content-page" className="min-w-36 flex-1">
        <NativeSelect
          className="w-full"
          id="content-page"
          value={page}
          disabled={blocked}
          onChange={(event) => onPage(event.target.value as ContentPreviewPage)}
        >
          {Object.entries(t.pages).map(([value, label]) => (
            <NativeSelectOption key={value} value={value}>
              {label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </FormField>
      <FormField label={t.language} htmlFor="content-locale" className="min-w-36 flex-1">
        <NativeSelect
          className="w-full"
          id="content-locale"
          value={locale}
          disabled={blocked}
          onChange={(event) => onLocale(event.target.value as AdminLang)}
        >
          <NativeSelectOption value="en">English</NativeSelectOption>
          <NativeSelectOption value="zh">中文</NativeSelectOption>
        </NativeSelect>
      </FormField>
      <Segmented
        label={t.preview}
        value={mobile ? "mobile" : "desktop"}
        onChange={(value) => onMobile(value === "mobile")}
        options={[
          {
            value: "desktop",
            label: (
              <span className="inline-flex items-center gap-1.5">
                <Monitor className="size-4" aria-hidden="true" />
                {t.desktop}
              </span>
            ),
          },
          {
            value: "mobile",
            label: (
              <span className="inline-flex items-center gap-1.5">
                <Smartphone className="size-4" aria-hidden="true" />
                {t.mobile}
              </span>
            ),
          },
        ]}
      />
      <Badge
        tone={unsaved ? "amber" : "gray"}
        role="status"
        className="mb-2 ml-auto"
      >
        {unsaved ? t.unsaved : t.draft}
      </Badge>
    </Card>
  );
}
