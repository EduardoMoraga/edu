import type { Usage, UsageField } from './contracts.js';

export const USAGE_FIELDS: UsageField[] = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'costUsd'];
export const validUsageNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Unmarked historical placeholders are not proof of a measurement, even when numeric. */
export function usageValue(usage: Usage, field: UsageField): number | null {
  return usage.known?.[field] === true && validUsageNumber(usage[field]) ? usage[field]! : null;
}

/** Empty observations are unknown. An explicit empty accumulator is an identity, not a measured call. */
export function sumUsage(rows: readonly Usage[]): Usage {
  const result: Usage = { inputTokens: 0, outputTokens: 0, known: {}, observationIds: [], observations: 0 };
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.observations === 0) continue;
    const ids = row.observationId ? [row.observationId] : row.observationIds ?? [];
    if (ids.length && ids.every(id => seen.has(id))) continue;
    if (ids.some(id => seen.has(id))) throw new Error('Overlapping usage aggregates cannot be summed without individual observations.');
    const first = result.observations === 0;
    for (const field of USAGE_FIELDS) {
      const value = row[field];
      if (validUsageNumber(value)) result[field] = (result[field] ?? 0) + value;
      result.known![field] = (first || result.known![field] === true) && usageValue(row, field) !== null;
    }
    result.observations! += row.observations ?? 1;
    for (const id of ids) seen.add(id);
  }
  if (!result.observations) for (const field of USAGE_FIELDS) result.known![field] = false;
  result.observationIds = [...seen];
  return result;
}

export function tokenMeasurement(usage: Usage): { value: number; known: boolean } {
  return { value: (validUsageNumber(usage.inputTokens) ? usage.inputTokens : 0) + (validUsageNumber(usage.outputTokens) ? usage.outputTokens : 0),
    known: usageValue(usage, 'inputTokens') !== null && usageValue(usage, 'outputTokens') !== null };
}

export function measuredText(value: number | undefined, known: boolean, format: (value: number) => string): string {
  if (known && validUsageNumber(value)) return format(value);
  return validUsageNumber(value) && value > 0 ? `>=${format(value)} (partial)` : 'unknown';
}
