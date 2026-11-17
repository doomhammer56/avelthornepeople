import "server-only";
import { StaffAuthError } from "../auth/errors.ts";

export async function consoleResult<T>(action: () => Promise<T>) {
  try {
    return { ok: true as const, data: await action() };
  } catch (error) {
    return {
      ok: false as const,
      kind:
        error instanceof StaffAuthError &&
        (error.status === 401 || error.status === 403)
          ? ("restricted" as const)
          : ("unavailable" as const),
    };
  }
}
