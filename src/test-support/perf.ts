/**
 * Wall-clock budgets for tests. The behaviour around a budget always runs, but the budget itself only
 * asserts in the `perf` vitest project (EDU_PERF=1; CI runs it on Linux with retry), so `npm test`
 * stays hermetic on slow or busy machines.
 */
import { expect } from 'vitest';

export const perfBudgets = (): boolean => process.env.EDU_PERF === '1';

/** Asserts `elapsedMs < budgetMs` in the perf project; a no-op elsewhere. */
export function expectWithinBudget(elapsedMs: number, budgetMs: number, message?: string): void {
  if (perfBudgets()) expect(elapsedMs, message).toBeLessThan(budgetMs);
}
