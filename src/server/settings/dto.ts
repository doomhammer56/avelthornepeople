import type { ReferenceItem } from "../../lib/admin/referenceData.ts";

export function referenceDto(row: Record<string, unknown>): ReferenceItem {
  return {
    id: String(row.id),
    code: String(row.code),
    version: Number(row.version),
    label: {
      en: typeof row.name_en === "string" ? row.name_en : "",
      zh: String(row.name_zh),
    },
    active: row.active === true,
    ...(row.country_code
      ? {
          countryCode: String(row.country_code),
          timeZone: String(row.timezone),
          addressEn: String(row.address_en ?? ""),
          addressZh: String(row.address_zh ?? ""),
        }
      : {}),
  };
}
