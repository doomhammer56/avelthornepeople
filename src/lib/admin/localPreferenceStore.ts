// A tiny external store so useSyncExternalStore can read a persisted
// per-viewer preference without an effect+setState pair (which cascades a
// render). The sidebar's own collapse preference is handled by shadcn's
// Sidebar component itself (a server-readable cookie); this is for anything
// else — currently just dark mode.
function createBooleanPreference(key: string) {
  const changeEvent = `${key}-change`;
  return {
    subscribe(onChange: () => void) {
      window.addEventListener(changeEvent, onChange);
      return () => window.removeEventListener(changeEvent, onChange);
    },
    getSnapshot(): boolean {
      try {
        return localStorage.getItem(key) === "1";
      } catch {
        return false;
      }
    },
    // The server has no localStorage; rendering the default avoids any
    // server/client markup mismatch, and the real preference applies on mount.
    getServerSnapshot(): boolean {
      return false;
    },
    set(value: boolean) {
      try {
        localStorage.setItem(key, value ? "1" : "0");
      } catch {
        // Preference just won't persist across sessions.
      }
      window.dispatchEvent(new Event(changeEvent));
    },
  };
}

export const darkModePreference = createBooleanPreference("nl-admin-dark");
