import { describe, expect, it } from 'vitest';
import { openBrain } from '../brain/index.js';
import { ctxPercentFromClaude, parseJsonObject } from './statusline.js';
import { captureContext, err, out, runCli, type Captured } from './testkit.js';
import { join } from 'node:path';

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
