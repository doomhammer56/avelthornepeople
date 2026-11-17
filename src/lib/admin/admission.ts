type StaffAdmission = { id: string; role: string };

// A module-specific 403 is not proof that console admission was revoked.
// Verify admission independently before redirecting or discarding other pages.
export async function checkAdminAdmission(
  expected: StaffAdmission,
  readStaff: () => Promise<StaffAdmission>,
): Promise<"allowed" | "changed" | "login" | "denied" | "unavailable"> {
  try {
    const current = await readStaff();
    return current.id === expected.id && current.role === expected.role
      ? "allowed"
      : "changed";
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error
        ? error.status
        : undefined;
    return status === 401 ? "login" : status === 403 ? "denied" : "unavailable";
  }
}

/** Away for less than this: the tab was just briefly hidden, so nothing is rechecked. */
export const RECHECK_AFTER_MS = 60_000;
/** Away for at least this long: the session may really have expired. */
export const BLOCK_VIEW_AFTER_MS = 15 * 60_000;

// What to do when the tab becomes visible again. Short absences re-verify the
// session silently so the data on screen never turns into a skeleton; only a
// long absence hides the page until the session is confirmed.
export function resumeCheck(awayMs: number): "skip" | "silent" | "blocking" {
  if (awayMs < RECHECK_AFTER_MS) return "skip";
  return awayMs >= BLOCK_VIEW_AFTER_MS ? "blocking" : "silent";
}
