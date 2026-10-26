import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Engine, EduEvent } from '../core/contracts.js';
import { RunBudget } from './budget.js';
import { defaultConfig, EduConfigSchema } from './config.js';
import { assignCli } from './assign.js';
import { orchestrate } from './run.js';

const collect = async (events: AsyncIterable<EduEvent>) => { for await (const _ of events) { /* drain */ } };
const engine: Engine = { cli: 'pi', available: async () => true, async *run() {} };
const request = { cli: 'pi' as const, prompt: 'test', cwd: '.', autonomy: 'readonly' as const };

describe('Edu 3 execution budgets and routes', () => {
  it('rejects invalid budgets and unknown configuration keys', () => {
    for (const execution of [{ maxSpawns: 0 }, { maxConcurrency: 99 }, { timeoutMs: -1 }, { maxAdvisorCalls: 5 }, { unlimited: true }]) {
      expect(EduConfigSchema.safeParse({ ...defaultConfig('pi'), execution }).success).toBe(false);
    }
    expect(EduConfigSchema.parse({ ...defaultConfig('pi'), execution: {} }).execution?.maxSpawns).toBe(32);
  });
  it('routes explicitly even in solo mode and fails unavailable routes closed', () => {
    const config = { ...defaultConfig('pi'), routing: { executor: { cli: 'codex' as const }, reviewer: { cli: 'claude' as const } } };
    expect(assignCli('builder', config, ['codex', 'claude'])).toBe('codex');
    expect(assignCli('reviewer', config, ['codex', 'claude'])).toBe('claude');
    expect(assignCli('lead', config, ['pi', 'codex', 'claude'])).toBe('pi');
    expect(assignCli('explorer', config, ['pi', 'codex', 'claude'])).toBe('pi');
    expect(() => assignCli('builder', config, ['pi'])).toThrow(/unavailable/);
  });
  it('shares total spawns, releases active count and respects pre-cancellation', async () => {
    const budget = new RunBudget({ ...defaultConfig('pi'), execution: { maxSpawns: 1, maxConcurrency: 1, timeoutMs: 1000, maxAdvisorCalls: 0 } });
    const wrapped = budget.wrap(engine);
    await collect(wrapped.run(request, 'first'));
    expect(budget.active).toBe(0);
    await expect(collect(wrapped.run(request, 'second'))).rejects.toThrow(/maxSpawns/);
    expect(budget.spawns).toBe(1);
    const fresh = new RunBudget(defaultConfig('pi'));
    await expect(collect(fresh.wrap(engine).run({ ...request, signal: AbortSignal.abort() }, 'cancelled'))).rejects.toThrow(/cancelled/);
    expect(fresh.spawns).toBe(0);
  });
  it('queues concurrent invocations and cancels queued work without consuming a spawn', async () => {
    const budget = new RunBudget({ ...defaultConfig('pi'), execution: { maxSpawns: 3, maxConcurrency: 1, timeoutMs: 1000, maxAdvisorCalls: 0 } });
    let release!: () => void;
    let entered!: () => void;
    const running = new Promise<void>(resolve => { entered = resolve; });
    const slow: Engine = { ...engine, async *run() { entered(); await new Promise<void>(resolve => { release = resolve; }); } };
    const first = collect(budget.wrap(slow).run(request, 'one'));
    await running;
    const controller = new AbortController();
    const second = collect(budget.wrap(engine).run({ ...request, signal: controller.signal }, 'two'));
    controller.abort();
    await expect(second).rejects.toThrow(/cancelled/);
    expect(budget.spawns).toBe(1);
    release();
    await first;
    await collect(budget.wrap(engine).run(request, 'three'));
    expect(budget.spawns).toBe(2);
    expect(budget.active).toBe(0);
  });
  it('persists budget exhaustion through the real run path without executing another child', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu3-budget-'));
    let calls = 0;
    const runtime: Engine = { ...engine, async *run(_request, id) {
      calls++;
      yield { type: 'agent.text', agentId: id, text: JSON.stringify({ requirements: [{ id: 'R1', text: 'done' }], checks: [], steps: [] }), at: new Date().toISOString() };
    } };
    try {
      const result = await orchestrate('test', {
        config: { ...defaultConfig('pi'), execution: { maxSpawns: 1, maxConcurrency: 1, timeoutMs: 10000, maxAdvisorCalls: 0 } },
        brain: { openSession: async () => ({ meta: { id: 'exact-session-id' } }), closeSession: async () => undefined } as never,
        context: { build: async () => ({ text: '', tokens: 0, budgetTokens: 100, sections: [], deferred: [] }) },
        engines: () => runtime, available: ['pi'], cwd: dir, runsDir: join(dir, '.edu', 'runs'),
        approve: async () => true, onEvent: () => undefined,
      });
      expect(result.ok).toBe(false);
      expect(result.summary).toContain('maxSpawns');
      expect(calls).toBe(1);
      const status = JSON.parse(await readFile(join(dir, '.edu', 'runs', `${result.runId}.status.json`), 'utf8'));
      expect(status.status).toBe('budget_exhausted');
      expect(status.sessionId).toBe('exact-session-id');
      expect(status.budget.spawns).toBe(1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
