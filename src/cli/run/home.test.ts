import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openBrain } from '../../brain/index.js';
import { respond, type ChatHistory } from '../../chat/respond.js';
import type { EduEvent } from '../../core/contracts.js';
import { FakeEngine } from '../../engine/fake.js';
import { defaultConfig } from '../../orchestrator/config.js';
import { createHomeSession } from './home.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe('home routing', () => {
  it('keeps greetings and questions in chat, and orchestrates a restated task', async () => {
    const runTask = vi.fn(async () => {});
    const respond = vi.fn(async ({ message }: { message: string }) => message === 'create a file…'
      ? { kind: 'task' as const, goal: 'Create note.txt with hello' }
      : { kind: 'chat' as const, text: 'Hola' });
    const text: string[] = [];
    const home = createHomeSession({ respond, runTask, say: value => text.push(value), lang: 'en' });
    await home.submit('Hola');
    await home.submit('What did we decide?');
    expect(runTask).not.toHaveBeenCalled();
    await home.submit('create a file…');
    expect(runTask).toHaveBeenCalledExactlyOnceWith('Create note.txt with hello');
    expect(text.at(-1)).toBe('Edu will run this as a task: Create note.txt with hello');
  });

  it('/run forces a task and /ask forces chat', async () => {
    const runTask = vi.fn(async () => {});
    const respond = vi.fn(async () => ({ kind: 'task' as const, goal: 'Unexpected task' }));
    const home = createHomeSession({ respond, runTask, say: () => {}, lang: 'en' });
    await home.submit('/run Build the project');
    expect(runTask).toHaveBeenCalledWith('Build the project');
    expect(respond).not.toHaveBeenCalled();
    await home.submit('/ask Could you build a project?');
    expect(respond).toHaveBeenCalledWith({ message: 'Could you build a project?', forceChat: true });
    expect(runTask).toHaveBeenCalledTimes(1);
  });

  it('emits chat.user for every submitted message before routing it', async () => {
    const order: string[] = [];
    const emitted: EduEvent[] = [];
    const home = createHomeSession({
      lang: 'en', say: () => {}, runTask: async () => { order.push('task'); },
      respond: async ({ message }) => { order.push(`respond:${message}`); return { kind: 'chat' as const, text: 'ok' }; },
      emit: event => { emitted.push(event); order.push(event.type); },
    });
    await home.submit('  Hola  ');
    await home.submit('   ');
    await home.submit('/run Build it');
    expect(emitted.map(event => event.type === 'chat.user' && event.text)).toEqual(['Hola', '/run Build it']);
    expect(order).toEqual(['chat.user', 'respond:Hola', 'chat.user', 'task']);
  });

  it('uses FakeEngine chat classification before starting orchestration', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'edu-home-'));
    dirs.push(cwd);
    const root = join(cwd, '.edu');
    const brain = openBrain([{ scope: 'project', root }]);
    await brain.init({ scope: 'project', root });
    const answers = ['Hola', 'Verified: Edu uses a brain.', 'TASK: Create note.txt with hello'];
    let index = 0;
    const runTask = vi.fn(async () => {});
    const events: EduEvent[] = [];
    const history: ChatHistory = { turns: [] };
    const home = createHomeSession({
      lang: 'en', say: () => {}, runTask,
      respond: ({ message, forceChat }) => respond({ message, forceChat, history, brain,
        config: defaultConfig('claude'), cwd, onEvent: event => events.push(event),
        engines: () => new FakeEngine([
          { type: 'agent.text', agentId: 'edu', text: answers[index++]!, at: '2026-10-08T12:00:00Z' },
          { type: 'agent.end', agentId: 'edu', ok: true, summary: 'done', at: '2026-10-08T12:00:00Z' },
        ]),
      }),
    });
    await home.submit('Hola');
    await home.submit('What is Edu?');
    expect(runTask).not.toHaveBeenCalled();
    expect(events.filter(event => event.type === 'brain.recall')).toHaveLength(2);
    await home.submit('create a file…');
    expect(runTask).toHaveBeenCalledExactlyOnceWith('Create note.txt with hello');
  });
});
