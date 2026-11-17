import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

type Phase =
  "identity" | "admission" | "service" | "db_pool" | "db_setup" | "db_work";
type Timings = { start: number; phases: Map<Phase, number> };
const requests = new AsyncLocalStorage<Timings>();

// Only fixed phase names and durations are collected. Never retain request/SQL values.
export function withAdminTimings<T>(action: () => Promise<T>) {
  return requests.run({ start: performance.now(), phases: new Map() }, action);
}

export async function measureAdminPhase<T>(
  phase: Phase,
  action: () => Promise<T>,
): Promise<T> {
  const request = requests.getStore();
  if (!request) return action();
  const start = performance.now();
  try {
    return await action();
  } finally {
    request.phases.set(
      phase,
      (request.phases.get(phase) ?? 0) + performance.now() - start,
    );
  }
}

export function adminServerTiming() {
  const request = requests.getStore();
  if (!request) return "";
  return [
    ...request.phases,
    ["total", performance.now() - request.start] as const,
  ]
    .map(([phase, duration]) => `${phase};dur=${duration.toFixed(1)}`)
    .join(", ");
}
