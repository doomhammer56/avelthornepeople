import Image from "next/image";
import type { ContentImage } from "@/lib/content/contract";
import type { ServiceItem } from "@/lib/servicesContent";
import { displayHeadingClass } from "@/lib/displayTypography";
import { cn } from "cn";
import { revealClass } from "@/lib/publicSite";

type Props = {
  service: ServiceItem;
  index: number;
  cmsImage?: ContentImage | null;
  className?: string;
};

export function ServiceDetailRow({
  service,
  index,
  cmsImage,
  className,
}: Props) {
  const headingId = `service-${index}`;
  const photoSrc = cmsImage?.url || service.photo;
  /** Even rows: copy left, image right (matches design reference). */
  const imagePosition = index % 2 === 0 ? "end" : "start";

  const copy = (
    <div className="flex min-w-0 flex-col gap-3 sm:gap-4">
      <div className="inline-flex items-center gap-3">
        <span
          className="font-sans text-sm font-medium tracking-[0.2em] text-brand-teal tabular-nums"
          aria-hidden
        >
          {String(index + 1).padStart(2, "0")}
        </span>
        <span
          className="inline-block h-px w-6 shrink-0 bg-brand-gold sm:w-8"
          aria-hidden
        />
      </div>
      <h2
        id={headingId}
        className={cn(displayHeadingClass, "m-0 text-balance leading-[1.15]")}
      >
        {service.title}
      </h2>
      <p className="m-0 max-w-md text-sm leading-relaxed text-muted-foreground whitespace-pre-line sm:text-base">
        {service.description}
      </p>
    </div>
  );

  const figure = (
    <div className="relative aspect-[4/3] w-full min-w-0 overflow-hidden rounded-xl bg-secondary">
      <Image
        src={photoSrc}
        alt={service.imageAlt}
        fill
        unoptimized
        sizes="(max-width: 1024px) 100vw, 50vw"
        className="object-cover object-center"
      />
    </div>
  );

  return (
    <section
      data-reveal
      aria-labelledby={headingId}
      className={cn(
        revealClass,
        "grid grid-cols-1 items-center gap-8 sm:gap-10 lg:grid-cols-2 lg:gap-12 xl:gap-16",
        "py-8 sm:py-10 lg:py-12",
        className,
      )}
    >
      {imagePosition === "start" ? (
        <>
          {figure}
          {copy}
        </>
      ) : (
        <>
          {copy}
          {figure}
        </>
      )}
    </section>
  );
}
