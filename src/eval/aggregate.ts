import { ARMS, EvalContractError, parseTrials, type Arm, type Trial } from './contract.js';

export type EvalStatus = 'inconclusive' | 'insufficient-sample' | 'observed';
export interface ArmSummary {
  n: number; successes: number; failures: number; successRate: number; wilson95: [number, number];
  tokens: { input: number; output: number; acquisition: number; reflection: number; total: number };
  meanTotalTokens: number; tokensPerSuccess: number | null; meanWallMs: number; humanInterventions: number;
  /** Declared subsets (already inside input/output); null when any trial leaves them unknown. Not part of tokens.total. */
  declared: { cacheReadTokens: number | null; cacheWriteTokens: number | null; reasoningTokens: number | null };
  /** Provider-billed USD; null when ANY trial's cost is unknown (never treated as 0). */
  totalBilledCostUsd: number | null; meanBilledCostUsd: number | null; billedCostKnownTrials: number;
}
export interface Comparison {
  baseline: Arm; candidate: Arm; status: EvalStatus; reasons: string[];
  /** Descriptive differences, only when status is 'observed'. They are not causal and not savings claims. */
  successRateDelta: number | null; meanTotalTokensDelta: number | null;
  /** Mean billed USD per trial, candidate minus baseline; only when both arms have every cost known. Descriptive, not a savings claim. */
  dollarDelta: number | null; tokensPerSuccessDelta: number | null;
  successInterval: 'candidate-higher' | 'candidate-lower' | 'overlap' | null;
}
export interface EvalReport {
  status: EvalStatus; reasons: string[]; limits: string[];
  model: string | null; harness: string | null; minTrialsPerArm: number; trials: number;
  arms: Partial<Record<Arm, ArmSummary>>; comparisons: Comparison[];
}

export const DEFAULT_MIN_TRIALS = 10;
const LIMITS = [
  'Success is whatever the named oracle reported. The contract requires the oracle to be declared and meant to be external; it cannot verify independence, so trust rests on the recorder of the data.',
  'Costs are four disjoint token categories (input, output, acquisition, reflection) summed as recorded; double counting by the recorder is not detectable. Failed trials are included.',
  'An observed token difference does not promise financial savings: prices, caching and billing differ; only complete provider-billed costs are compared in USD, and unknown cost is never zero.',
  'Arms are compared only when they contain the same multiset of (taskId, repetitionId) pairs.',
  'Differences are descriptive: no causal or general efficiency claim; one model/harness per report.',
  'Wilson intervals assume independent trials of comparable tasks.',
];

function wilson(successes: number, n: number): [number, number] {
  if (!n) return [0, 0];
  const z = 1.96, p = successes / n, d = 1 + z * z / n;
  const centre = (p + z * z / (2 * n)) / d, half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** Sorted multiset of (taskId, repetitionId): equal strings mean equal task frequencies, not just equal task sets. */
function pairingKey(rows: Trial[]): string { return rows.map(row => JSON.stringify([row.taskId, row.repetitionId ?? ''])).sort().join('\n'); }

function summarize(rows: Trial[]): ArmSummary {
  const n = rows.length, successes = rows.filter(row => row.success).length;
  const sum = (pick: (row: Trial) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const tokens = { input: sum(r => r.costs.inputTokens), output: sum(r => r.costs.outputTokens), acquisition: sum(r => r.costs.acquisitionTokens), reflection: sum(r => r.costs.reflectionTokens), total: 0 };
  tokens.total = tokens.input + tokens.output + tokens.acquisition + tokens.reflection;
  const known = (pick: (row: Trial) => number | null | undefined) => (rows.every(row => pick(row) != null) ? sum(row => pick(row) ?? 0) : null);
  const totalBilledCostUsd = known(r => r.costs.billedCostUsd);
  return { n, successes, failures: n - successes, successRate: successes / n, wilson95: wilson(successes, n), tokens, meanTotalTokens: tokens.total / n, tokensPerSuccess: successes ? tokens.total / successes : null, meanWallMs: sum(r => r.costs.wallMs) / n, humanInterventions: sum(r => r.costs.humanInterventions),
    declared: { cacheReadTokens: known(r => r.costs.cacheReadTokens), cacheWriteTokens: known(r => r.costs.cacheWriteTokens), reasoningTokens: known(r => r.costs.reasoningTokens) },
    totalBilledCostUsd, meanBilledCostUsd: totalBilledCostUsd === null ? null : totalBilledCostUsd / n, billedCostKnownTrials: rows.filter(r => r.costs.billedCostUsd != null).length };
}

/**
 * Aggregates validated trials of ONE model/harness pair. Mixed models or harnesses are rejected, not averaged.
 * Without trials, with synthetic provenance, mismatched tasks or fewer than `minTrialsPerArm` per compared arm the
 * status is never 'observed', and no deltas are reported.
 */
export function aggregateTrials(input: Trial[], options: { minTrialsPerArm?: number } = {}): EvalReport {
  const trials = parseTrials(input); // re-validates: callers cannot bypass the cost/type contract
  const min = options.minTrialsPerArm ?? DEFAULT_MIN_TRIALS;
  if (!Number.isInteger(min) || min < 1) throw new EvalContractError('minTrialsPerArm must be a positive integer.');
  const base: EvalReport = { status: 'inconclusive', reasons: [], limits: LIMITS, model: null, harness: null, minTrialsPerArm: min, trials: trials.length, arms: {}, comparisons: [] };
  if (!trials.length) return { ...base, reasons: ['no-trials'] };
  const models = [...new Set(trials.map(t => t.model))], harnesses = [...new Set(trials.map(t => t.harness))];
  if (models.length > 1 || harnesses.length > 1) throw new EvalContractError(`A comparison needs one model and one harness; got models [${models.join(', ')}] and harnesses [${harnesses.join(', ')}].`);
  const byArm = new Map<Arm, Trial[]>();
  for (const trial of trials) byArm.set(trial.arm, [...(byArm.get(trial.arm) ?? []), trial]);
  const arms: EvalReport['arms'] = {};
  for (const arm of ARMS) if (byArm.has(arm)) arms[arm] = summarize(byArm.get(arm)!);
  const synthetic = trials.some(t => t.provenance !== 'measured');
  const pairs: Array<[Arm, Arm]> = [['native-clean', 'edu-cold'], ['native-clean', 'memory-static'], ['native-clean', 'memory-adaptive'], ['memory-static', 'memory-adaptive']];
  const comparisons = pairs.map(([baseline, candidate]): Comparison => {
    const a = byArm.get(baseline), b = byArm.get(candidate);
    const reasons: string[] = [];
    if (!a || !b) reasons.push(`missing-arm:${[!a && baseline, !b && candidate].filter(Boolean).join(',')}`);
    if (synthetic) reasons.push('deterministic-suite-not-llm-benchmark');
    if (a && b) {
      if (pairingKey(a) !== pairingKey(b)) reasons.push('unmatched-task-multiset');
    }
    const small = Boolean(a && b) && (a!.length < min || b!.length < min);
    if (small) reasons.push(`sample-below-${min}-per-arm`);
    const status: EvalStatus = !a || !b || synthetic || reasons.includes('unmatched-task-multiset') ? 'inconclusive' : small ? 'insufficient-sample' : 'observed';
    if (status !== 'observed') return { baseline, candidate, status, reasons, successRateDelta: null, meanTotalTokensDelta: null, dollarDelta: null, tokensPerSuccessDelta: null, successInterval: null };
    const sa = arms[baseline]!, sb = arms[candidate]!;
    return {
      baseline, candidate, status, reasons,
      successRateDelta: sb.successRate - sa.successRate, meanTotalTokensDelta: sb.meanTotalTokens - sa.meanTotalTokens,
      dollarDelta: sa.meanBilledCostUsd !== null && sb.meanBilledCostUsd !== null ? sb.meanBilledCostUsd - sa.meanBilledCostUsd : null,
      tokensPerSuccessDelta: sa.tokensPerSuccess !== null && sb.tokensPerSuccess !== null ? sb.tokensPerSuccess - sa.tokensPerSuccess : null,
      successInterval: sb.wilson95[0] > sa.wilson95[1] ? 'candidate-higher' : sb.wilson95[1] < sa.wilson95[0] ? 'candidate-lower' : 'overlap',
    };
  });
  const observed = comparisons.some(c => c.status === 'observed');
  const status: EvalStatus = observed ? 'observed' : comparisons.some(c => c.status === 'insufficient-sample') ? 'insufficient-sample' : 'inconclusive';
  const reasons = observed ? [] : [...new Set(comparisons.flatMap(c => c.reasons))];
  return { ...base, status, reasons, model: models[0]!, harness: harnesses[0]!, arms, comparisons };
}
