import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectWithinBudget, perfBudgets } from './perf.js';

afterEach(() => { vi.unstubAllEnvs(); });

describe('expectWithinBudget', () => {
  it('ignores an exceeded budget outside the perf project', () => {
    vi.stubEnv('EDU_PERF', '');
    expect(perfBudgets()).toBe(false);
    expect(() => expectWithinBudget(5000, 10)).not.toThrow();
  });

  it('fails an exceeded budget in the perf project, with the diagnostic', () => {
    vi.stubEnv('EDU_PERF', '1');
    expect(perfBudgets()).toBe(true);
    expect(() => expectWithinBudget(9, 10)).not.toThrow();
    expect(() => expectWithinBudget(5000, 10, 'maintain on 1000 notes')).toThrow(/maintain on 1000 notes/);
  });
});
