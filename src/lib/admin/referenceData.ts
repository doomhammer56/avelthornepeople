import type { AdminLang } from "./nav";

export type ReferenceItem = {
  id: string;
  code: string;
  version: number;
  countryCode?: string;
  timeZone?: string;
  addressEn?: string;
  addressZh?: string;
  label: { en: string; zh: string };
  active: boolean;
};

export type ReferenceCategory =
  "department" | "location" | "jobType" | "experience";

// Resolves an id to its label from the live managed list, falling back to the
// raw id if the reference was since removed — a job never loses its value,
// it just shows the stored id until someone restores or re-maps it.
export function referenceLabel(
  items: ReferenceItem[],
  id: string,
  lang: AdminLang,
): string {
  return (
    items.find((item) => item.id === id || item.code === id)?.label[lang] ?? id
  );
}
