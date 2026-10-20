import { describe, expect, it } from 'vitest';
import { openBrain } from '../brain/index.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EvalContractError, aggregateTrials, parseTrials, runMemorySuite, type Arm, type Trial } from './index.js';

const costs = { inputTokens: 100, outputTokens: 50, acquisitionTokens: 10, reflectionTokens: 5, wallMs: 1000, humanInterventions: 0 };
const trial = (arm: Arm, i: number, success: boolean, over: Partial<Trial> = {}): Trial => ({ trialId: `${arm}-${i}`, taskId: `t${i}`, arm, model: 'm1', harness: 'h1', provenance: 'measured', success, oracle: 'unit-tests', costs, ...over });
const batch = (arm: Arm, n: number, wins: number, over: Partial<Trial> = {}) => Array.from({ length: n }, (_, i) => trial(arm, i, i < wins, over));

describe('trial contract', () => {
  it('rejects mistyped, missing-cost, extra-field and duplicate trials', () => {
    const ok = trial('edu-cold', 0, true);
    expect(() => parseTrials([{ ...ok, success: 'yes' }])).toThrow(EvalContractError);
    expect(() => parseTrials([{ ...ok, costs: { ...costs, acquisitionTokens: undefined } }])).toThrow(/acquisitionTokens/);
    const { reflectionTokens: _omitted, ...partial } = costs;
    expect(() => parseTrials([{ ...ok, costs: partial }])).toThrow(/reflectionTokens/);
    expect(() => parseTrials([{ ...ok, costs: { ...costs, inputTokens: -1 } }])).toThrow(EvalContractError);
    expect(() => parseTrials([{ ...ok, costs: { ...costs, wallMs: Number.NaN } }])).toThrow(EvalContractError);
    expect(() => parseTrials([{ ...ok, oracle: '' }])).toThrow(/oracle/);
    expect(() => parseTrials([{ ...ok, arm: 'magic' }])).toThrow(EvalContractError);
    expect(() => parseTrials([{ ...ok, selfReportedSuccess: true }])).toThrow(EvalContractError);
    expect(() => parseTrials([ok, ok])).toThrow(/Duplicate/);
    expect(() => parseTrials('nope')).toThrow(EvalContractError);
    expect(parseTrials({ trials: [ok] })).toEqual([ok]);
  });
});

describe('aggregation honesty', () => {
  it('is inconclusive with no trials', () => {
    const report = aggregateTrials([]);
    expect(report).toMatchObject({ status: 'inconclusive', reasons: ['no-trials'], trials: 0, arms: {}, comparisons: [] });
    expect(report.limits.length).toBeGreaterThan(0);
  });
  it('rejects different models or harnesses within one comparison', () => {
    expect(() => aggregateTrials([...batch('native-clean', 2, 1), ...batch('edu-cold', 2, 1, { model: 'm2' })].map((t, i) => ({ ...t, trialId: `x${i}` })))).toThrow(/one model and one harness/);
    expect(() => aggregateTrials([trial('native-clean', 0, true), trial('edu-cold', 1, true, { harness: 'h2' })])).toThrow(EvalContractError);
  });
  it('reports insufficient-sample and withholds deltas below the minimum', () => {
    const report = aggregateTrials([...batch('native-clean', 3, 1), ...batch('memory-adaptive', 3, 3)]);
    expect(report.status).toBe('insufficient-sample');
    const c = report.comparisons.find(x => x.candidate === 'memory-adaptive')!;
    expect(c).toMatchObject({ status: 'insufficient-sample', successRateDelta: null, meanTotalTokensDelta: null });
  });
  it('is inconclusive when an arm is missing or task sets differ', () => {
    expect(aggregateTrials(batch('native-clean', 12, 6)).status).toBe('inconclusive');
    const other = batch('memory-static', 12, 12).map((t, i) => ({ ...t, taskId: `z${i}` }));
    const c = aggregateTrials([...batch('native-clean', 12, 6), ...other]).comparisons.find(x => x.candidate === 'memory-static')!;
    expect(c.status).toBe('inconclusive');
    expect(c.reasons).toContain('unmatched-task-multiset');
  });
  it('rejects unbalanced easy/hard frequencies even when the task SETS are equal', () => {
    // Same set {easy, hard}; baseline mostly hard, candidate mostly easy.
    const mk = (arm: Arm, easy: number, hard: number) => [...Array.from({ length: easy }, (_, i) => trial(arm, i, true, { trialId: `${arm}-e${i}`, taskId: 'easy' })), ...Array.from({ length: hard }, (_, i) => trial(arm, i, false, { trialId: `${arm}-h${i}`, taskId: 'hard' }))];
    const report = aggregateTrials([...mk('native-clean', 2, 18), ...mk('memory-adaptive', 18, 2)]);
    const c = report.comparisons.find(x => x.candidate === 'memory-adaptive')!;
    expect(c).toMatchObject({ status: 'inconclusive', successRateDelta: null });
    expect(c.reasons).toContain('unmatched-task-multiset');
    expect(report.status).toBe('inconclusive');
  });
  it('pairs repeated attempts through repetitionId', () => {
    const mk = (arm: Arm, wins: number) => Array.from({ length: 12 }, (_, i) => trial(arm, i, i < wins, { trialId: `${arm}-${i}`, taskId: 'same', repetitionId: `r${i}` }));
    expect(aggregateTrials([...mk('native-clean', 3), ...mk('memory-adaptive', 12)]).comparisons.find(x => x.candidate === 'memory-adaptive')!.status).toBe('observed');
    const shifted = mk('memory-adaptive', 12).map((t, i) => ({ ...t, repetitionId: i === 0 ? 'other' : t.repetitionId }));
    expect(aggregateTrials([...mk('native-clean', 3), ...shifted]).comparisons.find(x => x.candidate === 'memory-adaptive')!.reasons).toContain('unmatched-task-multiset');
  });
  it('re-validates programmatic input: missing costs never reach a comparison', () => {
    const broken = batch('native-clean', 12, 6).map((t, i) => (i === 0 ? { ...t, costs: { ...t.costs, reflectionTokens: undefined } } : t)) as unknown as Trial[];
    expect(() => aggregateTrials([...broken, ...batch('memory-adaptive', 12, 12)])).toThrow(/reflectionTokens/);
  });
  it('sums the four disjoint cost categories without dedup', () => {
    const report = aggregateTrials(batch('native-clean', 4, 4));
    expect(report.arms['native-clean']!.tokens).toEqual({ input: 400, output: 200, acquisition: 40, reflection: 20, total: 660 });
    expect(report.limits.join(' ')).toMatch(/disjoint/);
    expect(report.limits.join(' ')).toMatch(/cannot verify independence/);
  });
  it('never treats deterministic-suite data as evidence', () => {
    const report = aggregateTrials([...batch('native-clean', 12, 2, { provenance: 'deterministic-suite' }), ...batch('memory-adaptive', 12, 12, { provenance: 'deterministic-suite' })]);
    expect(report.status).toBe('inconclusive');
    expect(report.reasons).toContain('deterministic-suite-not-llm-benchmark');
    expect(report.comparisons.every(c => c.successRateDelta === null)).toBe(true);
  });
  it('counts failures and acquisition/reflection in costs; tokens per success is null with zero successes', () => {
    const report = aggregateTrials([...batch('native-clean', 10, 0), ...batch('memory-adaptive', 10, 5)]);
    expect(report.arms['native-clean']).toMatchObject({ n: 10, successes: 0, tokensPerSuccess: null, tokens: { acquisition: 100, reflection: 50, total: 1650 } });
    expect(report.arms['memory-adaptive']).toMatchObject({ failures: 5, tokensPerSuccess: 330 });
  });
  it('reports observed descriptive differences only with enough matched measured trials', () => {
    const report = aggregateTrials([...batch('native-clean', 30, 6), ...batch('memory-adaptive', 30, 27)]);
    const c = report.comparisons.find(x => x.candidate === 'memory-adaptive')!;
    expect(report.status).toBe('observed');
    expect(c).toMatchObject({ status: 'observed', successInterval: 'candidate-higher' });
    expect(c.successRateDelta).toBeCloseTo(0.7);
    expect(report.limits.join(' ')).toMatch(/no causal/);
  });
});

describe('billed cost and declared breakdown', () => {
  const withCosts = (arm: Arm, n: number, extra: Partial<typeof costs> & { billedCostUsd?: number | null; cacheReadTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number }) => batch(arm, n, n, { costs: { ...costs, ...extra } });
  it('keeps old fixtures valid: absent cost keys mean unknown, not zero', () => {
    const report = aggregateTrials([...batch('native-clean', 2, 2)]);
    expect(report.arms['native-clean']).toMatchObject({ totalBilledCostUsd: null, meanBilledCostUsd: null, billedCostKnownTrials: 0, declared: { cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null } });
  });
  it('distinguishes observed zero from unknown and nulls totals when any trial is unknown', () => {
    expect(aggregateTrials(withCosts('native-clean', 3, { billedCostUsd: 0 })).arms['native-clean']).toMatchObject({ totalBilledCostUsd: 0, meanBilledCostUsd: 0, billedCostKnownTrials: 3 });
    const partial = [...withCosts('native-clean', 2, { billedCostUsd: 0.5 }), trial('native-clean', 9, true, { costs: { ...costs, billedCostUsd: null } })];
    expect(aggregateTrials(partial).arms['native-clean']).toMatchObject({ totalBilledCostUsd: null, meanBilledCostUsd: null, billedCostKnownTrials: 2 });
  });
  it('computes dollarDelta only when both arms are complete', () => {
    const find = (rows: Trial[]) => aggregateTrials(rows).comparisons.find(x => x.candidate === 'memory-adaptive')!;
    const full = find([...withCosts('native-clean', 10, { billedCostUsd: 0.2 }), ...withCosts('memory-adaptive', 10, { billedCostUsd: 0.5 })]);
    expect(full.status).toBe('observed');
    expect(full.dollarDelta).toBeCloseTo(0.3);
    const oneUnknown = find([...withCosts('native-clean', 10, { billedCostUsd: 0.2 }), ...withCosts('memory-adaptive', 10, {})]);
    expect(oneUnknown.status).toBe('observed');
    expect(oneUnknown.dollarDelta).toBeNull();
    const zeros = find([...withCosts('native-clean', 10, { billedCostUsd: 0 }), ...withCosts('memory-adaptive', 10, { billedCostUsd: 0 })]);
    expect(zeros.dollarDelta).toBe(0);
  });
  it('never adds declared cache/reasoning tokens to totals, and rejects non-subsets', () => {
    const report = aggregateTrials(withCosts('native-clean', 2, { cacheReadTokens: 60, cacheWriteTokens: 30, reasoningTokens: 20 }));
    expect(report.arms['native-clean']!.tokens.total).toBe(2 * 165);
    expect(report.arms['native-clean']!.declared).toEqual({ cacheReadTokens: 120, cacheWriteTokens: 60, reasoningTokens: 40 });
    expect(() => parseTrials(withCosts('native-clean', 1, { cacheReadTokens: 80, cacheWriteTokens: 30 }))).toThrow(/subset of inputTokens/);
    expect(() => parseTrials(withCosts('native-clean', 1, { reasoningTokens: 51 }))).toThrow(/subset of outputTokens/);
    expect(() => parseTrials(withCosts('native-clean', 1, { billedCostUsd: -1 }))).toThrow(EvalContractError);
  });
  it('states that observed tokens promise no financial saving', () => {
    expect(aggregateTrials(batch('native-clean', 1, 1)).limits.join(' ')).toMatch(/does not promise financial savings/);
  });
});

describe('deterministic memory suite', () => {
  it('shows memory behaviour: transfer, distractor recovery by verified feedback, human-supplied correction', async () => {
    const result = await runMemorySuite();
    expect(result.notALlmBenchmark).toBe(true);
    const phase = (arm: string) => result.byArm[arm]!.byPhase;
    expect(phase('native-clean')).toEqual({ transfer: '0/1', distractor: '0/3', correction: '0/2' });
    expect(phase('edu-cold')).toEqual({ transfer: '0/1', distractor: '0/3', correction: '0/2' });
    expect(phase('memory-static')).toEqual({ transfer: '1/1', distractor: '0/3', correction: '0/2' });
    expect(phase('memory-adaptive')).toEqual({ transfer: '1/1', distractor: '2/3', correction: '1/2' });
    const adaptive = result.trials.filter(t => t.arm === 'memory-adaptive');
    expect(adaptive.reduce((n, t) => n + t.costs.humanInterventions, 0)).toBe(1);
    expect(adaptive.reduce((n, t) => n + t.costs.reflectionTokens, 0)).toBeGreaterThan(0);
    expect(aggregateTrials(result.trials).status).toBe('inconclusive');
  });
});

describe('advisory feedback is not verified evidence', () => {
  it('does not promote a lesson no matter how many advisory wins arrive', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-eval-adv-'));
    try {
      const root = join(dir, '.edu');
      const brain = openBrain([{ scope: 'project', root }]);
      await brain.init({ scope: 'project', root });
      const note = await brain.write({ title: 'Advisory only', body: 'x', tier: 'transitive', kind: 'lesson', band: 'inferred', source: 'edu:eval-test' });
      for (let i = 0; i < 5; i++) await brain.feedback(note.meta.id, true, { eventId: `adv-${i}`, verified: false });
      await brain.maintain();
      const after = await brain.read(note.meta.id);
      expect(after?.meta.status).not.toBe('proven');
      expect(after?.meta.usage?.verifiedWins ?? 0).toBe(0);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
