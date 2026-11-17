/** Public-site shell. Descendant rules keep the old heading, paragraph, and link reset. */
export const publicSiteClass = [
  "bg-background text-base leading-[1.8] text-foreground",
  "[&_h1]:m-0 [&_h2]:m-0 [&_h3]:m-0 [&_p]:m-0 [&_dl]:m-0 [&_dd]:m-0",
  "[&_a]:no-underline",
  "[&_a]:[-webkit-tap-highlight-color:transparent] [&_button]:[-webkit-tap-highlight-color:transparent]",
  "[&_:is(a,button):focus-visible]:outline-2 [&_:is(a,button):focus-visible]:outline-offset-4 [&_:is(a,button):focus-visible]:outline-primary",
  "[&_:is(section,footer,#benefits)]:scroll-mt-24",
  "motion-reduce:[&_*]:!transition-none motion-reduce:[&_*]:!scroll-auto",
  "motion-reduce:[&_*::before]:!transition-none motion-reduce:[&_*::after]:!transition-none",
].join(" ");

export const siteContainerClass =
  "mx-auto w-full max-w-[1200px] px-[clamp(16px,4vw,40px)]";

export const skipLinkClass =
  "fixed top-2 left-4 z-[100] -translate-y-[150%] bg-background px-4 py-2 text-primary focus:translate-none";

/** Scroll-reveal targets. Motion is applied in SiteMotion; reduced motion stays visible. */
export const revealClass =
  "will-change-[opacity,transform] motion-reduce:!opacity-100 motion-reduce:!transform-none";

export function siteButtonClass(options?: {
  outline?: boolean;
  pill?: boolean;
  waiting?: boolean;
}) {
  return [
    "inline-flex min-h-12 items-center justify-center gap-1.5 border px-6 py-2.5 text-[15px] leading-snug font-medium whitespace-nowrap transition-colors duration-[120ms]",
    options?.waiting
      ? "disabled:cursor-wait disabled:opacity-60"
      : "disabled:cursor-not-allowed disabled:opacity-60",
    options?.pill ? "rounded-full" : "rounded-[2px]",
    options?.outline
      ? "border-primary bg-transparent text-primary hover:bg-secondary"
      : "border-transparent bg-primary text-primary-foreground hover:bg-brand-teal-hover",
  ].join(" ");
}

export const textLinkClass =
  "inline-flex min-h-11 min-w-11 items-center gap-1 text-[15px] font-medium text-primary hover:underline hover:underline-offset-[3px]";

export const eyebrowClass =
  "inline-flex items-center gap-3 font-sans text-[13px] leading-tight font-semibold tracking-[0.12em] text-foreground uppercase after:inline-block after:h-[1.5px] after:w-11 after:bg-brand-gold after:content-['']";

export const jobsPreviewNoteClass =
  "py-3 text-sm leading-normal text-[var(--site-ink-secondary)]";

export const jobsEmptyClass =
  "flex flex-col items-center gap-3 px-4 py-16 text-center [&_h1]:text-lg [&_h1]:leading-snug [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:leading-snug [&_h2]:font-semibold [&_p]:text-[var(--site-ink-secondary)]";

export const careersResultsClass = "pt-8 pb-[clamp(56px,7vw,96px)]";

export const jobResultBarClass =
  "flex min-h-11 items-center justify-between gap-4 border-b border-input pb-4 text-sm leading-normal text-muted-foreground";

export const jobClearClass =
  "min-h-11 cursor-pointer border-0 bg-transparent px-1 text-sm font-medium text-primary";

export const jobRowClass =
  "flex flex-wrap items-end justify-between gap-x-7 gap-y-5 border-b border-border py-7 text-foreground max-md:items-stretch max-md:gap-4 max-md:py-6";

export const jobDescriptionClass =
  "flex min-w-0 flex-1 basis-[min(100%,28rem)] flex-col gap-2.5 [&>span]:text-sm [&>span]:leading-normal [&>span]:text-muted-foreground";

export const jobTitleClass =
  "text-[length:clamp(17px,1.75vw,20px)] leading-snug font-semibold";

export const jobMetaClass =
  "m-0 text-[13px] leading-relaxed tracking-[0.01em] text-[var(--site-ink-secondary)]";

export const jobRowActionClass =
  "flex flex-wrap items-center justify-end gap-x-5 gap-y-4 max-md:w-full max-md:justify-between";

export const jobDeadlineClass =
  "text-right text-xs leading-snug text-muted-foreground max-md:flex-1 max-md:basis-48 max-md:text-left";

export const jobDeadlineLabelClass =
  "block text-[10px] font-semibold tracking-[0.06em] text-muted-foreground/85 uppercase";

export const jobDeadlineMutedClass =
  "text-right text-xs text-muted-foreground italic max-md:flex-1 max-md:basis-48 max-md:text-left";

export const jobPaginationClass =
  "flex items-center justify-between gap-3 pt-7 text-sm [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_a]:px-3 [&_a]:text-primary [&_a]:hover:underline [&_a]:hover:underline-offset-4 [&_span]:inline-flex [&_span]:min-h-11 [&_span]:items-center [&_span]:px-3 [&_[aria-disabled=true]]:text-[var(--site-ink-secondary)]";

export const relatedJobRowClass =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-border py-[22px] text-foreground hover:bg-muted";

export const relatedJobDescriptionClass =
  "flex min-w-0 flex-col gap-1.5 [&>span]:text-sm [&>span]:leading-normal [&>span]:text-muted-foreground";

export const closedJobClass =
  "flex flex-col gap-6 py-[clamp(48px,7vw,96px)] [&>p]:max-w-[60ch] [&>p]:text-[var(--site-ink-secondary)] [&_section]:mt-6 [&_section_h2]:mb-6";

export const closedJobTitleClass = "text-2xl text-foreground";

export const accountLayoutClass =
  "grid grid-cols-[repeat(auto-fit,minmax(min(100%,360px),1fr))] items-start gap-x-20 gap-y-10 py-[clamp(48px,7vw,96px)]";

export const accountIntroClass =
  "flex flex-col gap-5 [&_h1]:text-[length:var(--site-page-heading-size)] [&_h1]:leading-[1.12] [&_h1]:font-semibold [&_h1]:tracking-[-0.035em] [&>p:last-child]:text-[var(--site-ink-secondary)]";

export const accountCardClass =
  "min-w-0 rounded-[4px_28px_4px_4px] border border-border bg-card p-[clamp(24px,3vw,36px)] [&_fieldset]:m-0 [&_fieldset]:flex [&_fieldset]:min-w-0 [&_fieldset]:flex-col [&_fieldset]:gap-6 [&_fieldset]:border-0 [&_fieldset]:p-0";

export const accountFieldClass =
  "flex flex-col gap-2 [&_label]:text-sm [&_label]:leading-snug [&_label]:font-medium [&_label]:text-[var(--site-ink-secondary)] [&_input]:h-[46px] [&_input]:w-full [&_input]:min-w-0 [&_input]:rounded-[10px] [&_input]:border [&_input]:border-input [&_input]:bg-card [&_input]:px-3.5 [&_input]:text-base [&_input]:text-foreground [&_input]:outline-none [&_input]:focus-visible:outline-2 [&_input]:focus-visible:outline-offset-2 [&_input]:focus-visible:outline-primary";

export const accountNoteClass =
  "text-sm leading-relaxed text-[var(--site-ink-secondary)]";

export const statusPageClass = "grid min-h-[70svh] place-items-center px-6 py-[clamp(48px,8vw,100px)]";

export const statusPanelClass = "w-full max-w-[620px] text-center";

export const statusCodeClass =
  "!mb-6 font-sans text-[clamp(100px,20vw,180px)] leading-[0.9] tracking-[-0.04em] text-[var(--site-accent,#3d6b52)] opacity-35";

export const statusTitleClass =
  "!mt-3 text-[length:clamp(28px,5vw,44px)]";

export const statusDescriptionClass =
  "!mt-5 leading-relaxed text-[var(--site-ink-secondary,#4b5a51)]";

export const statusActionsClass =
  "mt-8 flex flex-wrap justify-center gap-3 max-[480px]:[&>*]:w-full max-[480px]:[&>*]:justify-center";
