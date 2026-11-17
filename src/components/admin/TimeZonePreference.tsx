"use client";
import { useId, useMemo } from "react";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { FormField } from "./ui/form-field";
import type { AdminLang } from "@/lib/admin/nav";
import { useAdminTimeZone } from "@/lib/admin/useAdminTimeZone";
import { availableTimeZones } from "@/lib/admin/timeZone";
export const timeZoneContent = {
  en: {
    title: "Scheduling timezone",
    automatic: "Automatic",
    detecting: "Detecting your timezone…",
    help: "Defaults to your browser timezone. Your selection is saved in this browser and applies to job scheduling. Changing it keeps postings scheduled for the same moment.",
    hint: "Enter dates and times in the timezone shown beside each field.",
  },
  zh: {
    title: "排期时区",
    automatic: "自动检测",
    detecting: "正在检测您的时区…",
    help: "默认使用浏览器时区。手动选择会保存在此浏览器中并用于职位排期。切换时区不会改变已排定的实际时间。",
    hint: "请输入所选时区的日期和时间。每个字段旁均显示时区。",
  },
} as const;
export function TimeZonePreference({
  lang,
  onChange,
  disabled = false,
}: {
  lang: AdminLang;
  onChange?: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const zone = useAdminTimeZone(),
    t = timeZoneContent[lang];
  const options = useMemo(
    () => availableTimeZones(zone.timeZone),
    [zone.timeZone],
  );
  return (
    <div className="flex max-w-md flex-col gap-1.5">
      <FormField label={t.title} htmlFor={id} hint={t.help}>
        <NativeSelect
          className="w-full"
          id={id}
          value={zone.preference}
          disabled={disabled || !zone.ready}
          onChange={(e) =>
            onChange
              ? onChange(e.target.value)
              : zone.setPreference(e.target.value)
          }
        >
          <NativeSelectOption value="">
            {zone.ready ? `${t.automatic} (${zone.detected})` : t.detecting}
          </NativeSelectOption>
          {zone.ready
            ? options.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </NativeSelectOption>
              ))
            : null}
        </NativeSelect>
      </FormField>
    </div>
  );
}
