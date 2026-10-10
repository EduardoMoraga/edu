import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openBrain } from '../brain/index.js';
import type { EduEvent, EngineRunRequest } from '../core/contracts.js';
import { FakeEngine } from '../engine/fake.js';
import { defaultConfig } from '../orchestrator/config.js';
import { respond, type ChatHistory } from './respond.js';

const at = '2026-10-08T12:00:00.000Z';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

async function setup(texts: string[]) {
  const cwd = await mkdtemp(join(tmpdir(), 'edu-chat-'));
  dirs.push(cwd);
  const root = join(cwd, '.edu');
  const brain = openBrain([{ scope: 'project', root }]);
  await brain.init({ scope: 'project', root });
  const events: EduEvent[] = [];
  const requests: EngineRunRequest[] = [];
  let next = 0;
  const engines = () => ({
    cli: 'claude' as const,
    available: async () => true,
    async *run(request: EngineRunRequest, agentId: string) {
      requests.push(request);
      yield* new FakeEngine([
        { type: 'agent.text', agentId, text: texts[next] ?? '', at },
        { type: 'usage', agentId, usage: { inputTokens: 3, outputTokens: 5 }, at },
        { type: 'agent.end', agentId, ok: true, summary: 'complete', sessionId: `session-${next++}`, at },
      ]).run(request, agentId);
    },
  });
  const history: ChatHistory = { turns: [] };
  const deps = { brain, cwd, config: defaultConfig('claude'), engines, history, onEvent: (event: EduEvent) => events.push(event) };
  return { brain, deps, events, requests, history };
}

describe('respond', () => {
  it('answers a greeting as chat in a read only Edu session', async () => {
    const { deps, events, requests } = await setup(['Hola, ¿cómo estás?']);
    await expect(respond({ ...deps, message: 'Hola' })).resolves.toEqual({ kind: 'chat', text: 'Hola, ¿cómo estás?' });
    expect(requests[0]).toMatchObject({ cli: 'claude', autonomy: 'readonly' });
    expect(requests[0]?.systemPrompt).toContain('You are **Edu**');
    expect(requests[0]?.systemPrompt).toContain('TASK: <the goal, restated precisely>');
    expect(events.map(event => event.type)).toEqual(['brain.recall', 'agent.spawn', 'agent.status', 'agent.text', 'usage', 'agent.end']);
    expect(events.find(event => event.type === 'agent.spawn')).toMatchObject({ agentId: 'edu', role: 'lead' });
  });

  it('records consulted notes and passes short history with a resumed engine session', async () => {
    const { brain, deps, events, requests, history } = await setup(['Verified: The note says to check sources. [[D-check-sources]]', 'Inferred: Yes.']);
    const note = await brain.proposeCanonical({ tier: 'canonical', kind: 'standard', title: 'Check sources before answering', body: 'Use direct evidence.', band: 'verified' });
    await brain.acceptCanonical(note.meta.id);
    await respond({ ...deps, message: 'What did we decide about checking sources?' });
    expect(events.find(event => event.type === 'brain.recall')).toMatchObject({ noteIds: [note.meta.id] });
    expect((await brain.read(note.meta.id))?.meta.usage?.uses).toBe(1);
    await respond({ ...deps, message: 'Why?' });
    expect(requests[1]?.resumeSessionId).toBe('session-0');
    expect(requests[1]?.prompt).toContain('What did we decide about checking sources?');
    expect(requests[1]?.prompt).toContain('Why?');
    expect(history.turns).toHaveLength(4);
  });

  it('classifies only an exact TASK line as a task', async () => {
    const { deps } = await setup(['TASK: Create a file named note.txt containing hello']);
    await expect(respond({ ...deps, message: 'create a file…' })).resolves.toEqual({ kind: 'task', goal: 'Create a file named note.txt containing hello' });
  });
});
