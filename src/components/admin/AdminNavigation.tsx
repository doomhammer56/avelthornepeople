"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { adminDataChanged } from "@/lib/admin/cacheEvents";
import { useQueryClient } from "@tanstack/react-query";
import { isAdminQueryNavigation } from "@/lib/admin/linkNavigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ComponentProps,
  type ReactNode,
} from "react";

type Navigation = {
  run: (action: () => void) => void;
  loading: (token: symbol, active: boolean) => void;
  prefetch: (href: string) => boolean;
};
const NavigationContext = createContext<Navigation | null>(null);

// Screens worth warming once the shell is idle, with the permission each needs.
// Only default views are warmed; the query cache's own stale times decide
// whether a request is actually sent, so revisiting costs nothing extra.
const warmTargets = [
  { href: "/admin/jobs", permission: "jobs.read" },
  { href: "/admin", permission: "dashboard.read" },
  { href: "/admin/applications", permission: "applications.read" },
] as const;

export function AdminNavigationProvider({
  role,
  children,
}: {
  role?: string;
  children: ReactNode;
}) {
  const client = useQueryClient();
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState<Set<symbol>>(() => new Set());
  const prefetched = useRef(new Map<string, number>());
  // Warm the main screens' data right after the shell settles, so the first
  // click on each already has rows to show. Skipped on data-saver/slow links.
  useEffect(() => {
    const connection = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
      }
    ).connection;
    if (
      connection?.saveData ||
      /(^|-)2g$/.test(connection?.effectiveType ?? "")
    )
      return;
    let cancelled = false;
    const run = async () => {
      const [{ prefetchAdminQueries }, { can }] = await Promise.all([
        import("@/lib/admin/queryNavigation"),
        import("@/lib/auth/permissions"),
      ]);
      for (const target of warmTargets) {
        if (cancelled) return;
        if (!can(role, target.permission)) continue;
        await prefetchAdminQueries(
          client,
          new URL(target.href, window.location.href),
        ).catch(() => {});
      }
    };
    const idle =
      typeof requestIdleCallback === "function"
        ? requestIdleCallback(() => void run(), { timeout: 3000 })
        : (setTimeout(() => void run(), 1500) as unknown as number);
    return () => {
      cancelled = true;
      if (typeof cancelIdleCallback === "function") cancelIdleCallback(idle);
      else clearTimeout(idle);
    };
  }, [client, role]);
  useEffect(() => {
    const clear = () => prefetched.current.clear();
    window.addEventListener("admin:data-changed", clear);
    return () => window.removeEventListener("admin:data-changed", clear);
  }, []);
  const value = useMemo<Navigation>(
    () => ({
      run: (action) => startTransition(action),
      loading: (token, active) =>
        setLoading((previous) => {
          const next = new Set(previous);
          if (active) next.add(token);
          else next.delete(token);
          return next;
        }),
      prefetch: (href) => {
        const url = new URL(href, window.location.href);
        if (
          url.origin !== window.location.origin ||
          !/^\/admin(?:\/|$)/.test(url.pathname)
        )
          return false;
        if (
          /^\/admin\/(login|logout|denied|forgot-password|reset-password|setup-password)(?:\/|$)/.test(
            url.pathname,
          )
        )
          return false;
        const connection = (
          navigator as Navigator & {
            connection?: { saveData?: boolean; effectiveType?: string };
          }
        ).connection;
        if (
          connection?.saveData ||
          /(^|-)2g$/.test(connection?.effectiveType ?? "")
        )
          return false;
        const key = url.pathname + url.search;
        const now = Date.now();
        if ((prefetched.current.get(key) ?? 0) > now) return true;
        // Bound both speculative reads and retained bookkeeping on long sessions.
        if (prefetched.current.size >= 40)
          prefetched.current.delete(prefetched.current.keys().next().value!);
        prefetched.current.set(key, now + 30_000);
        void import("@/lib/admin/queryNavigation")
          .then((module) => module.prefetchAdminQueries(client, url))
          .catch(() => {
            /* Invalid filter URLs are handled by the destination screen. */
          });
        return true;
      },
    }),
    [client],
  );
  return (
    <NavigationContext.Provider value={value}>
      {children}
      <div
        className="admin-navigation-progress"
        data-pending={pending || loading.size > 0}
        aria-hidden="true"
      >
        <span />
      </div>
    </NavigationContext.Provider>
  );
}

// A transition also covers refresh and query-only changes, which pathname listeners miss.
export function useAdminRouter() {
  const router = useRouter();
  const navigation = useContext(NavigationContext);
  const [, startTransition] = useTransition();
  const run = navigation?.run ?? startTransition;
  return useMemo(
    () => ({
      ...router,
      push: (...args: Parameters<typeof router.push>) =>
        run(() => router.push(...args)),
      replace: (...args: Parameters<typeof router.replace>) =>
        run(() => router.replace(...args)),
      refresh: () => {
        adminDataChanged("all");
        run(() => router.refresh());
      },
    }),
    [router, run],
  );
}

export function useAdminLoading(active: boolean) {
  const navigation = useContext(NavigationContext);
  const [token] = useState(() => Symbol("admin-loading"));
  useEffect(() => {
    if (!active || !navigation) return;
    navigation.loading(token, true);
    return () => navigation.loading(token, false);
  }, [active, navigation, token]);
}

// Link retains native modifier/new-tab behavior and Next's onNavigate cancellation.
export function AdminLink({
  href,
  prefetch,
  onNavigate,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  queryNavigation = false,
  ...props
}: ComponentProps<typeof Link> & { queryNavigation?: boolean }) {
  const router = useAdminRouter();
  const navigation = useContext(NavigationContext);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [armedHref, setArmedHref] = useState<string | null>(null);
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);
  const warm = () => {
    cancel();
    if (prefetch === false || typeof href !== "string") return;
    timer.current = setTimeout(
      () => setArmedHref(navigation?.prefetch(href) ? href : null),
      120,
    );
  };
  return (
    <Link
      {...props}
      href={href}
      prefetch={
        !queryNavigation &&
        prefetch !== false &&
        typeof href === "string" &&
        armedHref === href
      }
      onMouseEnter={(event) => {
        onMouseEnter?.(event);
        warm();
      }}
      onMouseLeave={(event) => {
        onMouseLeave?.(event);
        cancel();
        setArmedHref(null);
      }}
      onFocus={(event) => {
        onFocus?.(event);
        warm();
      }}
      onBlur={(event) => {
        onBlur?.(event);
        cancel();
        setArmedHref(null);
      }}
      onNavigate={(event) => {
        let cancelled = false;
        onNavigate?.({
          preventDefault: () => {
            cancelled = true;
            event.preventDefault();
          },
        });
        if (cancelled || typeof href !== "string") return;
        event.preventDefault();
        cancel();
        if (
          queryNavigation &&
          isAdminQueryNavigation(
            href,
            window.location.href,
            document.documentElement.lang.startsWith("zh") ? "zh" : "en",
          )
        ) {
          if (props.replace) window.history.replaceState(null, "", href);
          else window.history.pushState(null, "", href);
          return;
        }
        const navigate = props.replace ? router.replace : router.push;
        navigate(href, { scroll: props.scroll });
      }}
    />
  );
}
