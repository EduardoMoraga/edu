import { afterEach, describe, expect, it, vi } from 'vitest';

// Pi provides @earendil-works/pi-tui at load time; the deck only needs these four.
vi.mock('@earendil-works/pi-tui', () => ({
  Key: { escape: 'escape' },
  matchesKey: () => false,
  truncateToWidth: (text: string) => text,
  visibleWidth: (text: string) => text.length,
}));

const cli = { missing: true, decks: 0 };
const SNAPSHOT = { version: 1, project: { name: 'edu', root: '/work' }, identity: 'Edu', brain: { present: true, canonical: 1, proposed: 0, episodic: 0, transitive: 0, lessons: 0 }, jobs: [], approvals: 0, recent: [], spec: null, updatedAt: 1 };
vi.mock('node:child_process', () => ({
  execFile: (_cmd: string, args: string[], _opts: unknown, done: (error: Error | null, stdout: string, stderr: string) => void) => {
    if (args[0] === 'deck') cli.decks += 1;
    setTimeout(() => (cli.missing ? done(new Error('spawn edu ENOENT'), '', '') : done(null, JSON.stringify(SNAPSHOT), '')), 0);
    return { pid: undefined, exitCode: 0, stdin: { end() {} }, once() {} };
  },
}));

afterEach(() => { vi.useRealTimers(); cli.missing = true; cli.decks = 0; });

type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;

async function loadPi() {
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
  const pi = {
    registerMcpServer: () => undefined,
    on: (name: string, handler: Handler) => { handlers.set(name, handler); },
    registerCommand: (name: string, spec: { handler: (args: string, ctx: unknown) => Promise<void> }) => { commands.set(name, spec); },
  };
  const extension = (await import('./edu.ts')).default as (api: unknown) => void;
  extension(pi);
  const ctx = {
    cwd: '/work',
    mode: 'tui',
    hasUI: true,
    sessionManager: { getSessionId: () => 'pi-session' },
    ui: { setHeader() {}, setFooter() {}, setWidget() {}, notify() {}, custom: async () => undefined },
  };
  return { handlers, commands, ctx };
}

describe('Pi Edu Deck polling', () => {
  it('backs off while edu deck fails, events wait too, and /edu-deck still reads at once', async () => {
    vi.useFakeTimers();
    const { handlers, commands, ctx } = await loadPi();
    await handlers.get('session_start')!({}, ctx);
    // Every 3 s while healthy; after failures 6 s, then 12 s (the next 3 s tick at or after the wait).
    await vi.advanceTimersByTimeAsync(4_000);
    expect(cli.decks).toBe(1);
    await handlers.get('turn_end')!({}, ctx);
    await handlers.get('agent_end')!({}, ctx);
    expect(cli.decks).toBe(1);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(cli.decks).toBe(2);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(cli.decks).toBe(2);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(cli.decks).toBe(3);
    cli.missing = false;
    await commands.get('edu-deck')!.handler('', ctx);
    await vi.advanceTimersByTimeAsync(0);
    expect(cli.decks).toBe(4);
    // A good read ends the backoff: every 3 s again.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(cli.decks).toBe(5);
    await handlers.get('session_shutdown')!({}, ctx);
  });
});
