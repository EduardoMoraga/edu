import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { EduEvent, Engine, EngineRunRequest } from '../core/contracts.js';
import { openBrain } from '../brain/index.js';
import { atomicFs } from '../brain/store.js';
import { reflect, feedbackCandidates } from './reflect.js';
import { acceptProposal, listProposals, rejectProposal } from './proposals.js';

const response = { lessons: [{ title: 'Keep boundaries small', body: 'Small boundaries make testing easier.', evidence: [] }], hypotheses: [{ title: 'Parallelism helps', body: 'Independent steps may run faster.', evidence: [] }], feedback: [], skillProposals: [{ name: 'review-helper', rationale: 'Repeatable check.', content: '# Review helper\n\nCheck risks.' }], canonicalProposals: [] };
const fake: Engine = { cli: 'claude', available: async () => true, async *run(_request: EngineRunRequest, agentId: string): AsyncIterable<EduEvent> { yield { type: 'agent.text', agentId, text: JSON.stringify(response), at: new Date().toISOString() }; } };

describe('reflect', () => {
  it('bounds candidate metadata without copying note bodies into the prompt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-reflect-budget-'));
    const brain = openBrain([{ scope: 'project', root }]);
    try {
      const episode = await brain.openSession('Budget episode', 'test');
      await brain.closeSession(episode.meta.id, 'Small evidence.');
      const note = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Large candidate', body: 'PRIVATE-BODY-'.repeat(10000) });
      const large = Array.from({ length: 1000 }, (_, i) => ({ ...note, meta: { ...note.meta, id: `L-${i}`, title: 'Título largo '.repeat(50) } }));
      expect(Buffer.byteLength(JSON.stringify(feedbackCandidates(large)), 'utf8')).toBeLessThanOrEqual(6000);
      const engine: Engine = { ...fake, async *run(request, agentId) {
        expect(request.prompt).not.toContain('PRIVATE-BODY-');
        expect(Buffer.byteLength(request.prompt, 'utf8')).toBeLessThan(9000);
        yield { type: 'agent.text', agentId, text: JSON.stringify({ ...response, lessons: [], hypotheses: [], skillProposals: [] }), at: new Date().toISOString() };
      } };
      await reflect({ brain, engine, brainRoot: root });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('replays past a removed feedback candidate without invoking the engine again', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-reflect-removed-'));
    const brain = openBrain([{ scope: 'project', root }]);
    try {
      const episode = await brain.openSession('Removed candidate episode', 'test');
      await brain.closeSession(episode.meta.id, 'Evidence.');
      const note = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Temporary candidate', body: 'Fixture' });
      let calls = 0;
      const engine: Engine = { ...fake, async *run(_request, agentId) {
        calls++;
        yield { type: 'agent.text', agentId, text: JSON.stringify({ ...response, feedback: [{ id: note.meta.id, helpful: true }] }), at: new Date().toISOString() };
      } };
      const spy = vi.spyOn(brain, 'feedback').mockRejectedValueOnce(new Error('temporary interruption'));
      await expect(reflect({ brain, engine, brainRoot: root })).rejects.toThrow('temporary interruption');
      spy.mockRestore();
      await rm(note.path);
      const report = await reflect({ brain, engine, brainRoot: root });
      expect(calls).toBe(1);
      expect(report.feedback).toEqual([]);
      expect(report.message).toContain('Skipped invalid feedback target');
      expect(report.skillProposals).toHaveLength(1);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('retries partial application without duplicating notes, feedback or skill proposals', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-reflect-replay-'));
    const brain = openBrain([{ scope: 'project', root }]);
    let spy: ReturnType<typeof vi.spyOn> | undefined;
    try {
      const episode = await brain.openSession('Replay completed episode', 'test');
      await brain.closeSession(episode.meta.id, 'Evidence for replay.');
      const lesson = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Existing feedback candidate', body: 'Useful lesson.' });
      const payload = { ...response, feedback: [{ id: lesson.meta.id, helpful: true }, { id: episode.meta.id, helpful: true }, { id: 'invented', helpful: true }, { id: 'L-keep-boundaries-small', helpful: true }] };
      let calls = 0;
      const engine: Engine = { ...fake, async *run(request, agentId) {
        calls++;
        expect(request.prompt).toContain('Feedback candidates:');
        expect(request.prompt).toContain(lesson.meta.id);
        // If replay calls the model again, it would produce conflicting body/evidence.
        const next = calls === 1 ? payload : { ...payload, lessons: [{ ...response.lessons[0]!, body: 'A different model response.', evidence: ['changed-evidence'] }] };
        yield { type: 'agent.text', agentId, text: JSON.stringify(next), at: new Date().toISOString() };
      } };
      await mkdir(join(root, 'reflect-queue'), { recursive: true });
      const queued = join(root, 'reflect-queue', 'pending.json');
      await writeFile(queued, '{}');
      const original = brain.feedback.bind(brain);
      spy = vi.spyOn(brain, 'feedback').mockImplementationOnce(async (...args) => {
        await original(...args);
        throw new Error('Failure after feedback was persisted');
      });
      await expect(reflect({ brain, engine, brainRoot: root })).rejects.toThrow('Failure after feedback');
      expect(await readFile(queued, 'utf8')).toBe('{}');
      const cache = await readdir(join(root, 'state', 'reflect-responses'));
      expect(cache).toHaveLength(1);
      expect(JSON.parse(await readFile(join(root, 'state', 'reflect-responses', cache[0]!), 'utf8')).output).toEqual(payload);
      spy.mockRestore();
      const retry = await reflect({ brain: openBrain([{ scope: 'project', root }]), engine, brainRoot: root });
      expect(retry.message).toContain('Skipped invalid feedback target');
      await reflect({ brain, engine, brainRoot: root });
      expect((await brain.list({ kind: 'lesson' })).length).toBe(2);
      expect((await brain.list({ kind: 'hypothesis' })).length).toBe(1);
      expect((await brain.read(lesson.meta.id))?.meta.usage?.wins).toBe(1);
      expect((await brain.read('L-keep-boundaries-small'))?.body).toBe(response.lessons[0]!.body);
      expect((await brain.read('L-keep-boundaries-small'))?.meta.usage).toBeUndefined();
      expect(calls).toBe(1);
      expect(await listProposals(brain, root)).toHaveLength(1);
      await expect(readFile(queued, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { spy?.mockRestore(); await rm(root, { recursive: true, force: true }); }
  });

  it('skips conflicting lessons, hypotheses and unreadable destinations while finishing feedback, proposals and queue', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-reflect-conflicts-'));
    const brain = openBrain([{ scope: 'project', root }]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const episode = await brain.openSession('Collision evidence', 'test');
      await brain.closeSession(episode.meta.id, 'Completed.');
      const lesson = await brain.write({ tier: 'transitive', kind: 'lesson', title: response.lessons[0]!.title, body: 'Human evidence must survive.' });
      const hypothesis = await brain.write({ tier: 'transitive', kind: 'hypothesis', title: response.hypotheses[0]!.title, body: 'Original hypothesis.' });
      const broken = join(root, 'brain', '3-transitive', 'L-broken-destination.md');
      await writeFile(broken, 'malformed original');
      const payload = { ...response, lessons: [...response.lessons, { title: 'Broken destination', body: 'Replacement', evidence: [] }, { title: 'Nonconflicting lesson', body: 'New evidence.', evidence: [episode.meta.id] }], feedback: [{ id: lesson.meta.id, helpful: true }], canonicalProposals: [{ title: 'Safe standard', body: 'Proposed only.', evidence: [lesson.meta.id] }] };
      const engine: Engine = { ...fake, async *run(_request, agentId) { yield { type: 'agent.text', agentId, text: JSON.stringify(payload), at: new Date().toISOString() }; } };
      await mkdir(join(root, 'reflect-queue'), { recursive: true });
      await writeFile(join(root, 'reflect-queue', 'pending.json'), '{}');
      const report = await reflect({ brain, engine, brainRoot: root });
      expect(report.message).toContain(lesson.meta.id);
      expect(report.message).toContain(hypothesis.meta.id);
      expect(report.message).toContain('L-broken-destination');
      expect(report.lessons).toEqual(['L-nonconflicting-lesson']);
      expect(report.hypotheses).toEqual([]);
      expect(report.feedback).toEqual([lesson.meta.id]);
      expect(report.skillProposals).toHaveLength(1);
      expect(report.canonicalProposals).toEqual(['K-safe-standard']);
      expect((await brain.read(lesson.meta.id))?.body).toBe(lesson.body);
      expect((await brain.read(hypothesis.meta.id))?.body).toBe(hypothesis.body);
      expect(await readFile(broken, 'utf8')).toBe('malformed original');
      expect(await readdir(join(root, 'reflect-queue'))).toEqual([]);
    } finally { warn.mockRestore(); await rm(root, { recursive: true, force: true }); }
  });

  it('applies no model effects if publishing the replay response fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-reflect-save-failure-'));
    const brain = openBrain([{ scope: 'project', root }]);
    let spy: ReturnType<typeof vi.spyOn> | undefined;
    try {
      const episode = await brain.openSession('Persistence evidence', 'test');
      await brain.closeSession(episode.meta.id, 'Completed.');
      await mkdir(join(root, 'reflect-queue'), { recursive: true });
      await writeFile(join(root, 'reflect-queue', 'pending.json'), '{}');
      spy = vi.spyOn(atomicFs, 'link').mockRejectedValueOnce(Object.assign(new Error('disk full'), { code: 'ENOSPC' }));
      await expect(reflect({ brain, engine: fake, brainRoot: root })).rejects.toThrow('disk full');
      expect(await brain.list({ tier: 'transitive' })).toEqual([]);
      expect(await listProposals(brain, root)).toEqual([]);
      expect(await readdir(join(root, 'state', 'reflect-responses'))).toEqual([]);
      expect(await readFile(join(root, 'reflect-queue', 'pending.json'), 'utf8')).toBe('{}');
      spy.mockRestore();
      expect((await reflect({ brain, engine: fake, brainRoot: root })).lessons).toHaveLength(1);
    } finally { spy?.mockRestore(); await rm(root, { recursive: true, force: true }); }
  });

  it('skips unreadable skill/canonical destinations and continues to the next proposal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-reflect-proposal-collisions-'));
    const brain = openBrain([{ scope: 'project', root }]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const episode = await brain.openSession('Proposal collisions', 'test');
      await brain.closeSession(episode.meta.id, 'Completed.');
      const skill = response.skillProposals[0]!;
      const hash = createHash('sha256').update(JSON.stringify([skill.content, ''])).digest('hex').slice(0, 16);
      const skillPath = join(root, 'proposals', `skill-review-helper-${hash}.md`);
      const canonicalPath = join(root, 'brain', '1-canonical', 'standard', 'occupied.md');
      await mkdir(join(root, 'proposals'), { recursive: true });
      await mkdir(join(root, 'brain', '1-canonical', 'standard'), { recursive: true });
      await writeFile(skillPath, 'unreadable skill');
      await writeFile(canonicalPath, 'unreadable canonical');
      const payload = { ...response, lessons: [], hypotheses: [], canonicalProposals: [{ title: 'Occupied', body: 'Replacement', evidence: [] }, { title: 'Next proposal', body: 'Safe proposed standard.', evidence: [] }] };
      const engine: Engine = { ...fake, async *run(_request, agentId) { yield { type: 'agent.text', agentId, text: JSON.stringify(payload), at: new Date().toISOString() }; } };
      const report = await reflect({ brain, engine, brainRoot: root });
      expect(report.skillProposals).toEqual([]);
      expect(report.canonicalProposals).toEqual(['K-next-proposal']);
      expect(report.message).toContain('skill-review-helper-');
      expect(report.message).toContain('K-occupied');
      expect(await readFile(skillPath, 'utf8')).toBe('unreadable skill');
      expect(await readFile(canonicalPath, 'utf8')).toBe('unreadable canonical');
    } finally { warn.mockRestore(); await rm(root, { recursive: true, force: true }); }
  });

  it.each(['proposed', 'accepted', 'rejected'] as const)('respects a %s maintain proposal and never bulk-proposes imported proven lessons', async status => {
    const root = await mkdtemp(join(tmpdir(), 'edu-reflect-maintain-'));
    const brain = openBrain([{ scope: 'project', root }]);
    try {
      const episode = await brain.openSession('Promotion evidence', 'test');
      await brain.closeSession(episode.meta.id, 'Completed.');
      const lesson = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Promoted once', body: 'Supported lesson.' });
      await brain.update(lesson.meta.id, { usage: { uses: 3, wins: 3, losses: 0, lastUsed: new Date().toISOString() } });
      await brain.maintain();
      const proposal = (await brain.list({ tier: 'canonical' }))[0]!;
      if (status === 'accepted') await brain.acceptCanonical(proposal.meta.id);
      if (status === 'rejected') await brain.rejectCanonical(proposal.meta.id, 'Do not repeat.');
      await brain.write({ tier: 'transitive', kind: 'lesson', status: 'proven', title: 'Imported proven lesson', body: 'Imported history.', source: 'import:albert' });
      const payload = { lessons: [], hypotheses: [], feedback: [], skillProposals: [], canonicalProposals: [{ title: lesson.meta.title, body: lesson.body, evidence: [lesson.meta.id] }, { title: 'Renamed repeat', body: lesson.body, evidence: [lesson.meta.id] }] };
      const engine: Engine = { ...fake, async *run(_request, agentId) { yield { type: 'agent.text', agentId, text: JSON.stringify(payload), at: new Date().toISOString() }; } };
      const report = await reflect({ brain, engine, brainRoot: root });
      expect(report.canonicalProposals).toEqual([]);
      expect(await brain.list({ tier: 'canonical' })).toHaveLength(status === 'rejected' ? 0 : 1);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('does not re-propose a rejected skill and preserves queue entries arriving during the engine call', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-reflect-skill-reject-'));
    const brain = openBrain([{ scope: 'project', root }]);
    try {
      const episode = await brain.openSession('Skill evidence', 'test');
      await brain.closeSession(episode.meta.id, 'Completed.');
      const first = await reflect({ brain, engine: fake, brainRoot: root });
      await rejectProposal(brain, first.skillProposals[0]!.id, root);
      // New completed evidence starts a new model call; identical evidence uses the persisted replay.
      const next = await brain.openSession('New skill evidence', 'test');
      await brain.closeSession(next.meta.id, 'Another completed episode.');
      const engine: Engine = { ...fake, async *run(_request, agentId) {
        await mkdir(join(root, 'reflect-queue'), { recursive: true });
        await writeFile(join(root, 'reflect-queue', 'new.json'), '{}');
        yield { type: 'agent.text', agentId, text: JSON.stringify(response), at: new Date().toISOString() };
      } };
      expect((await reflect({ brain, engine, brainRoot: root })).skillProposals).toEqual([]);
      expect(await listProposals(brain, root)).toHaveLength(1);
      expect(await readFile(join(root, 'reflect-queue', 'new.json'), 'utf8')).toBe('{}');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('returns a clear no-op report for an empty brain without invoking an engine', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-reflect-empty-'));
    const root = join(dir, '.edu');
    const brain = openBrain([{ scope: 'project', root }]);
    const never: Engine = { ...fake, async *run() { throw new Error('engine must not run'); } };
    try {
      await brain.init({ scope: 'project', root });
      const report = await reflect({ brain, engine: never, brainRoot: root });
      expect(report).toMatchObject({ episodesRead: 0, message: 'Nothing to reflect yet.', lessons: [], hypotheses: [] });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('writes evidence-linked notes and skill proposals without applying them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-reflect-'));
    const root = join(dir, '.edu');
    const brain = openBrain([{ scope: 'project', root }]);
    try {
      await brain.init({ scope: 'project', root });
      const episode = await brain.openSession('Recent run', 'edu:orchestrator');
      await brain.closeSession(episode.meta.id, 'A completed run.');
      await mkdir(join(root, 'reflect-queue'), { recursive: true });
      await writeFile(join(root, 'reflect-queue', 'queued.json'), '{"runId":"queued"}');
      const report = await reflect({ brain, engine: fake, since: '7d', now: new Date() });
      expect(report.lessons).toHaveLength(1);
      expect((await brain.list({ kind: 'lesson' })).length).toBe(1);
      const hypotheses = await brain.list({ kind: 'hypothesis' });
      expect(hypotheses).toHaveLength(1);
      expect(hypotheses[0]?.meta.band).toBe('hypothesis');
      const proposalFiles = await readFile(report.skillProposals[0]!.path, 'utf8');
      expect(proposalFiles).toContain('Check risks.');
      await expect(readFile(join(root, 'skills/review-helper/SKILL.md'), 'utf8')).rejects.toThrow();
      await expect(readFile(join(root, 'reflect-queue/queued.json'), 'utf8')).rejects.toThrow();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('rejects malformed reflection JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-reflect-invalid-'));
    const root = join(dir, '.edu');
    const brain = openBrain([{ scope: 'project', root }]);
    const bad: Engine = { ...fake, async *run(_request, agentId) { yield { type: 'agent.text', agentId, text: '{bad', at: new Date().toISOString() }; } };
    try {
      await brain.init({ scope: 'project', root });
      await brain.openSession('Invalid JSON test', 'test').then(note => brain.closeSession(note.meta.id, 'Closed'));
      await expect(reflect({ brain, engine: bad })).rejects.toThrow(/JSON|reflection/i);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('rejects reflection responses that omit required arrays', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-reflect-schema-'));
    const root = join(dir, '.edu');
    const brain = openBrain([{ scope: 'project', root }]);
    const incomplete: Engine = { ...fake, async *run(_request, agentId) { yield { type: 'agent.text', agentId, text: '{"lessons":[]}', at: new Date().toISOString() }; } };
    try {
      await brain.init({ scope: 'project', root });
      await brain.openSession('Schema test', 'test').then(note => brain.closeSession(note.meta.id, 'Closed'));
      await expect(reflect({ brain, engine: incomplete, brainRoot: root })).rejects.toThrow();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('preserves diff-only skill proposals and refuses to install them as complete skills', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-skill-diff-'));
    const root = join(dir, '.edu');
    const brain = openBrain([{ scope: 'project', root }]);
    const diffResponse = { ...response, skillProposals: [{ name: 'patch-only', rationale: 'A patch requires a base.', diff: '--- a/SKILL.md\n+++ b/SKILL.md\n@@ -1 +1 @@\n-old\n+new' }] };
    const diffEngine: Engine = { ...fake, async *run(_request, agentId) { yield { type: 'agent.text', agentId, text: JSON.stringify(diffResponse), at: new Date().toISOString() }; } };
    try {
      await brain.init({ scope: 'project', root });
      const episode = await brain.openSession('Recent run', 'edu:orchestrator');
      await brain.closeSession(episode.meta.id, 'A completed run.');
      const report = await reflect({ brain, engine: diffEngine });
      await expect(acceptProposal(brain, report.skillProposals[0]!.id)).rejects.toThrow(/diff-only/i);
      await expect(readFile(join(root, 'skills/patch-only/SKILL.md'), 'utf8')).rejects.toThrow();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('turns avoidable harness interventions into tagged candidate lessons and reports M-HIR by gap', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-harness-gap-'));
    const root = join(dir, '.edu');
    const runs = join(root, 'runs');
    const brain = openBrain([{ scope: 'project', root }]);
    const prompts: string[] = [];
    const engine: Engine = { ...fake, async *run(request, agentId) { prompts.push(request.prompt); yield { type: 'agent.text', agentId, text: JSON.stringify({ ...response, lessons: [] }), at: new Date().toISOString() }; } };
    try {
      await brain.init({ scope: 'project', root });
      await brain.openSession('Recent run', 'edu:orchestrator').then(note => brain.closeSession(note.meta.id, 'A completed run.'));
      const episodeDir = join(runs, 'run-one');
      await mkdir(episodeDir, { recursive: true });
      await writeFile(join(episodeDir, 'task.json'), JSON.stringify({ runId: 'run-one' }));
      await writeFile(join(episodeDir, 'outcome.json'), JSON.stringify({ label: 'assisted_verified_success' }));
      await writeFile(join(episodeDir, 'intervention.jsonl'), `${JSON.stringify({ type: 'intervention', by: 'user', avoidable: true, harnessGap: 'context', action: 'composer-message', detail: 'The request omitted a required file path.' })}\n`);
      const report = await reflect({ brain, engine, brainRoot: root });
      const lessons = await brain.list({ tier: 'transitive', kind: 'lesson' });
      expect(report.lessons).toHaveLength(1);
      expect(lessons[0]?.meta.tags).toContain('harness-gap:context');
      expect(prompts[0]).toContain('M-HIR by gap');
      expect(prompts[0]).toContain('context');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
