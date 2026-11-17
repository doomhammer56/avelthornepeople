import Link from "next/link";
import type { HomeContent, Locale } from "@/lib/homeContent";
import { BrandLockup } from "./BrandLockup";
import { RecruitmentCta } from "./jobs/RecruitmentCta";
import { siteContainerClass } from "@/lib/publicSite";

type Props = {
  locale: Locale;
  content: Pick<
    HomeContent,
    | "brand"
    | "footer_p"
    | "footer_cols"
    | "f_items"
    | "icp"
    | "band_h"
    | "band_p"
    | "cta_jobs"
  >;
  /** Omit the jobs band (e.g. design-system gallery already demos it). */
  includeCta?: boolean;
};

export function SiteFooter({
  locale,
  content: t,
  includeCta = true,
}: Props) {
  const links = [
    [`/${locale}/about`, `/${locale}/services`, `/${locale}/contact`],
    [`/${locale}/careers`, `/${locale}/careers?type=Internship`],
  ];

  return (
    <>
      {includeCta ? <RecruitmentCta locale={locale} content={t} /> : null}
      <footer id="site-footer" className="site-footer bg-brand-navy text-white">
        <div className={`${siteContainerClass} pt-12 pb-8 sm:pt-14 sm:pb-9 lg:pt-16 lg:pb-10`}>
          <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,0.7fr))] lg:gap-x-16 lg:gap-y-0">
            <div className="max-w-sm">
              <Link
                href={`/${locale}`}
                className="flex w-fit rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                aria-label={t.brand}
              >
                <BrandLockup variant="light" />
              </Link>
              <p className="mt-10 text-sm leading-relaxed text-white/55 max-w-[34ch]">
                {t.footer_p}
              </p>
            </div>

            {t.footer_cols.map((title, index) => (
              <nav
                key={title}
                aria-label={title}
                className="flex flex-col gap-3 sm:gap-3.5"
              >
                <h2 className="text-sm font-semibold text-white">{title}</h2>
                {t.f_items[index].map((label, item) => (
                  <Link
                    key={label}
                    href={links[index][item]}
                    className="text-sm text-white/55 hover:text-white transition-colors w-fit"
                  >
                    {label}
                  </Link>
                ))}
              </nav>
            ))}
          </div>

          <div className="mt-10 sm:mt-12 pt-5 border-t border-white/5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs text-white/40">
            <p>
              © 2026 {t.brand} · {t.icp}
            </p>
            <p>
              {locale === "en" ? "Privacy policy" : "隐私政策"}
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
