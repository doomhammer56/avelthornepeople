"use client";

import { useEffect } from "react";

const REVEAL_DISTANCE_PX = 40;
/** Portion of the viewport used to ease each [data-reveal] in. */
const REVEAL_BAND = 0.3;

// Progressive one-by-one scroll reveal for [data-reveal], plus the header
// progress bar. Refresh targets on navigation; reduced-motion stays static.
export function SiteMotion({ pageKey }: { pageKey: string }) {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-public-site]");
    if (!root) return;

    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const progress = root.querySelector<HTMLElement>("[data-scroll-progress]");
    const clamp = (value: number) => Math.max(0, Math.min(1, value));
    let reveals: HTMLElement[] = [];
    let frame = 0;
    let disposed = false;

    const collect = () => {
      reveals = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    };

    const update = () => {
      frame = 0;
      const height = window.innerHeight;
      const scroll = window.scrollY;
      const reduced = preference.matches;
      const max = Math.max(1, document.documentElement.scrollHeight - height);

      if (progress)
        progress.style.transform = `scaleX(${clamp(scroll / max)})`;

      reveals.forEach((element) => {
        if (reduced) {
          element.style.opacity = "1";
          element.style.transform = "none";
          return;
        }
        const amount = clamp(
          (height - element.getBoundingClientRect().top) /
            (height * REVEAL_BAND),
        );
        element.style.opacity = String(amount);
        element.style.transform = `translateY(${(1 - amount) * REVEAL_DISTANCE_PX}px)`;
      });
    };

    const schedule = () => {
      if (!disposed && !frame) frame = window.requestAnimationFrame(update);
    };

    collect();
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    preference.addEventListener("change", schedule);
    void document.fonts.ready.then(schedule);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      preference.removeEventListener("change", schedule);
    };
  }, [pageKey]);

  return null;
}
