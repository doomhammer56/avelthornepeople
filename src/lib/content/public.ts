import type { PublicContentBlock, ContentType } from "./contract.ts";
import type { HomeContent } from "../homeContent.ts";
import type { AboutContent } from "../aboutContent.ts";
import type { ServicesContent } from "../servicesContent.ts";
export type CompanyContent = {
  blocks: Partial<Record<ContentType, PublicContentBlock>>;
  failed: boolean;
};

/** Fixture shell used while a publication is still loading. */
export const shellCompany: CompanyContent = { blocks: {}, failed: false };

/** Split plain text on blank lines. A single line break stays inside its paragraph. */
export function paragraphs(value: string | undefined): string[] {
  return (value ?? "")
    .split(/\r?\n[^\S\r\n]*\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

const BENEFIT_ICONS = [
  "meaningful-work",
  "learning-growth",
  "collaborative-team",
  "work-life-balance",
  "supportive-culture",
] as const;

/**
 * Compose the public site copy for the homepage-owned sections.
 *
 * Each section follows the same rule: when its block is published the CMS text
 * is used as-is (so an editor can clear or shorten it); when it is not
 * published, the approved fixture copy remains. No published text is ever
 * second-guessed or replaced by fixtures.
 *
 *  BANNER  → hero headline (one line per row), lead paragraph(s)
 *  PROFILE → company paragraphs ("Our Company"), service cards
 *  CULTURE → culture eyebrow, heading and value cards
 *  BENEFIT → benefits eyebrow, heading and one card per item
 *  LOCATION→ office cards (not currently drawn by the public layout)
 */
export function companyHome(
  base: HomeContent,
  { blocks: b }: CompanyContent,
): HomeContent {
  const banner = b.BANNER,
    profile = b.PROFILE,
    culture = b.CULTURE,
    benefit = b.BENEFIT,
    location = b.LOCATION;

  const heroLines = (banner?.text.title ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const heroBody = paragraphs(banner?.text.body);
  const aboutBody = paragraphs(profile?.text.body);

  const services =
    profile?.items
      .filter((i) => i.kind === "service" && i.text.title)
      .map((i) => ({
        title: i.text.title,
        description: i.text.body,
        tags: i.text.label,
      })) ?? [];
  const values =
    culture?.items
      .filter((i) => i.text.title)
      .map((i): [string, string] => [i.text.title, i.text.body]) ?? [];
  const benefits =
    benefit?.items
      .filter((i) => i.text.title)
      .map((i, index) => ({
        icon:
          base.benefits[index]?.icon ??
          BENEFIT_ICONS[index % BENEFIT_ICONS.length],
        label: i.text.title,
      })) ?? [];
  const offices =
    location?.items
      .filter((i) => i.text.title)
      .map((i) => ({
        city: i.text.title,
        description: i.text.body,
        filterValue: i.locationFilter || i.text.title,
      })) ?? [];

  return {
    ...base,
    hero_eyebrow: banner?.text.eyebrow || base.hero_eyebrow,
    ...(heroLines.length
      ? { hero_h: heroLines.join(" "), hero_lines: heroLines }
      : {}),
    ...(heroBody.length
      ? { hero_p: heroBody[0], hero_p2: heroBody.slice(1).join("\n\n") }
      : {}),
    services: services.length ? services : base.services,
    ...(aboutBody.length
      ? { about_p1: aboutBody[0], about_p2: aboutBody.slice(1).join("\n\n") }
      : {}),
    values_eyebrow: culture?.text.eyebrow || base.values_eyebrow,
    values_h: culture?.text.title || base.values_h,
    values: values.length ? values : base.values,
    offices_h: location?.text.title || base.offices_h,
    offices: offices.length ? offices : base.offices,
    benefits_eyebrow: benefit?.text.eyebrow || base.benefits_eyebrow,
    benefits_h: benefit?.text.title || base.benefits_h,
    benefits: benefits.length ? benefits : base.benefits,
  };
}

/**
 * Services page: PROFILE service cards replace the fixture rows one-for-one.
 * Page title and intro stay application copy; a card without its own image
 * keeps the approved photograph for that row.
 */
export function companyServices(
  base: ServicesContent,
  { blocks }: CompanyContent,
): ServicesContent {
  const cmsServices =
    blocks.PROFILE?.items.filter(
      (item) => item.kind === "service" && item.text.title,
    ) ?? [];

  return {
    ...base,
    services: cmsServices.length
      ? cmsServices.map((item, index) => {
          const fallback = base.services[index];
          return {
            title: item.text.title,
            description: item.text.body,
            points: item.text.label
              ? item.text.label.split(/\r?\n/).filter(Boolean)
              : (fallback?.points ?? []),
            photo: fallback?.photo ?? servicePhotoFallback(index),
            imageAlt: item.text.imageAlt || fallback?.imageAlt || "",
          };
        })
      : base.services,
  };
}

function servicePhotoFallback(index: number) {
  return (
    [
      "/photos/service-customer-operations-1280w.webp",
      "/photos/service-risk-compliance-1280w.webp",
      "/photos/service-technology-1280w.webp",
    ][index] ?? "/photos/service-customer-operations-1280w.webp"
  );
}

/**
 *  PROFILE title/eyebrow → About page header
 *  PROFILE body          → introduction (first paragraph) and company section
 *  PROFILE mission items → Mission & Vision columns
 *  PROFILE history items → timeline
 */
export function companyAbout(
  base: AboutContent,
  { blocks: b }: CompanyContent,
): AboutContent {
  const profile = b.PROFILE;
  const cmsMission =
    profile?.items
      .filter(
        (i) => (i.kind === "mission" || i.kind === "card") && i.text.title,
      )
      .map((i) => ({ label: i.text.title, statement: i.text.body })) ?? [];
  const cmsHistory =
    profile?.items
      .filter((i) => i.kind === "history" && i.text.label)
      .map((i) => ({
        year: i.text.label,
        description: i.text.body || i.text.title,
      })) ?? [];

  return {
    ...base,
    title: profile?.text.title || base.title,
    introduction: paragraphs(profile?.text.body)[0] || base.introduction,
    eyebrow: profile?.text.eyebrow || base.eyebrow,
    mission: cmsMission.length ? cmsMission : base.mission,
    history: cmsHistory.length ? cmsHistory : base.history,
  };
}
