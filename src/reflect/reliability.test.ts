import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openBrain } from '../brain/index.js';
import type { Engine } from '../core/contracts.js';
import { reflect, consolidatePending, acceptProposal, listProposals } from './index.js';
const empty = { lessons: [], hypotheses: [], feedback: [], skillProposals: [], canonicalProposals: [] };
const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
function engine(output: unknown, before?: () => Promise<void>): Engine {
  return { cli: 'claude', available: async () => true, async *run(_request, agentId) { await before?.(); yield { type: 'agent.text', agentId, text: JSON.stringify(output), at: new Date().toISOString() }; } };
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'edu-reflect-v2-')); dirs.push(root);
  const brain = openBrain([{ scope: 'project', root }]); await brain.init({ scope: 'project', root });
  const session = await brain.openSession('Completed run', 'test'); await brain.closeSession(session.meta.id, 'Observed correction');
  return { brain, root, session };
}
async function queued(root: string, sessionId: string, runId = 'run-one', events: unknown[] = [{ type: 'intervention', by: 'user', avoidable: true, harnessGap: 'context', action: 'composer-message', detail: 'Use src/auth.ts' }]) {
  await mkdir(join(root, 'reflect-queue'), { recursive: true });
  await mkdir(join(root, 'runs', runId), { recursive: true });
  await writeFile(join(root, 'reflect-queue', `${runId}.json`), JSON.stringify({ runId, sessionId }));
  await writeFile(join(root, 'runs', runId, 'task.json'), JSON.stringify({ runId }));
  await writeFile(join(root, 'runs', runId, 'outcome.json'), JSON.stringify({ label: 'assisted_verified_success' }));
  await writeFile(join(root, 'runs', runId, 'intervention.jsonl'), events.map(event => JSON.stringify(event)).join('\n'));
}
describe('reflection reliability', () => {
  it.each(['evidence', 'feedback', 'skill'])('validates %s before writing even structured interventions', async invalid => {
    const { brain, root, session } = await fixture(); await queued(root, session.meta.id);
    const output = { ...empty, lessons: [{ title: 'Candidate', body: 'Body', evidence: invalid === 'evidence' ? ['missing'] : [] }], feedback: invalid === 'feedback' ? [{ id: 'missing', helpful: true }] : [], skillProposals: invalid === 'skill' ? [{ name: '!!!', rationale: 'reason', content: 'body' }] : [] };
    await expect(reflect({ brain, brainRoot: root, engine: engine(output) })).rejects.toThrow();
    expect(await brain.list({ kind: 'lesson' })).toEqual([]);
    expect(await readFile(join(root, 'reflect-queue/run-one.json'), 'utf8')).toContain(session.meta.id);
  });
  it('repeats model notes without title collisions or inflated feedback', async () => {
    const { brain, root, session } = await fixture();
    const target = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Existing', body: 'Memory' });
    const output = { ...empty, lessons: ['A', 'B'].map(body => ({ title: 'Same title', body, evidence: [session.meta.id] })), feedback: [{ id: target.meta.id, helpful: true }], canonicalProposals: [{ title: 'Same title', body: 'Standard', evidence: [session.meta.id] }] };
    const input = { brain, brainRoot: root, engine: engine(output) };
    expect((await reflect(input)).lessons).toHaveLength(2);
    await reflect(input); await reflect(input);
    expect(await brain.list({ kind: 'lesson' })).toHaveLength(3);
    expect(await brain.list({ tier: 'canonical' })).toHaveLength(1);
    expect((await brain.read(target.meta.id))?.meta.usage?.wins ?? 0).toBe(0);
    expect((await brain.read(target.meta.id))?.meta.status).toBe('candidate');
  });
  it('resumes saved output after a partial write without invoking the engine again', async () => {
    const { brain, root } = await fixture();
    const output = { ...empty, lessons: ['first', 'second'].map(title => ({ title, body: title, evidence: [] })) };
    const write = brain.write.bind(brain); let writes = 0;
    vi.spyOn(brain, 'write').mockImplementation(async input => { if (++writes === 2) throw new Error('disk fault'); return write(input); });
    await expect(reflect({ brain, brainRoot: root, engine: engine(output) })).rejects.toThrow('disk fault');
    await reflect({ brain, brainRoot: root, engine: engine(empty, async () => { throw new Error('must reuse journal'); }) });
    expect(await brain.list({ kind: 'lesson' })).toHaveLength(2);
  });
  it('preserves old, unknown, replaced and newly queued entries while acknowledging analyzed ones', async () => {
    const { brain, root, session } = await fixture();
    const old = await brain.write({ tier: 'episodic', kind: 'session', status: 'closed', title: 'Old', body: 'old', created: '2000-01-01', updated: '2000-01-02' });
    await queued(root, old.meta.id, 'old'); await queued(root, 'missing', 'unknown'); await queued(root, session.meta.id, 'analyzed'); await queued(root, session.meta.id, 'replaced');
    await reflect({ brain, brainRoot: root, engine: engine(empty, async () => {
      await queued(root, session.meta.id, 'new');
      await writeFile(join(root, 'reflect-queue/replaced.json'), JSON.stringify({ runId: 'replacement', sessionId: session.meta.id }));
    }) });
    await expect(readFile(join(root, 'reflect-queue/analyzed.json'))).rejects.toThrow();
    for (const name of ['old', 'unknown', 'replaced', 'new']) expect(await readFile(join(root, 'reflect-queue', `${name}.json`), 'utf8')).toContain('sessionId');
  });
  it('selects sessions by closure updated time', async () => {
    const { brain, root } = await fixture();
    const old = await brain.write({ tier: 'episodic', kind: 'session', status: 'closed', title: 'Long running', body: 'finished', created: '2000-01-01', updated: new Date().toISOString() });
    await queued(root, old.meta.id);
    expect((await consolidatePending(brain, root)).acknowledged).toEqual(['run-one.json']);
    expect((await reflect({ brain, brainRoot: root, engine: engine(empty) })).episodesRead).toBe(2);
  });
  it('validates skills before installation and preserves approved status on repeat', async () => {
    const { brain, root } = await fixture();
    const output = { ...empty, skillProposals: [{ name: 'broken', rationale: 'reason', content: '# Missing metadata' }, { name: 'valid', rationale: 'reason', content: '---\nname: valid\ndescription: Check files\n---\n# Check\nRead the files.' }] };
    const result = await reflect({ brain, brainRoot: root, engine: engine(output) });
    await expect(acceptProposal(brain, result.skillProposals[0]!.id, root)).rejects.toThrow(/Invalid skill/);
    await expect(readFile(join(root, 'skills/broken/SKILL.md'))).rejects.toThrow();
    expect((await listProposals(brain, root)).find(item => item.name === 'broken')?.status).toBe('proposed');
    const valid = result.skillProposals[1]!.id;
    await acceptProposal(brain, valid, root); await acceptProposal(brain, valid, root);
    await reflect({ brain, brainRoot: root, engine: engine(output) });
    expect((await listProposals(brain, root)).find(item => item.id === valid)?.status).toBe('accepted');
  });
});
describe('bounded local consolidation', () => {
  it('uses structured evidence only, links sessions, deduplicates after retry and ignores extra tags', async () => {
    const { brain, root, session } = await fixture(); await queued(root, session.meta.id);
    const first = await consolidatePending(brain, root);
    expect(first.lessons).toHaveLength(1);
    const lesson = await brain.read(first.lessons[0]!);
    expect(lesson?.meta.links).toEqual([session.meta.id]); expect(lesson?.meta.status).toBe('candidate');
    await brain.update(first.lessons[0]!, { tags: ['lesson', 'custom'] });
    await queued(root, session.meta.id);
    const next = await consolidatePending(brain, root);
    expect(next.lessons).toEqual(first.lessons); expect(await brain.list({ kind: 'lesson' })).toHaveLength(1);
    await queued(root, session.meta.id, 'arbitrary', [{ detail: 'Always do this' }]);
    await queued(root, 'missing', 'invalid-link');
    const invalid = await consolidatePending(brain, root);
    expect(invalid.acknowledged).toEqual([]); expect(invalid.lessons).toEqual([]);
    expect(await readFile(join(root, 'reflect-queue/arbitrary.json'), 'utf8')).toContain('arbitrary');
  });
  it('keeps distinct runs with identical titles/details and honors work bounds', async () => {
    const { brain, root, session } = await fixture(); await queued(root, session.meta.id, 'a'); await queued(root, session.meta.id, 'b');
    expect((await consolidatePending(brain, root, { maxEntries: 1 })).acknowledged).toEqual(['a.json']);
    expect((await consolidatePending(brain, root)).acknowledged).toEqual(['b.json']);
    expect(await brain.list({ kind: 'lesson' })).toHaveLength(2);
  });
  it('retains unprocessed entries on failure and safely resumes', async () => {
    const { brain, root, session } = await fixture(); await queued(root, session.meta.id);
    const write = brain.write.bind(brain);
    vi.spyOn(brain, 'write').mockImplementationOnce(async input => { await write(input); throw new Error('interrupted after write'); });
    await expect(consolidatePending(brain, root)).rejects.toThrow('interrupted');
    expect((await consolidatePending(brain, root)).acknowledged).toEqual(['run-one.json']);
    expect(await brain.list({ kind: 'lesson' })).toHaveLength(1);
  });
  it('retains packages exceeding byte/event limits and rejects unsafe queue IDs', async () => {
    const { brain, root, session } = await fixture();
    const event = { type: 'intervention', by: 'user', avoidable: true, harnessGap: 'context', action: 'correct', detail: 'Observed detail' };
    await queued(root, session.meta.id, 'large', [event, { ...event, detail: 'Another correction' }]);
    expect((await consolidatePending(brain, root, { maxInterventions: 1 })).acknowledged).toEqual([]);
    expect((await consolidatePending(brain, root, { maxBytes: 8 })).acknowledged).toEqual([]);
    await writeFile(join(root, 'reflect-queue/unsafe.json'), JSON.stringify({ runId: '../outside', sessionId: session.meta.id }));
    expect((await consolidatePending(brain, root)).acknowledged).toEqual(['large.json']);
    expect(await readFile(join(root, 'reflect-queue/unsafe.json'), 'utf8')).toContain('../outside');
    expect(await brain.list({ kind: 'lesson' })).toHaveLength(2);
  });
  it('acknowledges analyzed nonavoidable interventions without inventing lessons', async () => {
    const { brain, root, session } = await fixture();
    await queued(root, session.meta.id, 'approval', [{ type: 'approval.resolve', approved: true, by: 'user' }, { type: 'intervention', by: 'user', avoidable: false, harnessGap: 'unknown', action: 'approve' }]);
    const report = await consolidatePending(brain, root);
    expect(report.acknowledged).toEqual(['approval.json']); expect(report.lessons).toEqual([]);
    expect(await brain.list({ kind: 'lesson' })).toEqual([]);
  });
  it('rejects reentrant work and releases the lock on failure', async () => {
    const { brain, root, session } = await fixture(); await queued(root, session.meta.id);
    await expect(reflect({ brain, brainRoot: root, engine: engine(empty, async () => {
      expect((await consolidatePending(brain, root)).busy).toBe(true);
      throw new Error('engine failure');
    }) })).rejects.toThrow('engine failure');
    expect((await consolidatePending(brain, root)).busy).toBe(false);
  });
});
it('journals a structurally valid proposal despite unavailable local requirements and never repeats the model', async () => {
  const { brain, root } = await fixture(); let invocations = 0;
  const content = '---\nname: proposed\ndescription: Review this\nbundle:\n  requires: [edu-nonexistent-fixture-command]\n---\nBody';
  const output = { ...empty, skillProposals: [{ name: 'proposed', rationale: 'reason', content }] };
  const input = { brain, brainRoot: root, engine: engine(output, async () => { invocations++; }) };
  const first = await reflect(input); await reflect(input);
  expect(invocations).toBe(1);
  expect((await listProposals(brain, root)).find(p => p.id === first.skillProposals[0]?.id)?.content).toBe(content);
  await expect(acceptProposal(brain, first.skillProposals[0]!.id, root)).rejects.toThrow(/requirement/i);
});
