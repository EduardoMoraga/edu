import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EduEvent, Engine, EngineRunRequest } from '../core/contracts.js';
import { openBrain } from '../brain/index.js';
import { reflect } from './reflect.js';
import { acceptProposal } from './proposals.js';

const response = { lessons: [{ title: 'Keep boundaries small', body: 'Small boundaries make testing easier.', evidence: [] }], hypotheses: [{ title: 'Parallelism helps', body: 'Independent steps may run faster.', evidence: [] }], feedback: [], skillProposals: [{ name: 'review-helper', rationale: 'Repeatable check.', content: '# Review helper\n\nCheck risks.' }], canonicalProposals: [] };
const fake: Engine = { cli: 'claude', available: async () => true, async *run(_request: EngineRunRequest, agentId: string): AsyncIterable<EduEvent> { yield { type: 'agent.text', agentId, text: JSON.stringify(response), at: new Date().toISOString() }; } };

describe('reflect', () => {
  it('writes evidence-linked notes and skill proposals without applying them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-reflect-'));
    const root = join(dir, '.edu');
    const brain = openBrain([{ scope: 'project', root }]);
    try {
      await brain.init({ scope: 'project', root });
      const episode = await brain.openSession('Recent run', 'edu:orchestrator');
      await brain.closeSession(episode.meta.id, 'A completed run.');
      const report = await reflect({ brain, engine: fake, since: '7d', now: new Date() });
      expect(report.lessons).toHaveLength(1);
      expect((await brain.list({ kind: 'lesson' })).length).toBe(1);
      const hypotheses = await brain.list({ kind: 'hypothesis' });
      expect(hypotheses).toHaveLength(1);
      expect(hypotheses[0]?.meta.band).toBe('hypothesis');
      const proposalFiles = await readFile(report.skillProposals[0]!.path, 'utf8');
      expect(proposalFiles).toContain('Check risks.');
      await expect(readFile(join(root, 'skills/review-helper/SKILL.md'), 'utf8')).rejects.toThrow();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('rejects malformed reflection JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-reflect-invalid-'));
    const root = join(dir, '.edu');
    const brain = openBrain([{ scope: 'project', root }]);
    const bad: Engine = { ...fake, async *run(_request, agentId) { yield { type: 'agent.text', agentId, text: '{bad', at: new Date().toISOString() }; } };
    try {
      await brain.init({ scope: 'project', root });
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
});
