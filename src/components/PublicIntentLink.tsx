"use client";

import Link from "next/link";
import type { ComponentProps } from "react";

function publicHref(href: ComponentProps<typeof Link>["href"]) {
  return typeof href === "string" &&
    /^\/(en|zh)(?:\/|$)/.test(href) &&
    !/\/(login|signup)(?:\/|$)/.test(href)
    ? href
    : null;
}

// Prefetch public routes as soon as their links are on screen.
// Account pages stay out of that warmup because they are not part of the indexed site.
export function PublicIntentLink({
  href,
  prefetch,
  ...props
}: ComponentProps<typeof Link>) {
  const warmed = publicHref(href);
  return (
    <Link
      {...props}
      href={href}
      prefetch={warmed ? true : prefetch}
    />
  );
}
