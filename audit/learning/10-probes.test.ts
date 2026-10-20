import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Command } from 'commander';
import { classifyPackage } from '../../src/evidence/classify.js';
import { aggregateMetrics, type EpisodeSummary } from '../../src/evidence/metrics.js';
import { runCheck } from '../../src/evidence/registry.js';
import { feedbackUsage, lessonStatus } from '../../src/brain/learning.js';
import { registerEvidence } from '../../src/cli/commands/evidence.js';
import type { CliContext } from '../../src/cli/context.js';

const proof = { type: 'verify.result', requirementIds: ['R1'], kind: 'deterministic', ok: true };
async function fixture(verifications: unknown[], outcome?: unknown) {
  const root = await mkdtemp('/tmp/10-evaluation-');
  await writeFile(join(root, 'task.json'), JSON.stringify({ requirements: [{ id: 'R1', text: 'artifact exists' }] }));
  await writeFile(join(root, 'verification.jsonl'), verifications.map(v => JSON.stringify(v)).join('\n'));
  if (outcome) await writeFile(join(root, 'outcome.json'), JSON.stringify(outcome));
  return root;
}
it('missing terminal outcome still gets autonomous verified success', async () => {
  expect(await classifyPackage(await fixture([proof]))).toBe('autonomous_verified_success');
});
it('a review pass overwrites a failed deterministic requirement', async () => {
  expect(await classifyPackage(await fixture([{ ...proof, ok: false }, { ...proof, kind: 'review' }], { ok: true }))).toBe('autonomous_verified_success');
});
it('string false is accepted as truthy verification', async () => {
  expect(await classifyPackage(await fixture([{ ...proof, ok: 'false' }], { ok: true }))).toBe('autonomous_verified_success');
});
it('empty package is called unverified success rather than incomplete', async () => {
  expect(await classifyPackage(await mkdtemp('/tmp/10-evaluation-empty-'))).toBe('unverified_success');
});
it('verification autonomy is 100% even when every check fails', () => {
  const episode: EpisodeSummary = { runId: 'x', startedAt: '2026-10-20T00:00:00Z', outcome: 'failed', interventions: [], verifications: [{ kind: 'deterministic', ok: false }], toolCalls: 0, recoveredTools: 0, attributions: [], entropySeverity: 3 };
  expect(aggregateMetrics([episode])[0]).toMatchObject({ avsr: 0, mhir: 0, verificationAutonomy: 1, entropyDelta: 3 });
});
it('three duplicate helpful assertions produce proven without any use or evidence', () => {
  const now = new Date('2026-10-20T00:00:00Z');
  let usage;
  for (let i = 0; i < 3; i++) usage = feedbackUsage(usage, true, now);
  expect(usage).toMatchObject({ uses: 0, wins: 3 });
  expect(lessonStatus({ id: 'L1', title: 'unsupported', tier: 'transitive', kind: 'lesson', status: 'candidate', tags: [], links: [], created: now.toISOString(), updated: now.toISOString(), usage }, now)).toBe('proven');
});
it('a tautological deterministic command verifies an unrelated requirement', async () => {
  const root = await mkdtemp('/tmp/10-evaluation-check-');
  const result = await runCheck({ id: 'fake-oracle', requirementIds: ['R1'], command: 'printf ready', expect: { exitCode: 0, stdoutIncludes: 'ready' }, timeoutMs: 1000 }, root);
  expect(result.ok).toBe(true);
  expect(await classifyPackage(await fixture([{ ...proof, ...result }], { ok: true }))).toBe('autonomous_verified_success');
});
it('metrics trusts outcome label despite deterministic failure in the same package', async () => {
  const root = await mkdtemp('/tmp/10-evaluation-cli-');
  const home = join(root, 'home');
  const dir = join(root, '.edu', 'runs', 'contradiction');
  await mkdir(home, { recursive: true });
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'task.json'), JSON.stringify({ runId: 'contradiction', requirements: [{ id: 'R1' }] }));
  await writeFile(join(dir, 'verification.jsonl'), JSON.stringify({ ...proof, ok: false }));
  await writeFile(join(dir, 'outcome.json'), JSON.stringify({ label: 'autonomous_verified_success', metrics: { cli: 'fixture' } }));
  await writeFile(join(dir, 'action.jsonl'), JSON.stringify({ type: 'run.start', at: new Date().toISOString() }));
  const output: string[] = [];
  const ctx: CliContext = { cwd: root, home, env: { HOME: home, EDU_HOME: join(home, '.edu-home'), EDU_CEILING_DIRECTORIES: root, PATH: '' }, out: text => { output.push(text); }, err: text => { throw new Error(text); }, readStdin: async () => '', isTTY: false, stdinIsTTY: false, confirm: async () => false, detectClis: async () => [], setExitCode: code => { throw new Error(`exit ${code}`); } };
  const program = new Command();
  registerEvidence(program, ctx);
  await program.parseAsync(['metrics', '--json'], { from: 'user' });
  expect(JSON.parse(output.join('\n'))).toEqual([expect.objectContaining({ avsr: 1, verificationAutonomy: 1, n: 1 })]);
  expect(await classifyPackage(dir)).toBe('failed');
});
