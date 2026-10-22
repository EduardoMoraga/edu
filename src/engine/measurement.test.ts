import { describe, expect, it } from 'vitest';
import type { EduEvent, Engine, EngineRunRequest } from '../core/contracts.js';
import { makeUsage } from './parse.js';
import { measuredEngine } from './measurement.js';
import { sumUsage, usageValue } from '../core/usage.js';
const at = '2026-10-22T00:00:00Z';
const req: EngineRunRequest = { cli: 'pi', prompt: 'fixture', cwd: '/tmp', autonomy: 'readonly' };
async function collect(engine: Engine, request = req) {
  const events: EduEvent[] = [];
  for await (const event of measuredEngine(engine).run(request, 'fixture')) events.push(event);
  return events.filter((e): e is Extract<EduEvent, { type: 'usage' }> => e.type === 'usage');
}
describe('measurement completeness', () => {
  it('distinguishes missing tokens from explicit provider zero', () => {
    const missing = makeUsage({ agentId: 'a', at }, { cost_usd: 0 })[0];
    const zero = makeUsage({ agentId: 'a', at }, { input_tokens: 0, output_tokens: 0 })[0];
    if (missing?.type !== 'usage' || zero?.type !== 'usage') throw Error('usage missing');
    expect(missing.usage.known).toMatchObject({ inputTokens: false, outputTokens: false, costUsd: true });
    expect(zero.usage.known).toMatchObject({ inputTokens: true, outputTokens: true, costUsd: false });
    expect(usageValue(missing.usage, 'inputTokens')).toBeNull();
    expect(usageValue(zero.usage, 'inputTokens')).toBe(0);
  });
  it('records an invocation with no usage as incomplete and deduplicates replay', async () => {
    const engine: Engine = { cli: 'pi', available: async () => true, async *run() {} };
    const rows = await collect(engine, { ...req, invocation: { id: 'actual-call-1', purpose: 'recovery' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.usage).toMatchObject({ invocationId: 'actual-call-1', purpose: 'recovery' });
    const sum = sumUsage([...rows, ...rows].map(e => e.usage));
    expect(usageValue(sum, 'inputTokens')).toBeNull();
    expect(sum.observationIds).toHaveLength(1);
  });
  it('retains partial observations without turning a missing call into zero cost', async () => {
    const engine: Engine = { cli: 'pi', available: async () => true, async *run(_r, agentId) {
      yield { type: 'usage', agentId, at, usage: { inputTokens: 10, outputTokens: 0, costUsd: 0, known: { inputTokens: true, outputTokens: true, costUsd: true } } };
    } };
    const known = await collect(engine);
    const absent = await collect({ ...engine, async *run() {} });
    const total = sumUsage([...known, ...known, ...absent].map(e => e.usage));
    expect(total.inputTokens).toBe(10);
    expect(usageValue(total, 'inputTokens')).toBeNull();
    expect(usageValue(total, 'costUsd')).toBeNull();
  });
  it('rejects strict unsupported permissions before invoking the engine but preserves ordinary flows', async () => {
    let runs = 0;
    const engine: Engine = { cli: 'pi', available: async () => true, async *run() { runs++; } };
    await expect(collect(engine, { ...req, requireReadonly: true })).rejects.toThrow(/readonly/i);
    await expect(collect(engine, { ...req, requireSandbox: true })).rejects.toThrow(/sandbox/i);
    expect(runs).toBe(0);
    await collect(engine);
    expect(runs).toBe(1);
  });
});
it('emits unknown usage before a terminal error even if the caller stops immediately', async () => {
  const engine: Engine = { cli: 'pi', available: async () => true, async *run(_req, agentId) {
    yield { type: 'error', agentId, at, message: 'fixture failure' };
  } };
  const seen: EduEvent[] = [];
  for await (const event of measuredEngine(engine).run(req, 'failed')) {
    seen.push(event);
    if (event.type === 'error') break;
  }
  expect(seen.map(event => event.type)).toEqual(['usage', 'error']);
  expect(seen[0]).toMatchObject({ usage: { known: { inputTokens: false, costUsd: false } } });
});
