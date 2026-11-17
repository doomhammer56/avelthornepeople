export type AdminResource =
  "applications" | "jobs" | "settings" | "content" | "staff" | "all";

// Events contain resource names only, never records or contact search terms.
export function adminDataChanged(resource: AdminResource) {
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent("admin:data-changed", { detail: resource }),
    );
}

export function announceAdminLogout() {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel("admin-session");
  channel.postMessage("logout");
  channel.close();
}
