"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import type { Staff } from "@/server/auth/staff";
import { createAdminQueryClient } from "@/lib/admin/queryClient";
import { adminRead } from "@/lib/admin/queries";
import { invalidateAdminResource } from "@/lib/admin/cachePolicy";
import type { AdminResource } from "@/lib/admin/cacheEvents";
import { AdminSessionContext } from "./AdminSessionGate";
import { checkAdminAdmission, resumeCheck } from "@/lib/admin/admission";

export function AdminQueryProvider({
  staff,
  lang,
  children,
}: {
  staff: Staff;
  lang: "en" | "zh";
  children: ReactNode;
}) {
  const [admissionFailed, setAdmissionFailed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [{ client, setAccessHandler }] = useState(() => {
    let handler: ((error: unknown) => void) | undefined;
    return {
      client: createAdminQueryClient((error) => handler?.(error)),
      setAccessHandler(next?: (error: unknown) => void) {
        handler = next;
      },
    };
  });
  // Set while we are already navigating away (sign-out, expired session, lost
  // access). Distinct from `admissionFailed`, which means verification itself
  // failed and the user needs a Retry: a redirect must never flash that error.
  const [redirecting, setRedirecting] = useState(false);
  useEffect(() => {
    let hiddenAt = Date.now();
    let disposed = false;
    let accessCheck: AbortController | null = null;
    // `blocking` hides the page while the check runs. Background checks leave
    // the current data on screen and only act if admission actually changed.
    const verifyAdmission = (blocking = false) => {
      if (accessCheck) return;
      const check = new AbortController();
      accessCheck = check;
      if (blocking) setChecking(true);
      void checkAdminAdmission({ id: staff.id, role: staff.role }, () =>
        adminRead<Staff>("/api/admin/me", check.signal),
      ).then((decision) => {
        if (check.signal.aborted || disposed) return;
        accessCheck = null;
        if (decision === "allowed") {
          hiddenAt = Date.now();
          setAdmissionFailed(false);
          setChecking(false);
          return;
        }
        client.clear();
        if (decision === "changed") {
          setRedirecting(true);
          window.location.reload();
          return;
        }
        if (decision === "login" || decision === "denied") {
          setRedirecting(true);
          window.location.replace(`/admin/${decision}?lang=${lang}`);
          return;
        }
        setAdmissionFailed(true);
      });
    };
    setAccessHandler((error) => {
      if ((error as { status: number }).status === 401) {
        accessCheck?.abort();
        setRedirecting(true);
        window.location.replace(`/admin/login?lang=${lang}`);
        return;
      }
      verifyAdmission();
    });
    const changed = (event: Event) => {
      void invalidateAdminResource(
        client,
        (event as CustomEvent<AdminResource>).detail,
      );
    };
    const channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel("admin-session");
    if (channel)
      channel.onmessage = (event) => {
        if (event.data !== "logout") return;
        accessCheck?.abort();
        setRedirecting(true);
        client.clear();
        window.location.replace(`/admin/login?lang=${lang}`);
      };
    const checkAdmission = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const mode = resumeCheck(Date.now() - hiddenAt);
      if (mode === "skip") return;
      verifyAdmission(mode === "blocking");
    };
    window.addEventListener("admin:data-changed", changed);
    document.addEventListener("visibilitychange", checkAdmission);
    return () => {
      disposed = true;
      setAccessHandler();
      accessCheck?.abort();
      channel?.close();
      client.clear();
      window.removeEventListener("admin:data-changed", changed);
      document.removeEventListener("visibilitychange", checkAdmission);
    };
  }, [client, setAccessHandler, staff.id, staff.role, lang]);
  return (
    <QueryClientProvider client={client}>
      <AdminSessionContext.Provider
        value={{ checking, admissionFailed, redirecting }}
      >
        {children}
      </AdminSessionContext.Provider>
    </QueryClientProvider>
  );
}
