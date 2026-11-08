import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openBrain } from '../brain/index.js';
import { captureContext, out, runCli, type Captured } from './testkit.js';

async function initialized(): Promise<Captured> {
  const c = await captureContext({ detected: ['claude'] });
  await runCli(c, ['init']);
  c.stdout.length = 0;
  return c;
}
const feed = (c: Captured, input: unknown) => { c.ctx.readStdin = async () => JSON.stringify(input); c.stdout.length = 0; };
const sessions = (c: Captured) => openBrain([{ scope: 'project', root: join(c.dirs.cwd, '.edu') }]).list({ kind: 'session' });

describe('host session-start hooks', () => {
  it('attributes a Codex SessionStart to Codex when the hook names its host', async () => {
    const c = await initialized();
    feed(c, { session_id: 'codex-thread-1', source: 'startup', cwd: c.dirs.cwd, hook_event_name: 'SessionStart' });
    await runCli(c, ['hook', 'session-start', '--host', 'codex']);
    const [session] = await sessions(c);
    expect(session?.meta.source).toBe('codex');
    expect(session?.meta.title).toMatch(/^Codex session/);
    expect(out(c)).toContain(`Edu session id: ${session!.meta.id}`);
  });

  it('injects the brief into agy as a system message, using the payload workspace', async () => {
    const c = await initialized();
    // agy runs hooks in the plugin directory; the workspace arrives in workspacePaths.
    c.ctx.cwd = c.dirs.home;
    feed(c, { conversationId: 'conv-1234-5678', workspacePaths: [c.dirs.cwd], modelName: 'auto' });
    await runCli(c, ['hook', 'agy-session-start', '--cwd', c.dirs.home]);
    const payload = JSON.parse(out(c)) as { injectSteps: Array<{ systemMessage: { systemMessage: string } }> };
    const text = payload.injectSteps[0]!.systemMessage.systemMessage;
    const [session] = await sessions(c);
    expect(session?.meta.source).toBe('agy');
    expect(text).toContain(`Edu session id: ${session!.meta.id}`);
    // Retries reuse the same episode.
    feed(c, { conversationId: 'conv-1234-5678', workspacePaths: [c.dirs.cwd] });
    await runCli(c, ['hook', 'agy-session-start', '--cwd', c.dirs.home]);
    expect(await sessions(c)).toHaveLength(1);
  });

  it('prints an empty JSON object for agy when there is no brain or the input is garbage', async () => {
    const c = await captureContext();
    feed(c, { workspacePaths: [c.dirs.cwd] });
    await runCli(c, ['hook', 'agy-session-start']);
    expect(out(c)).toBe('{}');
    c.ctx.readStdin = async () => 'not json';
    c.stdout.length = 0;
    await runCli(c, ['hook', 'agy-session-start']);
    expect(out(c)).toBe('{}');
    expect(c.exitCode).toBe(0);
  });
});
