import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { setTimeout } from "node:timers/promises";

export const publicationBudgetMs = 60_000;

// Use ordinary URLs and cache behavior so a warmed cache is part of the check.
export async function warmPublicPaths(origin, paths) {
  await Promise.all(
    paths.map(async (path) => {
      const response = await fetch(origin + path, {
        signal: AbortSignal.timeout(30_000),
      });
      assert.ok(
        [200, 404].includes(response.status),
        `Warm ${path}: ${response.status}`,
      );
      await response.text();
    }),
  );
}

// All probes share the mutation's acknowledgement time, including body reads.
// An individual slow response cannot silently extend the acceptance deadline.
export async function assertPublicationSync(
  t,
  origin,
  label,
  acknowledgedAt,
  probes,
  { budgetMs = publicationBudgetMs, pollMs = 1000 } = {},
) {
  assert.ok(budgetMs > 0 && budgetMs <= publicationBudgetMs);
  const results = await Promise.allSettled(
    probes.map(async ({ path, matches }) => {
      let last = "no matching response";
      while (performance.now() - acknowledgedAt < budgetMs) {
        const remaining = Math.ceil(
          budgetMs - (performance.now() - acknowledgedAt),
        );
        if (remaining <= 0) break;
        try {
          const response = await fetch(origin + path, {
            signal: AbortSignal.timeout(Math.min(remaining, 10_000)),
          });
          const matched = await matches(response);
          const elapsed = performance.now() - acknowledgedAt;
          if (matched && elapsed <= budgetMs) {
            t.diagnostic(`QA-01 ${label} ${path}: ${elapsed.toFixed(0)} ms`);
            return;
          }
          last = `HTTP ${response.status}, expected state not observed`;
        } catch (error) {
          last = error.name;
        }
        const delay = Math.min(
          pollMs,
          budgetMs - (performance.now() - acknowledgedAt),
        );
        if (delay > 0) await setTimeout(delay);
      }
      assert.fail(`QA-01 ${label} ${path} exceeded ${budgetMs} ms (${last})`);
    }),
  );
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length)
    throw new AggregateError(
      failures.map((result) => result.reason),
      `QA-01 ${label}: publication deadline failed`,
    );
}
