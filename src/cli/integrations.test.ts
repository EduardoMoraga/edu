import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createEduMcpServer } from '../mcp/server.js';
import { withHostLock } from './hooks.js';
import { openBrain } from '../brain/index.js';
import { ctxPercentFromClaude, parseJsonObject } from './statusline.js';
import { captureContext, err, out, runCli, type Captured } from './testkit.js';
import { join } from 'node:path';
import { readFile, stat } from 'node:fs/promises';

async function initialized(stdin?: string): Promise<Captured> {
  const c = await captureContext({ stdin, detected: ['claude'] });
  await runCli(c, ['init']);
  c.stdout.length = 0;
  return c;
}

const episodes = async (c: Captured) =>
  openBrain([{ scope: 'project', root: join(c.dirs.cwd, '.edu') }]).list({ tier: 'episodic' });

describe('statusline', () => {
  it('derives ctx% from Claude statusline JSON', () => {
    expect(ctxPercentFromClaude({ context_window: { used_percentage: 41 } })).toBe(41);
    expect(
      ctxPercentFromClaude({
        context_window: {
          context_window_size: 200000,
          current_usage: { input_tokens: 50000, cache_read_input_tokens: 30000, cache_creation_input_tokens: 2000 },
        },
      }),
    ).toBe(41);
    expect(ctxPercentFromClaude({ context_window: { context_window_size: 1000, total_input_tokens: 250 } })).toBe(25);
    expect(ctxPercentFromClaude({ model: { id: 'x' } })).toBeUndefined();
    expect(ctxPercentFromClaude(parseJsonObject('not json'))).toBeUndefined();
  });

  it('prints one line with brain stats and ctx% from stdin', async () => {
    const c = await initialized(JSON.stringify({ context_window: { used_percentage: 41.4 } }));
    await runCli(c, ['statusline']);
    expect(c.stdout).toHaveLength(1);
    expect(c.stdout[0]).toBe('◆ EDU · brain 0 · 0 lessons · ctx 41%');
  });

  it('uses the workspace dir Claude reports and omits ctx without JSON', async () => {
    const c = await initialized();
    await runCli(c, ['brain', 'remember', 'Prefer small PRs']);
    c.stdout.length = 0;
    const other = await captureContext({ stdin: JSON.stringify({ workspace: { current_dir: c.dirs.cwd } }) });
    await runCli(other, ['statusline']);
    expect(out(other)).toBe('◆ EDU · brain 1 · 1 lesson');
  });
});

describe('edu brief', () => {
  it('prints the same brief as the session-start hook, without opening a session', async () => {
    const c = await initialized();
    await runCli(c, ['brain', 'remember', 'Prefer small PRs', '--kind', 'lesson']);
    c.stdout.length = 0;
    await runCli(c, ['hook', 'session-start']);
    const hook = out(c);
    c.stdout.length = 0;
    await runCli(c, ['brief']);
    expect(c.exitCode ?? 0).toBe(0);
    expect(out(c)).toBe(hook);
    expect(await episodes(c)).toEqual([]);
  });

  it('adds the notes relevant to a query and supports --json and --cwd', async () => {
    const c = await initialized();
    await runCli(c, ['brain', 'remember', 'Prefer small PRs', '--kind', 'lesson']);
    const other = await captureContext();
    await runCli(other, ['brief', '--cwd', c.dirs.cwd, '--json', 'small', 'PRs']);
    const parsed = JSON.parse(out(other));
    expect(parsed.text).toContain('the contract');
    expect(parsed.hits.map((h: { id: string }) => h.id)).toContain('L-prefer-small-prs');
    const plain = await captureContext();
    await runCli(plain, ['--cwd', c.dirs.cwd, 'brief', 'small PRs']);
    expect(out(plain)).toMatch(/## Relevant to "small PRs"\n- \[\[L-prefer-small-prs\]\]/);
  });

  it('explains how to create a brain when there is none', async () => {
    const c = await captureContext();
    await runCli(c, ['brief']);
    expect(c.exitCode).toBe(1);
    expect(err(c)).toContain('edu init');
  });
});

describe('hooks', () => {
  it('session-start prints the brief when a brain exists', async () => {
    const c = await initialized('{"session_id":"abc","source":"startup"}');
    await runCli(c, ['hook', 'session-start']);
    expect(c.exitCode ?? 0).toBe(0);
    expect(out(c)).toContain('the contract');
  });

  it('session-start stays silent without a brain', async () => {
    const c = await captureContext();
    await runCli(c, ['hook', 'session-start']);
    expect(out(c)).toBe('');
    expect(c.exitCode ?? 0).toBe(0);
  });

  it('session-end never fails the host on bad stdin', async () => {
    const c = await initialized('{not json');
    await runCli(c, ['hook', 'session-end']);
    expect(c.exitCode ?? 0).toBe(0);
    expect(err(c)).toContain('edu hook session-end');
    expect(err(c)).toContain('ignored');
    expect(await episodes(c)).toHaveLength(0);
  });

  it('session-end records a closed episode with the transcript path', async () => {
    const input = { session_id: '1234567890abcdef', transcript_path: '/tmp/t.jsonl', reason: 'exit', hook_event_name: 'SessionEnd' };
    const c = await initialized(JSON.stringify(input));
    await runCli(c, ['hook', 'session-end']);
    expect(c.exitCode ?? 0).toBe(0);
    const [episode] = await episodes(c);
    expect(episode?.meta.status).toBe('closed');
    expect(episode?.meta.title).toBe('Claude Code session 12345678');
    expect(episode?.body).toContain('/tmp/t.jsonl');
  });

  it('session-end closes the episode a Pi session-start opened, and leaves an agent-closed one untouched', async () => {
    const pi = { cwd: '', session_id: 'pi-session-0001', source: 'pi' };
    const c = await initialized(JSON.stringify(pi));
    await runCli(c, ['hook', 'session-start']);
    const [open] = await episodes(c);
    expect(open?.meta.status).toBe('open-session');
    expect(open?.meta.title).toBe('Pi session pi-sessi');
    const end = async (reason: string) => {
      const e = await captureContext({ stdin: JSON.stringify({ ...pi, reason }), detected: ['claude'] });
      await runCli(e, ['--cwd', c.dirs.cwd, 'hook', 'session-end']);
      expect(e.exitCode ?? 0).toBe(0);
    };
    await end('shutdown');
    const [closed, ...rest] = await episodes(c);
    expect(rest).toHaveLength(0);
    expect(closed?.meta.id).toBe(open?.meta.id);
    expect(closed?.meta.status).toBe('closed');
    expect(closed?.body).toContain('Pi session pi-session-0001 ended (shutdown).');
    await end('again');
    expect((await episodes(c))[0]?.body).toBe(closed?.body);
  });

  it('session-end and codex-notify auto-maintain the brain (stamp + index), throttled', async () => {
    const input = { session_id: 'abcdef1234567890', hook_event_name: 'SessionEnd' };
    const c = await initialized(JSON.stringify(input));
    const edu = join(c.dirs.cwd, '.edu');
    await runCli(c, ['hook', 'session-end']);
    expect(c.exitCode ?? 0).toBe(0);
    const first = JSON.parse(await readFile(join(edu, 'state', 'maintain.json'), 'utf8'));
    expect(first).toMatchObject({ promoted: 0, retired: 0, overdue: 0 });
    expect(typeof first.lastRun).toBe('number');
    expect(await readFile(join(edu, 'brain', '0-index', 'INDEX.md'), 'utf8')).toContain('Claude Code session abcdef12');
    await runCli(c, ['hook', 'codex-notify', JSON.stringify({ type: 'agent-turn-complete', 'thread-id': 'th-1' })]);
    expect(JSON.parse(await readFile(join(edu, 'state', 'maintain.json'), 'utf8')).lastRun).toBe(first.lastRun);
  });

  it('codex-notify auto-maintains on a fresh brain', async () => {
    const c = await initialized();
    await runCli(c, ['hook', 'codex-notify', JSON.stringify({ type: 'agent-turn-complete', 'thread-id': 'th-2' })]);
    await expect(stat(join(c.dirs.cwd, '.edu', 'state', 'maintain.json'))).resolves.toBeTruthy();
  });

  it('edu brain maintain forces maintenance and writes the stamp', async () => {
    const c = await initialized();
    await runCli(c, ['hook', 'codex-notify', JSON.stringify({ type: 'agent-turn-complete', 'thread-id': 'th-3' })]);
    const path = join(c.dirs.cwd, '.edu', 'state', 'maintain.json');
    const before = JSON.parse(await readFile(path, 'utf8')).lastRun as number;
    await new Promise(resolve => setTimeout(resolve, 5));
    await runCli(c, ['brain', 'maintain', '--json']);
    expect(JSON.parse(await readFile(path, 'utf8')).lastRun).toBeGreaterThan(before);
  });

  it('codex-notify records a completed turn and tolerates garbage', async () => {
    const c = await initialized();
    const payload = { type: 'agent-turn-complete', 'thread-id': 'th-42', 'input-messages': ['fix the bug'], 'last-assistant-message': 'Fixed.' };
    await runCli(c, ['hook', 'codex-notify', JSON.stringify(payload)]);
    const [episode] = await episodes(c);
    expect(episode?.body).toContain('fix the bug');
    expect(episode?.body).toContain('Fixed.');

    await runCli(c, ['hook', 'codex-notify', '{oops']);
    expect(c.exitCode ?? 0).toBe(0);
    expect(err(c)).toContain('edu hook codex-notify');
    expect(await episodes(c)).toHaveLength(1);
  });
});

describe('hook idempotency and session ownership', () => {
  const feed = (c: Captured, input: unknown) => { c.ctx.readStdin = async () => JSON.stringify(input); c.stdout.length = 0; };
  const sessions = async (c: Captured) =>
    openBrain([{ scope: 'project', root: join(c.dirs.cwd, '.edu') }]).list({ kind: 'session' });

  it('session-start opens once for a host session id + source and prints the id; start/end/retries share one episode', async () => {
    const c = await initialized();
    feed(c, { session_id: 'host-session-1', source: 'startup' });
    await runCli(c, ['hook', 'session-start']);
    const [opened] = await sessions(c);
    expect(opened?.meta.status).toBe('open-session');
    expect(out(c)).toContain(`Edu session id: ${opened!.meta.id}`);
    await runCli(c, ['hook', 'session-start']);
    expect(await sessions(c)).toHaveLength(1);

    const end = { session_id: 'host-session-1', reason: 'exit', transcript_path: '/tmp/t.jsonl' };
    feed(c, end);
    await runCli(c, ['hook', 'session-end']);
    await runCli(c, ['hook', 'session-end']);
    feed(c, { ...end, reason: 'logout' });
    await runCli(c, ['hook', 'session-end']);
    const all = await sessions(c);
    expect(all).toHaveLength(1);
    expect(all[0]!.meta.id).toBe(opened!.meta.id);
    expect(all[0]!.meta.status).toBe('closed');
    expect(all[0]!.body).toContain('(exit)');
    expect(all[0]!.body).toContain('content was not read');
  });

  it('session-start attributes source pi to Pi (closable by exact MCP source) while Claude triggers stay Claude', async () => {
    const c = await initialized();
    const brain = openBrain([{ scope: 'project', root: join(c.dirs.cwd, '.edu') }]);
    feed(c, { session_id: 'pi-session-1', source: 'pi' });
    await runCli(c, ['hook', 'session-start']);
    feed(c, { session_id: 'claude-session-1', source: 'startup' });
    await runCli(c, ['hook', 'session-start']);
    const all = await sessions(c);
    const pi = all.find(n => n.meta.source === 'pi')!;
    expect(pi.meta.title).toBe('Pi session pi-sessi');
    const claude = all.find(n => n.meta.source === 'claude')!;
    expect(claude.meta.title).toBe('Claude Code session claude-s');
    expect(all).toHaveLength(2);

    const server = createEduMcpServer({ locations: [{ scope: 'project', root: join(c.dirs.cwd, '.edu') }] });
    const client = new Client({ name: 'edu-test', version: '1.0.0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b); await client.connect(a);
    try {
      const wrong = await client.callTool({ name: 'edu_session_close', arguments: { id: pi.meta.id, source: 'claude', summary: 'x' } });
      expect(wrong.isError).toBe(true);
      const ok = await client.callTool({ name: 'edu_session_close', arguments: { id: pi.meta.id, source: 'pi', summary: 'Pi done' } });
      expect(ok.isError).not.toBe(true);
    } finally { await client.close(); await server.close(); }
    expect((await brain.read(pi.meta.id))?.meta.status).toBe('closed');
    expect((await brain.read(claude.meta.id))?.meta.status).toBe('open-session');
  });

  it('session-start without a host id and source stays read-only', async () => {
    const c = await initialized();
    feed(c, { session_id: 'only-id' });
    await runCli(c, ['hook', 'session-start']);
    c.ctx.readStdin = async () => '';
    await runCli(c, ['hook', 'session-start']);
    expect(await sessions(c)).toHaveLength(0);
    expect(out(c)).not.toMatch(/^Edu session id: /m);
  });

  it('session-end leaves explicit sessions of other agents and other host ids alone', async () => {
    const c = await initialized();
    const brain = openBrain([{ scope: 'project', root: join(c.dirs.cwd, '.edu') }]);
    const explicit = await brain.openSession('Claude Code session host-a', 'claude');
    feed(c, { session_id: 'host-a-other-id' });
    await runCli(c, ['hook', 'session-end']);
    expect((await brain.read(explicit.meta.id))?.meta.status).toBe('open-session');
    expect(await sessions(c)).toHaveLength(2);
  });

  it('codex-notify dedupes retries per turn but records distinct turns', async () => {
    const c = await initialized();
    const turn = (id: string, answer: string) => JSON.stringify({ type: 'agent-turn-complete', 'thread-id': 'th-7', 'turn-id': id, 'input-messages': ['q'], 'last-assistant-message': answer });
    await runCli(c, ['hook', 'codex-notify', turn('t1', 'one')]);
    await runCli(c, ['hook', 'codex-notify', turn('t1', 'one')]);
    expect(await sessions(c)).toHaveLength(1);
    await runCli(c, ['hook', 'codex-notify', turn('t2', 'two')]);
    expect(await sessions(c)).toHaveLength(2);
    const noId = JSON.stringify({ type: 'agent-turn-complete', 'thread-id': 'th-8', 'input-messages': ['q'], 'last-assistant-message': 'same' });
    await runCli(c, ['hook', 'codex-notify', noId]);
    await runCli(c, ['hook', 'codex-notify', noId]);
    expect(await sessions(c)).toHaveLength(3);
    const body = (await sessions(c)).map(n => n.body).join('\n');
    expect(body).toContain('clipped question/answer only');
  });

  it('concurrent identical hook calls neither duplicate nor change a closed session', async () => {
    const c = await initialized();
    const end = JSON.stringify({ session_id: 'race-1', reason: 'exit' });
    const turn = JSON.stringify({ type: 'agent-turn-complete', 'thread-id': 'th-r', 'turn-id': 'tr1', 'last-assistant-message': 'a' });
    c.ctx.readStdin = async () => end;
    await Promise.all([1, 2, 3, 4, 5, 6].flatMap(() => [runCli(c, ['hook', 'session-end']), runCli(c, ['hook', 'codex-notify', turn])]));
    const all = await sessions(c);
    expect(all).toHaveLength(2);
    expect(all.every(n => n.meta.status === 'closed')).toBe(true);
    expect(err(c)).toBe('');
    await expect(readdir(join(c.dirs.cwd, '.edu', 'state', 'locks'))).resolves.toEqual([]);
  });

  it('waits for a live lock owner and reclaims a stale lock of a dead owner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-lock-'));
    try {
      let inside = 0; let overlap = false;
      const run = () => withHostLock(root, 'claude', 'same', async () => { inside++; overlap ||= inside > 1; await new Promise(r => setTimeout(r, 30)); inside--; });
      await Promise.all([run(), run(), run()]);
      expect(overlap).toBe(false);

      const name = (await readdir(join(root, 'state', 'locks')))[0];
      expect(name).toBeUndefined();
      // A dead owner's old lock is reclaimed.
      const key = createHash('sha256').update('claude\0dead').digest('hex').slice(0, 32);
      const dir = join(root, 'state', 'locks', `${key}.lock`);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'owner'), '2147483646');
      const old = new Date(Date.now() - 120_000);
      await utimes(dir, old, old);
      await expect(withHostLock(root, 'claude', 'dead', async () => 'ok')).resolves.toBe('ok');
      // A live owner's lock is not removed even when old: the waiter times out and the lock survives.
      const liveKey = createHash('sha256').update('claude\0live').digest('hex').slice(0, 32);
      const live = join(root, 'state', 'locks', `${liveKey}.lock`);
      await mkdir(live, { recursive: true });
      await writeFile(join(live, 'owner'), String(process.pid));
      await utimes(live, old, old);
      await expect(withHostLock(root, 'claude', 'live', async () => 'no', 150)).rejects.toThrow(/timed out/);
      await expect(stat(live)).resolves.toBeTruthy();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
