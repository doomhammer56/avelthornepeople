"use client";

import { useId } from "react";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "./ui/form-field";
import type { AdminLang } from "@/lib/admin/nav";
import type { JobRecruiting } from "@/server/jobs/management-contract";
import {
  genderOptions,
  priorityOptions,
  recruitingNoteFields,
  recruitingTextLimit,
} from "@/lib/admin/jobImport/columns";

const content = {
  en: {
    title: "Recruiting details",
    note: "For the recruiting team only. These are never shown on the public site.",
    priority: "Priority",
    gender: "Gender requirement",
    none: "Not set",
    language: { zh: "Chinese", en: "English" },
  },
  zh: {
    title: "招聘详情",
    note: "仅招聘团队内部使用，不会在官网显示。",
    priority: "优先级",
    gender: "性别要求",
    none: "未设置",
    language: { zh: "中文", en: "English" },
  },
} as const;

type Props = {
  lang: AdminLang;
  tab: "zh" | "en";
  value: JobRecruiting | undefined;
  disabled: boolean;
  onChange: (next: JobRecruiting) => void;
};

// Editing happens per language tab, matching the title and content above it.
export function JobRecruitingFields({
  lang,
  tab,
  value,
  disabled,
  onChange,
}: Props) {
  const t = content[lang];
  const id = useId();
  const current = value ?? {};
  return (
    <fieldset
      className="m-0 grid gap-4 rounded-lg border border-border p-4"
      disabled={disabled}
    >
      <legend className="px-1 text-sm font-semibold">{t.title}</legend>
      <p className="m-0 text-xs text-muted-foreground">{t.note}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t.priority} htmlFor={`${id}-priority`}>
          <NativeSelect
            className="w-full"
            id={`${id}-priority`}
            value={current.priority ?? ""}
            onChange={(event) =>
              onChange({ ...current, priority: event.target.value || null })
            }
          >
            <NativeSelectOption value="">{t.none}</NativeSelectOption>
            {priorityOptions.map((option) => (
              <NativeSelectOption key={option.code} value={option.code}>
                {option[lang]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label={t.gender} htmlFor={`${id}-gender`}>
          <NativeSelect
            className="w-full"
            id={`${id}-gender`}
            value={current.gender ?? ""}
            onChange={(event) =>
              onChange({ ...current, gender: event.target.value || null })
            }
          >
            <NativeSelectOption value="">{t.none}</NativeSelectOption>
            {genderOptions.map((option) => (
              <NativeSelectOption key={option.code} value={option.code}>
                {option[lang]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
      </div>
      {recruitingNoteFields.map((field) => (
        <FormField
          key={field.field}
          label={`${field.label[lang]} (${t.language[tab]})`}
          htmlFor={`${id}-${field.field}`}
        >
          <Textarea
            id={`${id}-${field.field}`}
            rows={4}
            className="min-h-28 max-h-80 field-sizing-content"
            maxLength={recruitingTextLimit}
            value={current[field.field]?.[tab] ?? ""}
            onChange={(event) =>
              onChange({
                ...current,
                [field.field]: {
                  ...current[field.field],
                  [tab]: event.target.value,
                },
              })
            }
          />
        </FormField>
      ))}
    </fieldset>
  );
}
