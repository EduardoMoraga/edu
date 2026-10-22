import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Command } from 'commander';
import { registerEvidence } from '../cli/commands/evidence.js';
import type { CliContext } from '../cli/context.js';
import { classifyPackage } from './classify.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const proof = { type: 'verify.result', requirementIds: ['R1'], kind: 'deterministic', ok: true };

async function fixture(verification: string, outcome: unknown = { label: 'autonomous_verified_success', metrics: { cli: 'fixture' } }, usage: unknown[] = []) {
  const root = await mkdtemp(join(tmpdir(), 'edu-metrics-v2-'));
  roots.push(root);
  const home = join(root, 'home');
  const dir = join(root, '.edu', 'runs', 'episode');
  await mkdir(home, { recursive: true });
  await mkdir(dir, { recursive: true });
  await Promise.all(Object.entries({
    'task.json': JSON.stringify({ runId: 'episode', requirements: [{ id: 'R1' }] }),
    'verification.jsonl': verification,
    'outcome.json': JSON.stringify(outcome),
    'entropy.json': JSON.stringify({ findings: [] }),
    'intervention.jsonl': '',
    'action.jsonl': [{ type: 'run.start', at: '2026-10-20T00:00:00Z' }, ...usage, { type: 'run.end', ok: true, at: '2026-10-20T00:00:02Z' }].map(event => JSON.stringify(event)).join('\n'),
  }).map(([name, content]) => writeFile(join(dir, name), content)));
  const output: string[] = [];
  const ctx: CliContext = { cwd: root, home, env: { HOME: home, EDU_HOME: join(home, '.edu-home'), EDU_CEILING_DIRECTORIES: root, PATH: '' },
    out: text => { output.push(text); }, err: text => { throw new Error(text); }, readStdin: async () => '', isTTY: false, stdinIsTTY: false,
    confirm: async () => false, detectClis: async () => [], setExitCode: code => { throw new Error(`exit ${code}`); } };
  const program = new Command();
  registerEvidence(program, ctx);
  await program.parseAsync(['metrics', '--since', '2026-01-01', '--json'], { from: 'user' });
  return { row: JSON.parse(output.join('\n'))[0], dir };
}

it('real CLI reclassifies contradictions and retains incomplete/corrupt episodes in the denominator', async () => {
  for (const verification of [JSON.stringify({ ...proof, ok: false }), JSON.stringify({ ...proof, ok: 'false' }), '{broken', JSON.stringify([proof])]) {
    const { row, dir } = await fixture(verification);
    expect(row).toMatchObject({ avsr: 0, n: 1 });
    expect(await classifyPackage(dir)).toBe('failed');
  }
  expect((await fixture(JSON.stringify(proof), {})).row).toMatchObject({ avsr: 0, n: 1 });
});

it('real CLI reports observed usage and missing data without inventing zeroes', async () => {
  const usage = (inputTokens: number, costUsd?: number) => ({ type: 'usage', usage: { inputTokens, outputTokens: 3, cacheReadTokens: 0, costUsd, known: { inputTokens: true, outputTokens: true, cacheReadTokens: true, costUsd: costUsd !== undefined } } });
  const { row } = await fixture(JSON.stringify(proof), undefined, [
    { type: 'agent.spawn', model: 'fixture-model' }, usage(10, 0.01), usage(20, 0.02),
  ]);
  expect(row).toMatchObject({ avsr: 1, deterministicVerificationShare: 1, resources: {
    inputTokens: 30, outputTokens: 6, cacheReadTokens: 0, cacheWriteTokens: null, costUsd: 0.03, elapsedMs: 2000, models: ['fixture-model'],
  } });
  expect((await fixture(JSON.stringify(proof), undefined, [usage(10, 0.01), usage(20)])).row.resources.costUsd).toBeNull();
  expect((await fixture(JSON.stringify(proof))).row.resources.inputTokens).toBeNull();
});

it('deduplicates stable observation IDs and preserves explicit unknowns after JSON persistence', async () => {
  const measured = { type: 'usage', usage: { inputTokens: 10, outputTokens: 0, costUsd: 0, observationId: 'call:0', known: { inputTokens: true, outputTokens: true, costUsd: true } } };
  const missing = { type: 'usage', usage: { inputTokens: 0, outputTokens: 0, observationId: 'call2:0', known: { inputTokens: false, outputTokens: false, costUsd: false } } };
  expect((await fixture(JSON.stringify(proof), undefined, [measured, measured])).row.resources).toMatchObject({ inputTokens: 10, outputTokens: 0, costUsd: 0 });
  expect((await fixture(JSON.stringify(proof), undefined, [measured, missing])).row.resources).toMatchObject({ inputTokens: null, outputTokens: null, costUsd: null });
  expect((await fixture(JSON.stringify(proof), undefined, [{ type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } }])).row.resources.inputTokens).toBeNull();
});
