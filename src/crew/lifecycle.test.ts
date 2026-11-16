import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openBrain } from '../brain/index.js';
import type { CliId, EduEvent, Engine } from '../core/contracts.js';
import { engineCapabilities } from '../engine/autonomy.js';
import { processAlive } from '../platform/process-tree.js';
import type { HerdrRunner } from './herdr.js';
import { createCrew, isWorkerOf } from './index.js';
import { CREW_JOB_STATUSES } from './status.js';
import { createCrewStore } from './store.js';

const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'edu-crew-life-'));
  roots.push(root);
  const location = { scope: 'project' as const, root };
  await openBrain([location]).init(location);
  // The person's global home (policy, approvals) is a temp folder too: never the real ~/.edu.
  vi.stubEnv('EDU_HOME', join(root, '.global-home'));
  return { root, location, store: createCrewStore(root) };
}

const at = () => new Date().toISOString();
/** A CLI that runs until it is cancelled, like a hung agent. */
function hangingEngine(cli: CliId, seen: { signal?: AbortSignal } = {}): Engine {
  return {
    cli, capabilities: engineCapabilities(cli), available: async () => true,
    async *run(request, agentId) {
      seen.signal = request.signal;
      yield { type: 'agent.text', agentId, text: 'working…', at: at() } satisfies EduEvent;
      await new Promise<void>(resolve => request.signal?.addEventListener('abort', () => resolve(), { once: true }));
      yield { type: 'error', agentId, message: 'Process cancelled', at: at() } satisfies EduEvent;
    },
  };
}
const DEAD_PID = 2147483646;

describe('crew job store', () => {
  it('serializes concurrent updates, so a parent pid write never erases the worker status', async () => {
    const f = await fixture();
    const job = await f.store.create({ cli: 'codex', task: 'Race', mode: 'headless', cwd: f.root, autonomy: 'ask' });
    // Two store instances stand for the dispatching parent and the detached worker.
    const parent = createCrewStore(f.root);
    await Promise.all([
      f.store.update(job.id, { status: 'running', pid: 4242, note: 'worker' }),
      parent.update(job.id, { pid: 4242 }),
      ...Array.from({ length: 8 }, (_, index) => parent.update(job.id, { verificationSummary: `round ${index}` })),
    ]);
    expect(await f.store.get(job.id)).toMatchObject({ status: 'running', pid: 4242, note: 'worker' });
  });

  it('keeps a terminal status: a late worker write cannot turn cancelled into failed', async () => {
    const f = await fixture();
    const job = await f.store.create({ cli: 'codex', task: 'Stop me', mode: 'headless', cwd: f.root, autonomy: 'ask' });
    await f.store.update(job.id, { status: 'cancelled', summary: 'Cancelled on request.' });
    const late = await f.store.update(job.id, { status: 'failed', summary: 'Process cancelled' });
    expect(late).toMatchObject({ status: 'cancelled', summary: 'Cancelled on request.' });
  });

  it('reclaims a lock left by a process that died mid-update', async () => {
    const f = await fixture();
    const job = await f.store.create({ cli: 'codex', task: 'Locked', mode: 'headless', cwd: f.root, autonomy: 'ask' });
    const lock = join(f.root, 'crew', `${job.id}.lock`);
    await mkdir(lock);
    await writeFile(join(lock, 'owner'), String(DEAD_PID));
    expect((await f.store.update(job.id, { note: 'after crash' })).note).toBe('after crash');
  });

  it('exports the one status list every reader uses', () => {
    expect(CREW_JOB_STATUSES).toEqual(['queued', 'running', 'awaiting-approval', 'done', 'failed', 'cancelled']);
  });
});

describe('crew dispatch policy', () => {
  it('refuses read-only work on CLIs that cannot enforce it, and accepts it where they can', async () => {
    const f = await fixture();
    const crew = createCrew({ brainRoot: f.root, store: f.store, startHeadless: async job => job });
    for (const cli of ['opencode', 'agy'] as const) {
      await expect(crew.dispatch({ cli, task: 'Read only', autonomy: 'readonly', cwd: f.root })).rejects.toThrow(`${cli} cannot enforce read-only work`);
    }
    expect((await crew.dispatch({ cli: 'pi', task: 'Read only', autonomy: 'readonly', cwd: f.root })).autonomy).toBe('readonly');
    expect((await f.store.list()).map(job => job.cli)).toEqual(['pi']);
  });

  it('records the timeout from the request, else config.json, else 60 minutes', async () => {
    const f = await fixture();
    const crew = createCrew({ brainRoot: f.root, store: f.store, startHeadless: async job => job });
    expect((await crew.dispatch({ cli: 'codex', task: 'Default', cwd: f.root })).timeoutMinutes).toBe(60);
    const { defaultConfig } = await import('../workspace/config.js');
    await writeFile(join(f.root, 'config.json'), JSON.stringify({ ...defaultConfig('codex'), crew: { timeoutMinutes: 15 } }));
    expect((await crew.dispatch({ cli: 'codex', task: 'Configured', cwd: f.root })).timeoutMinutes).toBe(15);
    expect((await crew.dispatch({ cli: 'codex', task: 'Explicit', cwd: f.root, timeoutMinutes: 5 })).timeoutMinutes).toBe(5);
    await expect(crew.dispatch({ cli: 'codex', task: 'Bad', cwd: f.root, timeoutMinutes: 0 })).rejects.toThrow('whole number of minutes');
  });
});

describe('crew worker', () => {
  it('stops the CLI when the job times out and reports the timeout', async () => {
    const f = await fixture();
    // 30 ms, so the test needs no fixed wait: the engine itself waits for the abort.
    const job = await f.store.create({ cli: 'codex', task: 'Hang', mode: 'headless', cwd: f.root, autonomy: 'ask', timeoutMinutes: 0.0005 });
    const seen: { signal?: AbortSignal } = {};
    const crew = createCrew({ brainRoot: f.root, locations: [f.location], store: f.store, engineFactory: cli => hangingEngine(cli, seen) });
    const result = await crew.runWorker(job.id);
    expect(seen.signal?.aborted).toBe(true);
    expect(result.status).toBe('failed');
    expect(result.summary).toMatch(/^Timed out after 0\.0005 minute\(s\)/);
  });

  it('requires enforced read-only for a read-only job', async () => {
    const f = await fixture();
    const job = await f.store.create({ cli: 'opencode', task: 'Inspect', mode: 'headless', cwd: f.root, autonomy: 'readonly' });
    const crew = createCrew({ brainRoot: f.root, locations: [f.location], store: f.store, engineFactory: cli => hangingEngine(cli) });
    const result = await crew.runWorker(job.id);
    expect(result).toMatchObject({ status: 'failed', summary: 'Enforced readonly is unsupported for opencode.' });
  });

  it('does not start the CLI for a job cancelled before its worker ran', async () => {
    const f = await fixture();
    const job = await f.store.create({ cli: 'codex', task: 'Never', mode: 'headless', cwd: f.root, autonomy: 'ask' });
    await f.store.update(job.id, { status: 'cancelled' });
    const crew = createCrew({ brainRoot: f.root, locations: [f.location], store: f.store, engineFactory: () => { throw new Error('engine must not start'); } });
    expect((await crew.runWorker(job.id)).status).toBe('cancelled');
  });
});

describe('crew liveness and cancel', () => {
  it('marks a running job whose worker died as failed, and leaves live workers alone', async () => {
    const f = await fixture();
    const dead = await f.store.create({ cli: 'codex', task: 'Crashed', mode: 'headless', cwd: f.root, autonomy: 'ask' });
    const live = await f.store.create({ cli: 'codex', task: 'Alive', mode: 'headless', cwd: f.root, autonomy: 'ask' });
    await f.store.update(dead.id, { status: 'running', pid: DEAD_PID });
    await f.store.update(live.id, { status: 'running', pid: process.pid });
    const crew = createCrew({ brainRoot: f.root, store: f.store });
    const jobs = await crew.status() as Awaited<ReturnType<typeof f.store.list>>;
    expect(jobs.find(job => job.id === dead.id)).toMatchObject({ status: 'failed', summary: `Worker process ${DEAD_PID} stopped without finishing the job.` });
    expect(jobs.find(job => job.id === live.id)?.status).toBe('running');
    expect((await crew.status(dead.id) as { status: string }).status).toBe('failed');
  });

  it('fails a job that stopped reporting well past its timeout', async () => {
    const f = await fixture();
    const job = await f.store.create({ cli: 'codex', task: 'Stuck', mode: 'headless', cwd: f.root, autonomy: 'ask', timeoutMinutes: 1 });
    await f.store.update(job.id, { status: 'running', pid: process.pid });
    const crew = createCrew({ brainRoot: f.root, store: f.store, clock: () => Date.parse(job.createdAt) + 7 * 60_000 });
    expect(await crew.status(job.id)).toMatchObject({ status: 'failed', summary: 'Worker exceeded its 1-minute timeout and stopped reporting.' });
  });

  it('cancels a headless job: marks it first, then stops the worker tree', async () => {
    const f = await fixture();
    const job = await f.store.create({ cli: 'codex', task: 'Cancel me', mode: 'headless', cwd: f.root, autonomy: 'ask' });
    await f.store.update(job.id, { status: 'running', pid: 777 });
    let alive = true;
    const signals: string[] = [];
    const crew = createCrew({
      brainRoot: f.root, store: f.store, sleep: async () => undefined,
      isAlive: () => alive, describeProcess: async () => `node edu crew worker ${job.id}`,
      stopProcess: async (pid, signal) => { signals.push(`${pid}:${signal}`); if (signal === 'SIGTERM') alive = false; },
    });
    const cancelled = await crew.cancel(job.id.slice(0, 8));
    expect(cancelled).toMatchObject({ status: 'cancelled', summary: 'Cancelled on request.' });
    expect(signals).toEqual(['777:SIGTERM']);
    expect((await crew.cancel(job.id)).status).toBe('cancelled');
    expect(signals).toHaveLength(1);
  });

  it('force-kills a worker that ignores the polite stop, and never signals a reused pid', async () => {
    const f = await fixture();
    const stubborn = await f.store.create({ cli: 'codex', task: 'Stubborn', mode: 'headless', cwd: f.root, autonomy: 'ask' });
    const reused = await f.store.create({ cli: 'codex', task: 'Reused', mode: 'headless', cwd: f.root, autonomy: 'ask' });
    await f.store.update(stubborn.id, { status: 'running', pid: 801 });
    await f.store.update(reused.id, { status: 'running', pid: 802 });
    const signals: string[] = [];
    let now = 0;
    const crew = createCrew({
      brainRoot: f.root, store: f.store, clock: () => now, sleep: async ms => { now += ms; }, cancelGraceMs: 100,
      isAlive: () => true, describeProcess: async pid => pid === 801 ? `node cli.js crew worker ${stubborn.id}` : '/usr/bin/vim notes.md',
      stopProcess: async (pid, signal) => { signals.push(`${pid}:${signal}`); },
    });
    expect((await crew.cancel(stubborn.id)).status).toBe('cancelled');
    expect(signals).toEqual(['801:SIGTERM', '801:SIGKILL']);
    const second = await crew.cancel(reused.id);
    expect(second.status).toBe('cancelled');
    expect(second.note).toContain('no longer this job\'s worker');
    expect(signals).toHaveLength(2);
  });

  it('recognises its worker by command line on POSIX and by Node image on Windows', () => {
    const id = '0f1e2d3c-4b5a-4968-8776-655443322110';
    expect(isWorkerOf(`/usr/bin/node /opt/edu/dist/cli.js crew worker ${id}`, id, 'linux')).toBe(true);
    expect(isWorkerOf('/usr/bin/node /opt/edu/dist/cli.js crew worker another-job', id, 'darwin')).toBe(false);
    expect(isWorkerOf(undefined, id, 'linux')).toBe(false);
    expect(isWorkerOf('node.exe', id, 'win32')).toBe(true);
    expect(isWorkerOf('notepad.exe', id, 'win32')).toBe(false);
  });

  it('cancels a pane job by closing its pane', async () => {
    const f = await fixture();
    const job = await f.store.create({ cli: 'claude', task: 'Pane', mode: 'pane', cwd: f.root, autonomy: 'ask' });
    await f.store.update(job.id, { status: 'running', paneId: 'pane-4', agentName: 'edu-x' });
    const calls: string[][] = [];
    const runner: HerdrRunner = async args => { calls.push(args); return { stdout: '{}', stderr: '' }; };
    const crew = createCrew({ brainRoot: f.root, store: f.store, herdr: { runner } });
    expect((await crew.cancel(job.id)).status).toBe('cancelled');
    expect(calls).toEqual([['pane', 'close', 'pane-4']]);
  });

  it('leaves a finished job as it is', async () => {
    const f = await fixture();
    const job = await f.store.create({ cli: 'codex', task: 'Done', mode: 'headless', cwd: f.root, autonomy: 'ask' });
    await f.store.update(job.id, { status: 'done', summary: 'All good.' });
    const crew = createCrew({ brainRoot: f.root, store: f.store });
    expect(await crew.cancel(job.id)).toMatchObject({ status: 'done', summary: 'All good.' });
  });

  it.runIf(process.platform !== 'win32')('really stops a detached worker process', async () => {
    const f = await fixture();
    const job = await f.store.create({ cli: 'codex', task: 'Real', mode: 'headless', cwd: f.root, autonomy: 'ask' });
    const worker = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)', 'crew', 'worker', job.id], { detached: true, stdio: 'ignore' });
    await new Promise(resolve => worker.once('spawn', resolve));
    await f.store.update(job.id, { status: 'running', pid: worker.pid });
    const crew = createCrew({ brainRoot: f.root, store: f.store });
    expect((await crew.cancel(job.id)).status).toBe('cancelled');
    await vi.waitFor(() => expect(processAlive(worker.pid)).toBe(false), { timeout: 3000 });
  });
});

describe('herdr pane races', () => {
  it('sends a pending prompt once even when two pollers see it at the same time', async () => {
    const f = await fixture();
    const job = await f.store.create({ cli: 'claude', task: 'Once', mode: 'pane', cwd: f.root, autonomy: 'ask' });
    const pending = await f.store.update(job.id, { status: 'running', paneId: 'pane-1', agentName: 'edu-once', pendingPrompt: 'Once' });
    const prompts: string[][] = [];
    const runner: HerdrRunner = async args => {
      if (args[1] === 'prompt') prompts.push(args);
      if (args[1] === 'get') return { stdout: JSON.stringify({ result: { agent: { agent_status: 'idle', state_change_seq: 1 } } }), stderr: '' };
      return { stdout: '{}', stderr: '' };
    };
    const { refreshPane } = await import('./herdr.js');
    await Promise.all([refreshPane(pending, { runner, store: f.store }), refreshPane(pending, { runner, store: createCrewStore(f.root) })]);
    expect(prompts).toEqual([['agent', 'prompt', 'edu-once', '--', 'Once']]);
    expect((await f.store.get(job.id))?.pendingPrompt).toBeUndefined();
  });

  it('retries a temporary herdr failure instead of failing the job, but not a vanished agent', async () => {
    const f = await fixture();
    const job = await f.store.create({ cli: 'claude', task: 'Flaky', mode: 'pane', cwd: f.root, autonomy: 'ask' });
    const running = await f.store.update(job.id, { status: 'running', paneId: 'pane-2', agentName: 'edu-flaky', promptSeq: 1 });
    let failures = 2;
    const runner: HerdrRunner = async args => {
      if (args[1] === 'get') {
        if (failures-- > 0) throw new Error('connect ECONNREFUSED herdr.sock');
        return { stdout: JSON.stringify({ result: { agent: { agent_status: 'working', state_change_seq: 2 } } }), stderr: '' };
      }
      return { stdout: '', stderr: '' };
    };
    const sleeps: number[] = [];
    const { refreshPane } = await import('./herdr.js');
    expect((await refreshPane(running, { runner, store: f.store, sleep: async ms => { sleeps.push(ms); } })).status).toBe('running');
    expect(sleeps).toHaveLength(2);
    let gets = 0;
    const gone: HerdrRunner = async args => {
      if (args[1] === 'get') { gets++; throw new Error('{"error":{"code":"agent_not_found"}}'); }
      return { stdout: '', stderr: '' };
    };
    expect((await refreshPane(running, { runner: gone, store: f.store, sleep: async () => undefined })).status).toBe('failed');
    expect(gets).toBe(1);
  });
});
