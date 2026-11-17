"use client";

import {
  useEffect,
  useRef,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from "react";
import { useAdminRouter as useRouter } from "./AdminNavigation";
import {
  instantFilterHref,
  instantFilterText,
  type InstantFilterAction,
} from "@/lib/admin/instantFilters";
import type { AdminLang } from "@/lib/admin/nav";

type Props = {
  action: InstantFilterAction;
  className: string;
  lang: AdminLang;
  children: ReactNode;
  onApply?: (href: string) => void;
};
const subscribe = () => () => {};

// Enhance existing GET filters without changing their server-side queries or permissions.
// Dropdowns apply immediately, while text waits briefly and incomplete UUIDs remain local.
export function InstantFilterForm({
  action,
  className,
  lang,
  children,
  onApply,
}: Props) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composing = useRef(false);
  const [pending, startTransition] = useTransition();
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  // Cancel queued searches when the form disappears or another field changes.
  // A stale timer must not navigate away from a later page or selection.
  function cancel() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Let explicit navigation cancel any search still waiting for its typing delay.
  // A queued filter must not send the visitor back after they choose a different page.
  useEffect(() => {
    const cancelQueued = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
    const followLink = (event: MouseEvent) => {
      if ((event.target as HTMLElement | null)?.closest?.("a[href]"))
        cancelQueued();
    };
    document.addEventListener("click", followLink, true);
    window.addEventListener("popstate", cancelQueued);
    return () => {
      document.removeEventListener("click", followLink, true);
      window.removeEventListener("popstate", cancelQueued);
    };
  }, []);

  // Read all current controls together so rapid selections cannot overwrite each other.
  // Replacing history keeps typing from creating an entry for every submitted phrase.
  function apply(form: HTMLFormElement) {
    cancel();
    if (!form.checkValidity()) return;
    const href = instantFilterHref(action, new FormData(form));
    if (!href) return;
    const current = new URL(window.location.href);
    current.searchParams.sort();
    if (href === `${current.pathname}${current.search}`) return;
    startTransition(() => {
      if (onApply) onApply(href);
      else router.replace(href, { scroll: false });
    });
  }

  // Wait for composition to finish before searching Chinese or other composed text.
  // Select changes bypass the typing delay without submitting unfinished identifier fields.
  function schedule(form: HTMLFormElement, immediate = false) {
    cancel();
    if (composing.current) return;
    if (immediate) apply(form);
    else timer.current = setTimeout(() => apply(form), 350);
  }

  return (
    <form
      action={action}
      method="get"
      className={`instant-filter-form ${className}`}
      data-enhanced={hydrated}
      aria-busy={pending}
      onChange={(event) =>
        schedule(
          event.currentTarget,
          event.target.tagName === "SELECT" ||
            event.target.getAttribute("type") === "checkbox",
        )
      }
      onSubmit={(event) => {
        event.preventDefault();
        apply(event.currentTarget);
      }}
      onCompositionStart={() => {
        composing.current = true;
        cancel();
      }}
      onCompositionEnd={(event) => {
        composing.current = false;
        schedule(event.currentTarget);
      }}
    >
      {children}
      {pending && (
        <span role="status" className="sr-only">
          {instantFilterText[lang].updating}
        </span>
      )}
    </form>
  );
}
