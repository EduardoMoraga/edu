import { mkdtemp, rm, mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openBrain } from '../brain/index.js';
import type { CliId, EduEvent, Engine } from '../core/contracts.js';
import { createCrew } from './index.js';
import { dispatchPane, type HerdrRunner } from './herdr.js';
import { createCrewStore } from './store.js';

const roots: string[] = [];
const execFile = promisify(execFileCallback);
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'edu-crew-'));
  roots.push(root);
  const location = { scope: 'project' as const, root };
  const brain = openBrain([location]);
  await brain.init(location);
  return { root, location, store: createCrewStore(root) };
}
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

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
    expect((await f.store.events(job.id)).filter(event => event.type === 'usage').map(event => event.usage.receipt)).toEqual(['pending', undefined, 'complete']);
    expect((await f.store.events(job.id)).map(event => event.type)).toEqual(['usage', 'agent.text', 'usage', 'agent.end', 'usage', 'brain.learn']);
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

  it('does not leave a worker running when output artifact storage fails', async () => {
    const f = await fixture();
    const job = await f.store.create({ cli: 'codex', task: 'Check output', mode: 'headless', cwd: f.root, autonomy: 'ask' });
    await rm(join(f.root, 'crew', 'artifacts'), { recursive: true, force: true });
    await writeFile(join(f.root, 'crew', 'artifacts'), 'blocked');
    const e = engine('codex', [{ type: 'agent.text', agentId: job.id, text: 'password=hiddenvalue\n', at: new Date().toISOString() }]);
    const crew = createCrew({ brainRoot: f.root, locations: [f.location], store: f.store, engineFactory: () => e });
    const result = await crew.runWorker(job.id);
    expect(result.status).toBe('failed');
    expect(result.endedAt).toBeTruthy();
    expect(JSON.stringify(await f.store.get(job.id))).not.toContain('hiddenvalue');
  });

  it('derives a preview only from filtered output when secrets cross 900 characters', async () => {
    const f = await fixture();
    const envSecret = 'Q'.repeat(40);
    vi.stubEnv('EDU_TEST_SECRET', envSecret);
    for (const [raw, forbidden] of [
      [`${'x'.repeat(890)} sk-${'A'.repeat(24)}`, 'sk-AAAA'],
      [`${'x'.repeat(890)} ${envSecret}`, 'QQQQ'],
    ]) {
      const job = await f.store.create({ cli: 'codex', task: 'Inspect', mode: 'headless', cwd: f.root, autonomy: 'ask' });
      const e = engine('codex', [
        { type: 'agent.text', agentId: job.id, text: raw.slice(0, 895), at: new Date().toISOString() },
        { type: 'agent.text', agentId: job.id, text: raw.slice(895), at: new Date().toISOString() },
      ]);
      const crew = createCrew({ brainRoot: f.root, locations: [f.location], store: f.store, engineFactory: () => e });
      const result = await crew.runWorker(job.id);
      expect(result.status).toBe('done');
      const summaryArtifact = (await f.store.artifact(job.id, 'summary')).text;
      const outputArtifact = (await f.store.artifact(job.id, 'output')).text;
      expect([result.summary, summaryArtifact, outputArtifact].join('\n')).not.toContain(forbidden);
      const episodes = await openBrain([f.location]).list({ kind: 'session' });
      for (const note of episodes) expect(note.body).not.toContain(forbidden);
    }
  });

  it('falls back to headless with an explicit note when no herdr server is reachable', async () => {
    const f = await fixture();
    const noServer: HerdrRunner = async () => { throw new Error('connect ENOENT herdr.sock'); };
    const crew = createCrew({
      brainRoot: f.root, store: f.store, herdr: { env: {}, hasBinary: async () => true, runner: noServer },
      startHeadless: async job => f.store.update(job.id, { status: 'running' }),
    });
    const job = await crew.dispatch({ cli: 'pi', task: 'Investigate', mode: 'pane', cwd: f.root });
    expect(job.mode).toBe('headless');
    expect(job.note).toContain('Herdr unavailable (no herdr server is reachable from here)');
  });

  it('falls back to headless when herdr is not installed', async () => {
    const f = await fixture();
    const crew = createCrew({
      brainRoot: f.root, store: f.store, herdr: { env: { HERDR_ENV: '1' }, hasBinary: async () => false, runner: async () => { throw new Error('must not run'); } },
      startHeadless: async job => f.store.update(job.id, { status: 'running' }),
    });
    const job = await crew.dispatch({ cli: 'pi', task: 'Investigate', mode: 'pane', cwd: f.root });
    expect(job.mode).toBe('headless');
    expect(job.note).toContain('herdr is not on PATH');
  });

  it('rejects dispatch directories outside the workspace, including symlink escapes', async () => {
    const f = await fixture();
    const workspace = join(f.root, 'workspace');
    const outside = join(f.root, 'outside');
    await mkdir(workspace);
    await mkdir(outside);
    await symlink(outside, join(workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    const crew = createCrew({ brainRoot: f.root, workspaceRoot: workspace, store: f.store,
      startHeadless: async job => job });
    await expect(crew.dispatch({ cli: 'pi', task: 'Escape', cwd: outside })).rejects.toThrow('outside the workspace');
    await expect(crew.dispatch({ cli: 'pi', task: 'Escape', cwd: join(workspace, 'escape') })).rejects.toThrow('outside the workspace');
    expect(await f.store.list()).toHaveLength(0);
  });

  it('uses a .edu brain root as the workspace boundary for CLI dispatch', async () => {
    const f = await fixture();
    const workspace = join(f.root, 'workspace');
    await mkdir(join(workspace, '.edu'), { recursive: true });
    const crew = createCrew({ brainRoot: join(workspace, '.edu'), store: f.store,
      startHeadless: async job => job });
    await expect(crew.dispatch({ cli: 'pi', task: 'Allowed', cwd: workspace })).resolves.toMatchObject({ cwd: await realpath(workspace) });
    await expect(crew.dispatch({ cli: 'pi', task: 'Denied', cwd: f.root })).rejects.toThrow('outside the workspace');
  });

  it('closes a pane created when agent startup fails', async () => {
    const f = await fixture();
    const job = await f.store.create({ cli: 'pi', task: 'Run', mode: 'pane', cwd: f.root, autonomy: 'ask' });
    const calls: string[][] = [];
    const runner: HerdrRunner = async args => {
      calls.push(args);
      if (args[0] === 'pane' && args[1] === 'split') return { stdout: JSON.stringify({ result: { pane: { pane_id: 'pane-orphan' } } }), stderr: '' };
      if (args[0] === 'agent' && args[1] === 'start') throw new Error('startup failed');
      return { stdout: '{}', stderr: '' };
    };
    const result = await dispatchPane(job, { env: { HERDR_ENV: '1' }, hasBinary: async () => true, runner, store: f.store });
    expect(result.status).toBe('failed');
    expect(calls).toContainEqual(['pane', 'close', 'pane-orphan']);
  });

  it('records pane output as live crew events while leaving the successful pane open', async () => {
    const f = await fixture();
    const job = await f.store.create({ cli: 'pi', task: 'Say READY', mode: 'pane', cwd: f.root, autonomy: 'ask' });
    const calls: string[][] = [];
    let agentStatus = 'working';
    const runner: HerdrRunner = async args => {
      calls.push(args);
      if (args[0] === 'agent' && args[1] === 'get') return { stdout: JSON.stringify({ result: { agent: { agent_status: agentStatus } } }), stderr: '' };
      if (args[0] === 'agent' && args[1] === 'read') return { stdout: 'READY', stderr: '' };
      if (args[0] === 'pane' && args[1] === 'read') return { stdout: 'Working...\nREADY', stderr: '' };
      return { stdout: '{}', stderr: '' };
    };
    const running = await f.store.update(job.id, { status: 'running', paneId: 'pane-live', agentName: 'edu-live', promptedAt: new Date().toISOString() });
    const options = { runner, store: f.store };
    const { refreshPane } = await import('./herdr.js');
    await refreshPane(running, options);
    expect((await f.store.events(job.id)).some(e => e.type === 'agent.text' && e.text.includes('artifact'))).toBe(true);
    agentStatus = 'done';
    await refreshPane(await f.store.get(job.id) ?? running, options);
    expect((await f.store.artifact(job.id, 'output')).text).toContain('Working');
    expect(calls).not.toContainEqual(['pane', 'close', 'pane-live']);
  });

  it('does not choose Antigravity as its own reviewer when its environment identifies the caller', async () => {
    const f = await fixture();
    const crew = createCrew({ brainRoot: f.root, store: f.store, callerEnv: { ANTIGRAVITY: '1' },
      detectClis: async () => ['agy', 'codex'], diff: async () => '',
      engineFactory: cli => engine(cli, [{ type: 'agent.text', agentId: 'r', text: 'Review.', at: new Date().toISOString() }]) });
    expect((await crew.review()).cli).toBe('codex');
  });

  it('keeps a pane job alive while the agent waits for a human answer, then delivers the task', async () => {
    const f = await fixture();
    const job = await f.store.create({ cli: 'codex', task: 'Write tests', mode: 'pane', cwd: f.root, autonomy: 'ask' });
    const calls: string[][] = [];
    let agentStatus = 'blocked';
    const runner: HerdrRunner = async args => {
      calls.push(args);
      if (args[0] === 'pane' && args[1] === 'split') return { stdout: JSON.stringify({ result: { pane: { pane_id: 'pane-9' } } }), stderr: '' };
      if (args[0] === 'pane' && args[1] === 'read') return { stdout: 'Trust this folder?\n1. Trust and continue', stderr: '' };
      if (args[1] === 'start') throw new Error('{"error":{"code":"agent_not_ready"}}');
      if (args[1] === 'get') return { stdout: JSON.stringify({ result: { agent: { agent_status: agentStatus } } }), stderr: '' };
      return { stdout: '{}', stderr: '' };
    };
    const options = { env: { HERDR_ENV: '1' }, hasBinary: async () => true, runner, store: f.store };
    const waiting = await dispatchPane(job, options);
    expect(waiting.status).toBe('running');
    expect(waiting.note).toContain('waiting for your answer in herdr pane pane-9');
    expect(waiting.note).toContain('Trust this folder?');
    expect(calls.find(c => c[1] === 'start')).toContain('--no-daemon');
    const herdr = await import('./herdr.js');
    const stillWaiting = await herdr.refreshPane(waiting, options);
    expect(stillWaiting.pendingPrompt).toBeDefined();
    expect(calls.some(c => c[1] === 'prompt')).toBe(false);
    agentStatus = 'idle';
    const delivered = await herdr.refreshPane(stillWaiting, options);
    expect(delivered.status).toBe('running');
    expect(delivered.pendingPrompt).toBeUndefined();
    expect(calls.filter(c => c[1] === 'prompt')).toHaveLength(1);
  });

  it('does not finish a pane job on the idle state seen before the agent starts working', async () => {
    const f = await fixture();
    const job = await f.store.create({ cli: 'pi', task: 'Say READY', mode: 'pane', cwd: f.root, autonomy: 'ask' });
    let agentStatus = 'idle';
    const runner: HerdrRunner = async args => {
      if (args[0] === 'pane') return { stdout: JSON.stringify({ result: { pane: { pane_id: 'pane-5' } } }), stderr: '' };
      if (args[1] === 'get') return { stdout: JSON.stringify({ result: { agent: { agent_status: agentStatus } } }), stderr: '' };
      if (args[1] === 'read') return { stdout: 'READY', stderr: '' };
      return { stdout: '{}', stderr: '' };
    };
    const options = { env: { HERDR_ENV: '1' }, hasBinary: async () => true, runner, store: f.store };
    const herdr = await import('./herdr.js');
    let current = await dispatchPane(job, options);
    current = await herdr.refreshPane(current, options);
    expect(current.status).toBe('running');
    agentStatus = 'working';
    current = await herdr.refreshPane(current, options);
    expect(current.observedWorking).toBe(true);
    agentStatus = 'idle';
    current = await herdr.refreshPane(current, options);
    expect(current.status).toBe('done');
    expect(current.summary).toBe('READY');
  });

  it('finishes a fast pane job whose turn completed between polls, using the state change sequence', async () => {
    const f = await fixture();
    const job = await f.store.create({ cli: 'pi', task: 'Say READY', mode: 'pane', cwd: f.root, autonomy: 'ask' });
    let seq = 10;
    const runner: HerdrRunner = async args => {
      if (args[0] === 'pane') return { stdout: JSON.stringify({ result: { pane: { pane_id: 'pane-6' } } }), stderr: '' };
      if (args[1] === 'get') return { stdout: JSON.stringify({ result: { agent: { agent_status: 'idle', state_change_seq: seq } } }), stderr: '' };
      if (args[1] === 'read') return { stdout: 'READY', stderr: '' };
      return { stdout: '{}', stderr: '' };
    };
    const options = { env: { HERDR_ENV: '1' }, hasBinary: async () => true, runner, store: f.store };
    const herdr = await import('./herdr.js');
    let current = await dispatchPane(job, options);
    expect(current.promptSeq).toBe(10);
    current = await herdr.refreshPane(current, options);
    expect(current.status).toBe('running');
    seq = 12; // idle → working → idle happened between polls
    current = await herdr.refreshPane(current, options);
    expect(current.status).toBe('done');
  });

  it('finishes a fast pane job from the pane text when herdr never reports the turn', async () => {
    const f = await fixture();
    const job = await f.store.create({ cli: 'pi', task: 'Say READY', mode: 'pane', cwd: f.root, autonomy: 'ask' });
    let pane = 'Mission: Say READY';
    let clock = Date.parse('2026-10-09T12:00:00Z');
    const runner: HerdrRunner = async args => {
      if (args[0] === 'pane' && args[1] === 'split') return { stdout: JSON.stringify({ result: { pane: { pane_id: 'pane-7' } } }), stderr: '' };
      if (args[0] === 'pane' && args[1] === 'read') return { stdout: pane, stderr: '' };
      if (args[1] === 'get') return { stdout: JSON.stringify({ result: { agent: { agent_status: 'idle', state_change_seq: 5 } } }), stderr: '' };
      if (args[1] === 'read') return { stdout: pane, stderr: '' };
      return { stdout: '{}', stderr: '' };
    };
    const options = { env: { HERDR_ENV: '1' }, hasBinary: async () => true, runner, store: f.store, now: () => new Date(clock) };
    const herdr = await import('./herdr.js');
    let current = await dispatchPane(job, options);
    pane = 'Mission: Say READY\nREADY';
    clock += 2000;
    current = await herdr.refreshPane(current, options);
    expect(current.status).toBe('running'); // inside the grace period
    clock += 4000;
    current = await herdr.refreshPane(current, options);
    expect(current.status).toBe('done');
  });

  it('dispatches pane arguments in order, parses JSON, and reads completed output', async () => {
    const f = await fixture();
    const job = await f.store.create({ cli: 'claude', task: 'Check this', mode: 'pane', cwd: f.root, autonomy: 'readonly' });
    const calls: string[][] = [];
    const runner: HerdrRunner = async args => {
      calls.push(args);
      if (args[0] === 'pane') return { stdout: JSON.stringify({ result: { pane: { pane_id: 'pane-3' } } }), stderr: '' };
      if (args[1] === 'get') return { stdout: JSON.stringify({ result: { agent: { agent_status: 'done' } } }), stderr: '' };
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
    expect(calls.filter(c => c[0] === 'agent' && c[1] === 'get').length).toBeGreaterThanOrEqual(2); // baseline + poll
    expect(calls).toContainEqual(['agent', 'read', started.agentName, '--source', 'recent-unwrapped', '--lines', '200']);
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

  it('explains when review has no git repository or an unknown base', async () => {
    const f = await fixture();
    const crew = createCrew({ brainRoot: f.root, workspaceRoot: f.root, detectClis: async () => ['codex'] });
    await expect(crew.review({ cli: 'codex' })).rejects.toThrow('cross-vendor review needs a git repository to diff');
    const gitRoot = join(f.root, 'repository');
    await mkdir(gitRoot);
    await execFile('git', ['init', '-q', gitRoot]);
    const inRepo = createCrew({ brainRoot: f.root, workspaceRoot: gitRoot, detectClis: async () => ['codex'] });
    await expect(inRepo.review({ cli: 'codex', base: 'ref-that-does-not-exist-0029' })).rejects.toThrow('Unknown git base ref');
  });
});

describe('herdr target from inside and outside herdr', () => {
  const list = (workspaces: Array<Record<string, unknown>>) => JSON.stringify({ result: { type: 'workspace_list', workspaces } });

  it('decides inside, outside (with or without an Edu workspace) or none', async () => {
    const { herdrTarget } = await import('./herdr.js');
    const fail: HerdrRunner = async () => { throw new Error('no server'); };
    const calls: string[][] = [];
    const insideRunner: HerdrRunner = async args => { calls.push(args); return { stdout: '{}', stderr: '' }; };
    expect(await herdrTarget({ env: { HERDR_ENV: '1' }, hasBinary: async () => true, runner: insideRunner })).toEqual({ kind: 'inside' });
    expect(calls).toEqual([]); // inside herdr nothing is probed: behavior unchanged
    expect(await herdrTarget({ env: {}, hasBinary: async () => false, runner: fail })).toEqual({ kind: 'none', reason: 'herdr is not on PATH' });
    expect(await herdrTarget({ env: {}, hasBinary: async () => true, runner: fail })).toEqual({ kind: 'none', reason: 'no herdr server is reachable from here' });
    expect(await herdrTarget({ env: {}, hasBinary: async () => true, runner: async () => ({ stdout: 'not json', stderr: '' }) })).toMatchObject({ kind: 'none' });
    const withEdu: HerdrRunner = async () => ({ stdout: list([{ workspace_id: 'wC', label: 'HRO2' }, { workspace_id: 'wR', label: 'Edu' }]), stderr: '' });
    expect(await herdrTarget({ env: {}, hasBinary: async () => true, runner: withEdu })).toEqual({ kind: 'outside', workspaceId: 'wR' });
    const withoutEdu: HerdrRunner = async () => ({ stdout: list([{ workspace_id: 'wC', label: 'HRO2' }]), stderr: '' });
    expect(await herdrTarget({ env: {}, hasBinary: async () => true, runner: withoutEdu })).toEqual({ kind: 'outside', workspaceId: undefined });
  });

  it('opens a tab in the Edu workspace from outside herdr and starts the agent there', async () => {
    const f = await fixture();
    const calls: string[][] = [];
    const runner: HerdrRunner = async args => {
      calls.push(args);
      if (args[0] === 'workspace' && args[1] === 'list') return { stdout: list([{ workspace_id: 'wR', label: 'Edu' }]), stderr: '' };
      if (args[0] === 'tab' && args[1] === 'create') return { stdout: JSON.stringify({ result: { tab: { tab_id: 'wR:t9' }, root_pane: { pane_id: 'wR:p40' } } }), stderr: '' };
      if (args[0] === 'agent' && args[1] === 'get') return { stdout: JSON.stringify({ result: { agent: { agent_status: 'idle', state_change_seq: 1 } } }), stderr: '' };
      return { stdout: '{}', stderr: '' };
    };
    const crew = createCrew({ brainRoot: f.root, store: f.store, herdr: { env: {}, hasBinary: async () => true, runner } });
    const job = await crew.dispatch({ cli: 'claude', task: 'Summarize the week', mode: 'pane', cwd: f.root });
    expect(job).toMatchObject({ mode: 'pane', status: 'running', paneId: 'wR:p40' });
    expect(job.note).toContain('herdr workspace "Edu"');
    const agentName = `edu-${job.id.slice(0, 8)}`;
    expect(calls).toContainEqual(['tab', 'create', '--workspace', 'wR', '--cwd', job.cwd, '--label', agentName, '--no-focus']);
    expect(calls).toContainEqual(['agent', 'start', agentName, '--kind', 'claude', '--pane', 'wR:p40']);
    expect(calls.some(args => args[0] === 'pane' && args[1] === 'split')).toBe(false);
  });

  it('creates the Edu workspace when it does not exist yet, and closes the pane if the agent cannot start', async () => {
    const f = await fixture();
    const calls: string[][] = [];
    const runner: HerdrRunner = async args => {
      calls.push(args);
      if (args[0] === 'workspace' && args[1] === 'list') return { stdout: list([]), stderr: '' };
      if (args[0] === 'workspace' && args[1] === 'create') return { stdout: JSON.stringify({ result: { workspace: { workspace_id: 'w9' }, root_pane: { pane_id: 'w9:p1' } } }), stderr: '' };
      if (args[0] === 'agent' && args[1] === 'start') throw new Error('unknown agent kind');
      return { stdout: '{}', stderr: '' };
    };
    const crew = createCrew({ brainRoot: f.root, store: f.store, herdr: { env: {}, hasBinary: async () => true, runner } });
    const job = await crew.dispatch({ cli: 'pi', task: 'Run', mode: 'pane', cwd: f.root });
    expect(calls).toContainEqual(['workspace', 'create', '--cwd', job.cwd, '--label', 'Edu', '--no-focus']);
    expect(calls).toContainEqual(['pane', 'close', 'w9:p1']);
    expect(job.status).toBe('failed');
  });
});
