import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openBrain } from '../brain/index.js';
import type { CliId, EduEvent, Engine } from '../core/contracts.js';
import { createCrew } from './index.js';
import { dispatchPane, type HerdrRunner } from './herdr.js';
import { createCrewStore } from './store.js';

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'edu-crew-'));
  roots.push(root);
  const location = { scope: 'project' as const, root };
  const brain = openBrain([location]);
  await brain.init(location);
  return { root, location, store: createCrewStore(root) };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

function engine(cli: CliId, events: EduEvent[], onRequest?: (request: Parameters<Engine['run']>[0]) => void): Engine {
  return {
    cli,
    available: async () => true,
    async *run(request) { onRequest?.(request); yield* events; },
  };
}

describe('crew jobs', () => {
  it('runs a fake engine through the store, captures events, usage, and an episodic result', async () => {
    const f = await fixture();
    const job = await f.store.create({ cli: 'codex', task: 'Ship feature', mode: 'headless', cwd: f.root, autonomy: 'ask' });
    const e = engine('codex', [
      { type: 'agent.text', agentId: job.id, text: 'Implemented and tested.', at: '2026-10-09T00:00:00.000Z' },
      { type: 'usage', agentId: job.id, usage: { inputTokens: 12, outputTokens: 4 }, at: '2026-10-09T00:00:01.000Z' },
      { type: 'agent.end', agentId: job.id, ok: true, summary: 'Done.', at: '2026-10-09T00:00:02.000Z' },
    ]);
    const crew = createCrew({ brainRoot: f.root, locations: [f.location], store: f.store, engineFactory: () => e });
    const result = await crew.runWorker(job.id);
    expect(result.status).toBe('done');
    expect(result.summary).toBe('Done.');
    expect(result.usage.inputTokens).toBe(12);
    expect((await f.store.events(job.id)).map(event => event.type)).toEqual(['agent.text', 'usage', 'agent.end', 'brain.learn']);
    expect((await openBrain([f.location]).list({ kind: 'session' })).some(note => note.meta.status === 'closed')).toBe(true);
  });

  it('marks the job failed when worker setup fails before the engine starts', async () => {
    const f = await fixture();
    const job = await f.store.create({ cli: 'codex', task: 'Prepare context', mode: 'headless', cwd: f.root, autonomy: 'ask' });
    const crew = createCrew({ brainRoot: f.root, store: f.store, locations: [], engineFactory: () => { throw new Error('engine should not be created'); } });
    const result = await crew.runWorker(job.id);
    expect(result.status).toBe('failed');
    expect(result.summary).toContain('openBrain requires at least one location');
    expect(result.endedAt).toBeTruthy();
  });

  it('falls back to headless with an explicit note when Herdr is unavailable', async () => {
    const f = await fixture();
    const crew = createCrew({
      brainRoot: f.root, store: f.store, herdr: { env: {}, hasBinary: async () => true },
      startHeadless: async job => f.store.update(job.id, { status: 'running' }),
    });
    const job = await crew.dispatch({ cli: 'pi', task: 'Investigate', mode: 'pane', cwd: f.root });
    expect(job.mode).toBe('headless');
    expect(job.note).toContain('Herdr unavailable');
  });

  it('dispatches pane arguments in order, parses JSON, and reads completed output', async () => {
    const f = await fixture();
    const job = await f.store.create({ cli: 'claude', task: 'Check this', mode: 'pane', cwd: f.root, autonomy: 'readonly' });
    const calls: string[][] = [];
    const runner: HerdrRunner = async args => {
      calls.push(args);
      if (args[0] === 'pane') return { stdout: JSON.stringify({ result: { pane: { pane_id: 'pane-3' } } }), stderr: '' };
      if (args[1] === 'get') return { stdout: JSON.stringify({ result: { agent: { status: 'done' } } }), stderr: '' };
      if (args[1] === 'read') return { stdout: 'Review complete', stderr: '' };
      return { stdout: '{}', stderr: '' };
    };
    const options = { env: { HERDR_ENV: '1' }, hasBinary: async () => true, runner, store: f.store };
    const started = await dispatchPane(job, options);
    expect(started.status).toBe('running');
    expect(calls.slice(0, 3)).toEqual([
      ['pane', 'split', '--current', '--direction', 'right', '--cwd', f.root, '--no-focus'],
      ['agent', 'start', `edu-${job.id.slice(0, 8)}`, '--kind', 'claude', '--pane', 'pane-3'],
      ['agent', 'prompt', `edu-${job.id.slice(0, 8)}`, 'Autonomy policy: readonly. Do not modify files or take other write actions.\n\nMission: Check this'],
    ]);
    const completed = await (await import('./herdr.js')).refreshPane(started, options);
    expect(completed.status).toBe('done');
    expect(completed.summary).toBe('Review complete');
    expect(calls[3]).toEqual(['agent', 'get', started.agentName]);
    expect(calls[4]).toEqual(['agent', 'read', started.agentName, '--source', 'recent-unwrapped', '--lines', '200']);
    const endedAt = completed.endedAt;
    const callCount = calls.length;
    const repeated = await (await import('./herdr.js')).refreshPane(completed, options);
    expect(repeated).toEqual(completed);
    expect(repeated.endedAt).toBe(endedAt);
    expect(calls).toHaveLength(callCount);
  });

  it('chooses a different available vendor for read-only reviews and returns a queued timeout result', async () => {
    const f = await fixture();
    const job = await f.store.create({ cli: 'codex', task: 'Pending task', mode: 'headless', cwd: f.root, autonomy: 'ask' });
    let actualCli: CliId | undefined;
    let autonomy = '';
    const reviewer = engine('claude', [{ type: 'agent.text', agentId: 'r', text: 'No blockers.', at: new Date().toISOString() }], request => {
      actualCli = request.cli;
      autonomy = request.autonomy;
    });
    const crew = createCrew({ brainRoot: f.root, store: f.store, engineFactory: () => reviewer, detectClis: async () => ['codex', 'claude'], diff: async base => `diff ${base}` });
    const review = await crew.review({ callerCli: 'codex', base: 'main' });
    expect(review.cli).toBe('claude');
    expect(actualCli).toBe('claude');
    expect(autonomy).toBe('readonly');
    let clock = 1000;
    const waitingCrew = createCrew({ brainRoot: f.root, store: f.store, clock: () => clock, sleep: async ms => { clock += ms; } });
    expect((await waitingCrew.result(job.id, 0.5)).status).toBe('queued');
    expect(clock).toBe(1500);
    const failingCrew = createCrew({ brainRoot: f.root, store: f.store, engineFactory: () => engine('claude', [
      { type: 'agent.end', agentId: 'review', ok: false, summary: 'Provider failed.', at: new Date().toISOString() },
    ]), detectClis: async () => ['claude'], diff: async () => '' });
    await expect(failingCrew.review({ cli: 'claude', callerCli: 'codex', base: 'main' })).rejects.toThrow('reviewer ended unsuccessfully');
  });
});
