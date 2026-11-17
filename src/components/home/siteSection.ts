import { siteContainerClass } from "@/lib/publicSite";

/** Shared vertical rhythm for homepage sections (Tailwind-only). */
export const homeSectionClass = `${siteContainerClass} py-24 sm:py-32 lg:py-40`;

/** Soft gold rule between stacked homepage sections. */
export const homeSectionRuleClass = "border-t border-brand-gold/30";

/** Container + rule for standard homepage sections after the hero. */
export const homeSectionWithRuleClass = `${homeSectionClass} ${homeSectionRuleClass}`;
