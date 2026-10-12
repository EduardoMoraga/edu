import { describe, expect, it } from 'vitest';
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
