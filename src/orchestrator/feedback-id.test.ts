import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { openBrain } from '../brain/brain.js';
import type { Engine } from '../core/contracts.js';
import { printCommand } from '../test-support/shell.js';
import { defaultConfig } from './config.js';
import { orchestrate } from './run.js';

it('persists bounded verified feedback for long note ids independently per note', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'edu-feedback-id-'));
  try {
    const root = join(cwd, '.edu');
    const location = { root, scope: 'project' as const };
    const brain = openBrain([location]);
    await brain.init(location);
    const long = await brain.write({ title: 'a'.repeat(203), tier: 'transitive', kind: 'lesson', body: 'Fixture application guidance.' });
    const other = await brain.write({ title: 'Independent note', tier: 'transitive', kind: 'lesson', body: 'Another fixture guidance.' });
    const idle = await brain.write({ title: 'Not applied', tier: 'transitive', kind: 'lesson', body: 'Exposure is not success.' });
    expect(long.meta.id.length).toBeGreaterThan(200);
    const notes = [long, other, idle];
    const contextText = notes.map(note => `[[${note.meta.id}]] ${note.body}`).join('\n');
    const feedback = vi.spyOn(brain, 'feedback'); // Calls the real implementation and persistent ledger.
    await mkdir(join(root, 'playbooks'), { recursive: true });
    await writeFile(join(root, 'playbooks', 'local.md'), '---\nname: local\ndescription: Feedback ID regression\nharness: H3\nrequireSpecApproval: true\nmaxFixRounds: 0\n---\nVerify the external check.\n');
    const plan = {
      requirements: [{ id: 'R-1', text: 'Node prints checked' }],
      checks: [{ id: 'node-check', requirementIds: ['R-1'], command: printCommand('checked'), expect: { exitCode: 0, stdoutIncludes: 'checked' }, timeoutMs: 10000 }],
      steps: [{ id: 'build', role: 'builder', task: 'Apply the fixture guidance', dependsOn: [], parallelSafe: false }],
    };
    const engine: Engine = { cli: 'claude', available: async () => true, async *run(request, agentId) {
      const text = request.prompt.includes('Create a safe') ? JSON.stringify(plan)
        : request.prompt.includes('Review the completed') ? '{"verdict":"pass","issues":[]}'
        : [long, other].map(note => `EDU_APPLIED ${JSON.stringify({ noteId: note.meta.id, requirementIds: ['R-1'], application: `Applied [[${note.meta.id}]] to satisfy the checked requirement.` })}`).join('\n');
      yield { type: 'agent.text', agentId, text, at: new Date().toISOString() };
      yield { type: 'agent.end', agentId, ok: true, summary: 'done', at: new Date().toISOString() };
    } };
    const result = await orchestrate('Check bounded feedback', {
      brain, config: { ...defaultConfig('claude'), playbook: 'local', approvals: 'auto' },
      context: { build: async () => ({ text: contextText, tokens: 100, budgetTokens: 8000, sections: [{ title: 'Lessons', text: contextText, tokens: 100, noteIds: notes.map(note => note.meta.id) }], deferred: [] }) },
      engines: () => engine, available: ['claude'], cwd, runsDir: join(root, 'runs'),
      autoApprove: true, onEvent: () => {}, approve: async () => true,
    });
    expect(result.ok, result.summary).toBe(true);
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'verify.result', kind: 'deterministic', checkId: 'node-check', ok: true }));
    expect(feedback).toHaveBeenCalledTimes(2);
    const eventId = `${result.runId}:autonomous_verified_success`;
    for (const note of [long, other]) {
      const persisted = await openBrain([location]).read(note.meta.id);
      expect(persisted!.meta.usage?.verifiedWins).toBe(1);
      expect(feedback).toHaveBeenCalledWith(note.meta.id, true, expect.objectContaining({ eventId, verified: true }));
      expect(persisted!.meta.usage?.events).toContain(`v:${eventId}`);
      expect(eventId.length).toBeLessThanOrEqual(200);
      await brain.feedback(note.meta.id, true, { eventId, verified: true });
      expect((await openBrain([location]).read(note.meta.id))!.meta.usage?.verifiedWins).toBe(1);
    }
    expect((await brain.read(idle.meta.id))!.meta.usage?.verifiedWins ?? 0).toBe(0);
    const task = JSON.parse(await readFile(join(result.episodeDir!, 'task.json'), 'utf8'));
    expect(task.limitations.some((message: string) => message.startsWith('Feedback for '))).toBe(false);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
