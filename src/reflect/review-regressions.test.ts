import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { Engine } from '../core/contracts.js';
import { openBrain } from '../brain/index.js';
import { reflect, consolidatePending } from './index.js';
import { locked } from './persistence.js';
const empty = { lessons: [], hypotheses: [], feedback: [], skillProposals: [], canonicalProposals: [] };
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'edu-review-reflect-')); dirs.push(root);
  const brain = openBrain([{ scope: 'project', root }]); await brain.init({ scope: 'project', root });
  const session = await brain.openSession('Episode', 'test'); await brain.closeSession(session.meta.id, 'Observed action');
  return { root, brain, session };
}
function engine(output: unknown): Engine { return { cli: 'claude', available: async () => true, async *run(_request, agentId) { yield { type: 'agent.text', agentId, text: JSON.stringify(output), at: new Date().toISOString() }; } }; }
async function queue(root: string, sessionId: string) {
  await mkdir(join(root, 'reflect-queue'), { recursive: true });
  await mkdir(join(root, 'runs/good'), { recursive: true });
  await writeFile(join(root, 'reflect-queue/z-valid.json'), JSON.stringify({ runId: 'good', sessionId }));
  await writeFile(join(root, 'runs/good/task.json'), JSON.stringify({ runId: 'good' }));
  await writeFile(join(root, 'runs/good/outcome.json'), JSON.stringify({ label: 'failed' }));
  await writeFile(join(root, 'runs/good/intervention.jsonl'), JSON.stringify({ type: 'intervention', by: 'user', avoidable: true, harnessGap: 'context', action: 'correct', detail: 'Use the right file' }));
}
it.each(['local', 'reflect'])('advances a persistent bounded cursor past stuck entries (%s)', async mode => {
  const { root, brain, session } = await setup(); await queue(root, session.meta.id);
  for (let i = 0; i < 50; i++) await writeFile(join(root, 'reflect-queue', `a-${i.toString().padStart(3, '0')}.json`), i % 2 ? '{broken' : JSON.stringify({ runId: 'missing', sessionId: 'missing' }));
  for (let i = 0; i < 2; i++) {
    // Reopen Brain to verify progress is on disk, not in a per-object cache.
    const reopened = openBrain([{ scope: 'project', root }]);
    if (mode === 'local') await consolidatePending(reopened, root);
    else await reflect({ brain: reopened, brainRoot: root, engine: engine(empty) });
  }
  expect(await brain.list({ kind: 'lesson' })).toHaveLength(1);
  await expect(readFile(join(root, 'reflect-queue/z-valid.json'))).rejects.toThrow();
  expect(await readFile(join(root, 'reflect-queue/a-001.json'), 'utf8')).toBe('{broken');
});
it('reaches entry 131 within seven bounded scans of twenty without deleting invalid entries', async () => {
  const { root, brain, session } = await setup(); await queue(root, session.meta.id);
  const retained = new Map<string, string>();
  for (let i = 0; i < 130; i++) {
    const name = `a-${i.toString().padStart(3, '0')}.json`;
    const raw = i % 2 ? '{broken' : JSON.stringify({ runId: 'incomplete', sessionId: 'missing' });
    retained.set(name, raw); await writeFile(join(root, 'reflect-queue', name), raw);
  }
  let acknowledgedAt = 0;
  for (let run = 1; run <= Math.ceil(131 / 20); run++) {
    const reopened = openBrain([{ scope: 'project', root }]);
    const report = await consolidatePending(reopened, root, { maxEntries: 20 });
    expect(report.skipped.length + report.acknowledged.length).toBeLessThanOrEqual(20);
    if (report.acknowledged.includes('z-valid.json')) { acknowledgedAt = run; break; }
  }
  expect(acknowledgedAt).toBe(7);
  expect(await brain.list({ kind: 'lesson' })).toHaveLength(1);
  await expect(readFile(join(root, 'reflect-queue/z-valid.json'))).rejects.toThrow();
  for (const [name, raw] of retained) expect(await readFile(join(root, 'reflect-queue', name), 'utf8')).toBe(raw);
});
it('recovers a confirmed dead owner but never steals a live lock', async () => {
  const { root, brain } = await setup();
  const deadPid = 2147483647;
  expect(() => process.kill(deadPid, 0)).toThrow();
  await writeFile(join(root, '.reflection.lock'), JSON.stringify({ pid: deadPid, startedAt: '2000-01-01' }));
  expect((await consolidatePending(brain, root)).busy).toBe(false);
  await writeFile(join(root, '.reflection.lock'), JSON.stringify({ pid: process.pid, startedAt: '2000-01-01' }));
  expect((await consolidatePending(brain, root)).busy).toBe(true);
});
it('cleanup never masks a successful result or the original action error', async () => {
  const { root } = await setup();
  expect(await locked(root, async () => { await rm(join(root, '.reflection.lock')); return 42; })).toBe(42);
  await expect(locked(root, async () => { await rm(join(root, '.reflection.lock')); throw new Error('original failure'); })).rejects.toThrow('original failure');
});
it('canonicalizes whitespace and CRLF before identity and replay comparisons', async () => {
  const { root, brain, session } = await setup();
  const output = { ...empty, lessons: [{ title: 'Whitespace', body: '  Rule one\r\nRule two\r\n ', evidence: [session.meta.id] }] };
  const first = await reflect({ brain, brainRoot: root, engine: engine(output) });
  const second = await reflect({ brain, brainRoot: root, engine: engine(output) });
  expect(second.lessons).toEqual(first.lessons);
  expect(await brain.list({ kind: 'lesson' })).toHaveLength(1);
});
it('does not manufacture evidence links or applied feedback, or promote historical proven notes', async () => {
  const { root, brain } = await setup();
  const proven = await brain.write({ tier: 'transitive', kind: 'lesson', status: 'proven', title: 'Imported proven', body: 'Rule' });
  const report = await reflect({ brain, brainRoot: root, engine: engine({ ...empty, lessons: [{ title: 'Uncited', body: 'Claim', evidence: [] }], feedback: [{ id: proven.meta.id, helpful: true }] }) });
  expect((await brain.read(report.lessons[0]!))?.meta.links).toEqual([]);
  expect(report.feedback).toEqual([]);
  expect(report.canonicalProposals).toEqual([]);
  expect(await brain.list({ tier: 'canonical' })).toEqual([]);
});
it('does not report rejected canonical proposals as created', async () => {
  const { root, brain, session } = await setup();
  const output = { ...empty, canonicalProposals: [{ title: 'Review this', body: 'Rule', evidence: [session.meta.id] }] };
  const first = await reflect({ brain, brainRoot: root, engine: engine(output) });
  await brain.rejectCanonical(first.canonicalProposals[0]!, 'Not accepted');
  const second = await reflect({ brain, brainRoot: root, engine: engine(output) });
  expect(second.canonicalProposals).toEqual([]);
  expect(await brain.list({ tier: 'canonical', status: 'proposed' })).toEqual([]);
});
it('reports a real valid JSONL log over 256 KiB as omitted, without supplying it', async () => {
  const { root, brain } = await setup();
  const log = join(root, 'runs/large.jsonl');
  await writeFile(log, JSON.stringify({ type: 'run.end', runId: 'large', summary: 'OVERSIZED-MARKER ' + 'x'.repeat(262145), at: new Date().toISOString() }) + '\n');
  expect((await stat(log)).size).toBeGreaterThan(256 * 1024);
  await writeFile(join(root, 'runs/small.jsonl'), JSON.stringify({ type: 'run.end', runId: 'small', summary: 'Small supplied summary', at: new Date().toISOString() }) + '\n');
  const checkedEngine: Engine = { ...engine(empty), async *run(request, agentId) {
    expect(request.prompt).not.toContain('OVERSIZED-MARKER');
    expect(request.prompt).toContain('Small supplied summary');
    yield { type: 'agent.text', agentId, text: JSON.stringify(empty), at: new Date().toISOString() };
  } };
  const report = await reflect({ brain, brainRoot: root, engine: checkedEngine });
  expect(report.omitted?.runLogFiles).toBe(1);
  expect(report.promptTokens).toBeLessThanOrEqual(8000);
  expect((await stat(log)).size).toBeGreaterThan(256 * 1024);
});

it('serializes simultaneous orphan recovery and recovers an orphaned recovery guard', async () => {
  const { root } = await setup();
  const stale = JSON.stringify({ pid: 2147483647, startedAt: '2000-01-01' });
  await writeFile(join(root, '.reflection.lock'), stale);
  await writeFile(join(root, '.reflection.lock.recovery'), stale);
  let active = 0; let maximum = 0;
  const action = async () => { active++; maximum = Math.max(maximum, active); await readFile(join(root, 'EDU.md')); active--; return 'done'; };
  const results = await Promise.all([locked(root, action), locked(root, action), locked(root, action)]);
  expect(results).toContain('done'); expect(maximum).toBe(1);
  expect(await locked(root, async () => 'retry')).toBe('retry');
});
it('does not count existing or rejected skill proposals as newly created', async () => {
  const { root, brain } = await setup();
  const output = { ...empty, skillProposals: [{ name: 'review-skill', rationale: 'Observed repeat', content: '---\nname: review-skill\ndescription: Review files\n---\nReview files.' }] };
  const first = await reflect({ brain, brainRoot: root, engine: engine(output) });
  expect(first.skillProposals).toHaveLength(1);
  const { rejectProposal } = await import('./index.js');
  await rejectProposal(brain, first.skillProposals[0]!.id, root);
  const second = await reflect({ brain, brainRoot: root, engine: engine(output) });
  expect(second.skillProposals).toEqual([]);
  expect(await readFile(first.skillProposals[0]!.path, 'utf8')).toContain('rejected');
});
