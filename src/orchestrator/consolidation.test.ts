import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openBrain } from '../brain/brain.js';
import type { Engine, EngineRunRequest } from '../core/contracts.js';
import { defaultConfig } from './config.js';
import { orchestrate } from './run.js';

it('normal run end consolidates observed structured corrections without another engine invocation', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'edu-run-consolidate-'));
  try {
    const root = join(cwd, '.edu');
    const location = { root, scope: 'project' as const };
    const brain = openBrain([location]); await brain.init(location);
    await mkdir(join(root, 'playbooks'), { recursive: true });
    await writeFile(join(root, 'playbooks', 'local.md'), '---\nname: local\ndescription: Local consolidation fixture\nharness: H3\nrequireSpecApproval: false\nmaxFixRounds: 0\n---\nPlan observable outcomes.\n');
    const requests: EngineRunRequest[] = [];
    const engine: Engine = {
      cli: 'claude', available: async () => true,
      async *run(request, agentId) {
        requests.push(request);
        const text = request.prompt.includes('Create a safe, concise execution plan')
          ? JSON.stringify({ requirements: [], checks: [], steps: [] })
          : JSON.stringify({ verdict: 'pass', issues: [] });
        yield { type: 'agent.text', agentId, text, at: new Date().toISOString() };
        yield { type: 'agent.end', agentId, ok: true, summary: 'Fixture completed.', at: new Date().toISOString() };
      },
    };
    const result = await orchestrate('Exercise local consolidation', {
      brain, config: { ...defaultConfig('claude'), playbook: 'local' },
      context: { build: async () => ({ text: '', tokens: 0, budgetTokens: 800, sections: [], deferred: [] }) },
      engines: () => engine, available: ['claude'], cwd, runsDir: join(root, 'runs'),
      onEvent: () => {}, approve: async () => true,
      composerMessages: (async function* () { yield 'You forgot the migration check.'; })(),
    });
    expect(result.ok, result.summary).toBe(true);
    expect(requests).toHaveLength(2); // planner and reviewer only; consolidation is local.
    const reopened = openBrain([location]);
    const lessons = await reopened.list({ kind: 'lesson' });
    expect(lessons).toHaveLength(1);
    expect(lessons[0]!.body).toContain('You forgot the migration check.');
    expect(lessons[0]!.meta).toMatchObject({ status: 'candidate', source: 'edu:reflect' });
    expect(lessons[0]!.meta.usage?.verifiedWins).toBeUndefined();
    expect(await readdir(join(root, 'reflect-queue'))).toEqual([]);
    expect(JSON.parse(await readFile(join(root, 'state', 'consolidation.json'), 'utf8'))).toMatchObject({ lessons: 1, acknowledged: 1, busy: false });
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
