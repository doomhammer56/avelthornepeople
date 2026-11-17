import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { publishedContent } from "./service.ts";
import type { CompanyContent } from "../../lib/content/public.ts";
const cachedPublishedContent = unstable_cache(
  (locale: "en" | "zh") => publishedContent(locale),
  ["company-content-v1"],
  { revalidate: 30, tags: ["company-content"] },
);
// Request dedupe only. The publication itself is cached for 30 seconds and
// dropped as soon as an editor publishes, so pages can prerender.
export const getCompanyContent = cache(
  async (locale: "en" | "zh"): Promise<CompanyContent> => {
    try {
      const blocks = await cachedPublishedContent(locale);
      return {
        blocks: Object.fromEntries(blocks.map((block) => [block.type, block])),
        failed: false,
      };
    } catch {
      return { blocks: {}, failed: true };
    }
  },
);
