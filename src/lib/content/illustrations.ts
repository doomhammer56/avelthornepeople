import type { ContentImage, ContentType } from "./contract.ts";

// Fixed catalogue of public default artwork in the private company-content bucket.
// User uploads use separate UUID keys and the draft/publication image routes.
export const companyIllustrations: Record<
  ContentType,
  { file: string; en: string; zh: string }
> = {
  BANNER: {
    file: "workspace",
    en: "Minimal illustration of a quiet workspace with an arched window, desk and plant.",
    zh: "极简工作空间插画，包含拱形窗、书桌和绿植。",
  },
  PROFILE: {
    file: "connected-cities",
    en: "Abstract city buildings connected by a curved route.",
    zh: "由弧线路径连接的抽象城市建筑。",
  },
  CULTURE: {
    file: "shared-values",
    en: "Balanced arches connected by a shared bridge, symbolizing collaboration.",
    zh: "平衡的拱门由桥梁连接，象征协作。",
  },
  BENEFIT: {
    file: "room-to-grow",
    en: "A growing plant beside ascending steps, symbolizing career development.",
    zh: "绿植与向上的阶梯，象征职业成长。",
  },
  LOCATION: {
    file: "global-connections",
    en: "An abstract globe with connections across locations.",
    zh: "带有跨地区连接线的抽象地球。",
  },
  TEAM: {
    file: "better-together",
    en: "Abstract figures gathered around a table, symbolizing teamwork.",
    zh: "抽象人物围坐桌旁，象征团队合作。",
  },
};

export function companyImageSource(
  image: ContentImage | null | undefined,
  alt: string,
  illustration?: ContentType,
  locale: "en" | "zh" = "en",
) {
  if (image) return { src: image.url, alt };
  if (!illustration) return null;
  const asset = companyIllustrations[illustration];
  return {
    src: `/api/content/illustrations/${asset.file}`,
    alt: asset[locale],
  };
}

export function illustrationObjectKey(name: string) {
  return Object.values(companyIllustrations).some(
    (asset) => asset.file === name,
  )
    ? `illustrations/v1/${name}.webp`
    : null;
}
