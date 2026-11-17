import Link from "next/link";
import {
  eyebrowClass,
  siteButtonClass,
  statusActionsClass,
  statusCodeClass,
  statusDescriptionClass,
  statusPageClass,
  statusPanelClass,
  statusTitleClass,
} from "@/lib/publicSite";

export function StatusPanel({
  code,
  title,
  description,
  children,
}: {
  code: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main className={statusPageClass} id="main-content">
      <div className={statusPanelClass}>
        <p className={statusCodeClass} aria-hidden="true">
          {code}
        </p>
        <p className={eyebrowClass}>Tricore Customer Care LLC</p>
        <h1 className={statusTitleClass}>{title}</h1>
        <p className={statusDescriptionClass}>{description}</p>
        <div className={statusActionsClass}>{children}</div>
      </div>
    </main>
  );
}

export function StatusLink({
  href,
  children,
  secondary = false,
}: {
  href: string;
  children: React.ReactNode;
  secondary?: boolean;
}) {
  return (
    <Link
      className={siteButtonClass({ outline: secondary })}
      href={href}
    >
      {children}
    </Link>
  );
}
