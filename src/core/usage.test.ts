import { expect, it } from 'vitest';
import { sumUsage, tokenMeasurement, usageValue } from './usage.js';
const a = { inputTokens: 3, outputTokens: 0, known: { inputTokens: true, outputTokens: true }, observationId: 'A' };
const b = { ...a, inputTokens: 5, observationId: 'B' };
it('deduplicates individual replays and counts cache subsets only once', () => {
  const sum = sumUsage([a, a, b]);
  expect(usageValue(sum, 'inputTokens')).toBe(8);
  expect(tokenMeasurement({ ...sum, cacheReadTokens: 3 })).toEqual({ value: 8, known: true });
});
it('rejects overlapping aggregates rather than presenting double-counted partials', () => {
  expect(() => sumUsage([a, sumUsage([a, b])])).toThrow(/overlap/i);
  expect(sumUsage([sumUsage([a, b]), a]).inputTokens).toBe(8);
});
it('treats historical unmarked numeric placeholders as unknown', () => {
  expect(usageValue({ inputTokens: 0, outputTokens: 0 }, 'inputTokens')).toBeNull();
  expect(usageValue({ inputTokens: 100, outputTokens: 1 }, 'inputTokens')).toBeNull();
});
