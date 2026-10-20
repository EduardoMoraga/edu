import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { openBrain } from '../brain/index.js';
import { estimateTokens } from '../context/tokens.js';
import type { Engine } from '../core/contracts.js';
import { reflect } from './index.js';
const empty = { lessons: [], hypotheses: [], feedback: [], skillProposals: [], canonicalProposals: [] };
describe('reflection request budget', () => {
  it('bounds the complete request and preserves every queue entry not supplied', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-reflect-budget-'));
    try {
      const brain = openBrain([{ scope: 'project', root }]); await brain.init({ scope: 'project', root });
      await mkdir(join(root, 'reflect-queue'), { recursive: true });
      const ids: string[] = [];
      for (let i = 0; i < 35; i++) {
        const session = await brain.write({ tier: 'episodic', kind: 'session', status: 'closed', title: `Session ${i}`, body: 'Large body 漢字 "\\\n'.repeat(400), updated: `2026-10-20T00:${String(i).padStart(2, '0')}:00.000Z` });
        ids.push(session.meta.id);
        await brain.write({ tier: 'transitive', kind: 'lesson', title: `Target ${i}`, body: 'More context '.repeat(1000) });
        const runId = `run-${i}`;
        await mkdir(join(root, 'runs', runId), { recursive: true });
        await writeFile(join(root, 'reflect-queue', `${runId}.json`), JSON.stringify({ runId, sessionId: session.meta.id }));
        await writeFile(join(root, 'runs', runId, 'task.json'), JSON.stringify({ runId }));
        await writeFile(join(root, 'runs', runId, 'outcome.json'), JSON.stringify({ label: 'unverified_success' }));
        await writeFile(join(root, 'runs', runId, 'intervention.jsonl'), '');
      }
      let supplied: string[] = []; let requestTokens = 0;
      const engine: Engine = { cli: 'claude', available: async () => true, async *run(request, agentId) {
        requestTokens = estimateTokens(request.prompt);
        expect(requestTokens).toBeLessThanOrEqual(2000);
        const episodes = JSON.parse(request.prompt.split('\n\n').find(part => part.startsWith('Episodes: '))!.slice('Episodes: '.length));
        supplied = episodes.map((note: { id: string }) => note.id);
        expect(supplied.length).toBeGreaterThan(0); expect(supplied.length).toBeLessThanOrEqual(4);
        expect(supplied[0]).toBe(ids[0]); // Fair queue order takes precedence over recency.
        for (const label of ['Memory targets: ', 'Run summaries: ', 'Structured interventions: ']) JSON.parse(request.prompt.split('\n\n').find(part => part.startsWith(label))!.slice(label.length));
        yield { type: 'agent.text', agentId, text: JSON.stringify(empty), at: new Date().toISOString() };
      } };
      const report = await reflect({ brain, brainRoot: root, engine, budgetTokens: 2000, maxEpisodes: 4, now: new Date('2026-10-20T01:00:00Z') });
      expect(report.episodesRead).toBe(supplied.length);
      expect(report.promptTokens).toBe(requestTokens);
      expect(report.omitted?.episodes).toBe(ids.length - supplied.length);
      for (const [i, id] of ids.entries()) if (!supplied.includes(id)) {
        expect(report.deferred).toContain(id);
        expect(await readFile(join(root, 'reflect-queue', `run-${i}.json`), 'utf8')).toContain(id);
      }
      const omittedId = ids.at(-1)!;
      const badEngine: Engine = { ...engine, async *run(_request, agentId) {
        yield { type: 'agent.text', agentId, text: JSON.stringify({ ...empty, lessons: [{ title: 'Unseen evidence', body: 'Unsupported', evidence: [omittedId] }] }), at: new Date().toISOString() };
      } };
      await expect(reflect({ brain, brainRoot: root, engine: badEngine, budgetTokens: 1500, maxEpisodes: 1, now: new Date('2026-10-20T01:00:00Z') })).rejects.toThrow('Invalid reflection evidence ID');
      expect(await brain.list({ kind: 'lesson' })).toHaveLength(35);

    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('does not invoke an engine when no episode fits the budget', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-reflect-small-budget-'));
    try {
      const brain = openBrain([{ scope: 'project', root }]); await brain.init({ scope: 'project', root });
      const session = await brain.openSession('Recent', 'test'); await brain.closeSession(session.meta.id, 'Closed');
      const run = vi.fn(async function* () { throw new Error('must not run'); });
      const report = await reflect({ brain, brainRoot: root, budgetTokens: 1, engine: { cli: 'claude', available: async () => true, run } });
      expect(run).not.toHaveBeenCalled(); expect(report.episodesRead).toBe(0);
      expect(report.deferred).toEqual([session.meta.id]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('retains a package whose interventions cannot fit even when its session was supplied', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-reflect-evidence-budget-'));
    try {
      const brain = openBrain([{ scope: 'project', root }]); await brain.init({ scope: 'project', root });
      const session = await brain.openSession('Recent', 'test'); await brain.closeSession(session.meta.id, 'Closed');
      await mkdir(join(root, 'runs/run'), { recursive: true }); await mkdir(join(root, 'reflect-queue'), { recursive: true });
      await writeFile(join(root, 'reflect-queue/run.json'), JSON.stringify({ runId: 'run', sessionId: session.meta.id }));
      await writeFile(join(root, 'runs/run/task.json'), JSON.stringify({ runId: 'run' }));
      await writeFile(join(root, 'runs/run/outcome.json'), JSON.stringify({ label: 'failed' }));
      await writeFile(join(root, 'runs/run/intervention.jsonl'), JSON.stringify({ type: 'intervention', by: 'user', avoidable: true, harnessGap: 'context', action: 'correct', detail: 'Large correction '.repeat(4000) }));
      const engine: Engine = { cli: 'claude', available: async () => true, async *run(request, agentId) {
        expect(estimateTokens(request.prompt)).toBeLessThanOrEqual(1000);
        yield { type: 'agent.text', agentId, text: JSON.stringify(empty), at: new Date().toISOString() };
      } };
      const report = await reflect({ brain, brainRoot: root, engine, budgetTokens: 1000 });
      expect(report.episodesRead).toBe(1); expect(report.omitted?.interventions).toBe(1);
      expect(report.lessons).toEqual([]);
      expect(await readFile(join(root, 'reflect-queue/run.json'), 'utf8')).toContain(session.meta.id);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('keeps repeated opinions advisory under the new Brain.feedback contract', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-reflect-advisory-'));
    try {
      const brain = openBrain([{ scope: 'project', root }]); await brain.init({ scope: 'project', root });
      const session = await brain.openSession('Same episode', 'test'); await brain.closeSession(session.meta.id, 'Closed');
      const target = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Target', body: 'Candidate' });
      const feedback = vi.spyOn(brain, 'feedback');
      const engine: Engine = { cli: 'claude', available: async () => true, async *run(_request, agentId) {
        yield { type: 'agent.text', agentId, text: JSON.stringify({ ...empty, feedback: [{ id: target.meta.id, helpful: true }, { id: target.meta.id, helpful: true }] }), at: new Date().toISOString() };
      } };
      for (let i = 0; i < 3; i++) {
        const report = await reflect({ brain, brainRoot: root, engine });
        expect(report.feedback).toEqual([]);
        expect(report.advisoryFeedback).toEqual([target.meta.id]);
      }
      expect(feedback).not.toHaveBeenCalled();
      const after = await brain.read(target.meta.id);
      expect(after?.meta.usage).toEqual(target.meta.usage);
      expect(after?.meta.status).toBe('candidate');
      feedback.mockRestore();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

});
