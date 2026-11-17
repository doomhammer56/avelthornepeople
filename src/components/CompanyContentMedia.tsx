import Image from "next/image";
import type {
  ContentImage,
  ContentType,
  PublicContentBlock,
} from "@/lib/content/contract";
import { companyImageSource } from "@/lib/content/illustrations";
import { jobsPreviewNoteClass, siteContainerClass } from "@/lib/publicSite";
export function CompanyImage({
  image,
  alt,
  className = "",
  hero = false,
  illustration,
  locale = "en",
}: {
  image: ContentImage | null | undefined;
  alt: string;
  className?: string;
  hero?: boolean;
  illustration?: ContentType;
  locale?: "en" | "zh";
}) {
  const source = companyImageSource(image, alt, illustration, locale);
  if (!source) return null;
  return (
    <div
      className={className}
      style={{
        position: "relative",
        overflow: "hidden",
        minHeight: hero ? 320 : 160,
      }}
    >
      <Image
        src={source.src}
        alt={source.alt}
        fill
        sizes={
          hero
            ? "(max-width: 900px) 100vw, 50vw"
            : "(max-width: 900px) 100vw, 33vw"
        }
        unoptimized
        style={{ objectFit: "cover" }}
      />
    </div>
  );
}
export function CompanyFallback({
  block,
}: {
  block: PublicContentBlock | undefined;
}) {
  return block?.englishFallback ? (
    <p className={jobsPreviewNoteClass} lang="en">
      English version not available; showing Chinese.
    </p>
  ) : null;
}
export function CompanyUnavailable({
  failed,
  locale,
}: {
  failed: boolean;
  locale: "en" | "zh";
}) {
  return failed ? (
    <p className={`${siteContainerClass} ${jobsPreviewNoteClass}`} role="status">
      {locale === "en"
        ? "Company information is temporarily unavailable."
        : "公司信息暂时不可用。"}
    </p>
  ) : null;
}
