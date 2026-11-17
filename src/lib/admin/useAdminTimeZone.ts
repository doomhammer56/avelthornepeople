"use client";
import { useSyncExternalStore } from "react";
import { validTimeZone } from "./timeZone.ts";

const key = "portal-admin-timezone:v1",
  event = "portal-admin-timezone-change";
let memoryPreference: string | undefined;
function snapshot() {
  let selected = memoryPreference;
  if (selected === undefined) {
    try {
      selected = localStorage.getItem(key) ?? "";
    } catch {
      selected = "";
    }
  }
  if (selected && validTimeZone(selected)) return selected;
  return "";
}
function subscribe(changed: () => void) {
  const storage = (e: StorageEvent) => {
    if (e.key === key || e.key === null) {
      memoryPreference = undefined;
      changed();
    }
  };
  window.addEventListener(event, changed);
  window.addEventListener("storage", storage);
  window.addEventListener("focus", changed);
  return () => {
    window.removeEventListener(event, changed);
    window.removeEventListener("storage", storage);
    window.removeEventListener("focus", changed);
  };
}
function fullSnapshot() {
  return `${snapshot()}|${Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"}`;
}
export function useAdminTimeZone() {
  const stored = useSyncExternalStore(subscribe, fullSnapshot, () => null);
  const [preference = "", detected = "UTC"] = (stored ?? "|UTC").split("|");
  return {
    ready: stored !== null,
    preference,
    detected,
    timeZone: preference || detected,
    setPreference(value: string) {
      if (value && !validTimeZone(value)) return;
      memoryPreference = value;
      try {
        if (value) localStorage.setItem(key, value);
        else localStorage.removeItem(key);
      } catch {
        /* Still applies for this session. */
      }
      window.dispatchEvent(new Event(event));
    },
  };
}
