import { afterEach, describe, expect, it, vi } from 'vitest';

// The OpenCode TUI plugin runs inside OpenCode, which provides these modules at load time.
vi.mock('@opentui/solid', () => ({ useTerminalDimensions: () => () => ({ width: 120 }) }));
vi.mock('@opentui/solid/jsx-runtime', () => ({ jsx: () => null, jsxs: () => null, Fragment: () => null }));
vi.mock('@opentui/solid/jsx-dev-runtime', () => ({ jsxDEV: () => null, Fragment: () => null }));
vi.mock('solid-js', () => ({ createSignal: (v: unknown) => { let x = v; return [() => x, (n: unknown) => { x = n; }]; }, For: () => null, Show: () => null }));

const cli = { missing: true, decks: 0 };
const SNAPSHOT = { version: 1, project: { name: 'edu', root: '/work' }, identity: 'Edu', brain: { present: true, canonical: 1, proposed: 0, episodic: 0, transitive: 0, lessons: 0 }, jobs: [{ id: 'dead0001', cli: 'codex', task: 'Stopped', status: 'cancelled', mode: 'headless', startedAt: 1, endedAt: 2, tokens: 0 }], approvals: 0, recent: [], spec: null, updatedAt: 1 };
vi.mock('node:child_process', () => ({
  execFile: (_cmd: string, args: string[], _opts: unknown, done: (error: Error | null, stdout: string) => void) => {
    if (args[0] === 'deck') cli.decks += 1;
    setTimeout(() => (cli.missing ? done(new Error('spawn edu ENOENT'), '') : done(null, JSON.stringify(SNAPSHOT))), 0);
    return { stdin: { end() {} } };
  },
}));

afterEach(() => { vi.useRealTimers(); cli.missing = true; cli.decks = 0; });

function fakeContext() {
  const slots: Array<{ append: string; render: () => unknown }> = [];
  let layer: (() => { commands: Array<{ run: () => void }> }) | undefined;
  const alerts: string[] = [];
  const context = {
    location: { directory: '/work' },
    ui: { slot: (spec: { append: string; render: () => unknown }) => { slots.push(spec); }, router: { current: () => ({ type: 'home' }) }, dialog: { alert: async (a: { message: string }) => { alerts.push(a.message); } } },
    keymap: { layer: (make: typeof layer) => { layer = make; } },
  };
  /** Runs /edu-deck the way OpenCode does: through the command the app slot registers. */
  const openDeck = () => {
    slots.find(slot => slot.append === 'app')?.render();
    layer?.().commands[0]?.run();
  };
  return { context, openDeck, alerts };
}

describe('OpenCode Edu Deck polling', () => {
  it('backs off while edu deck fails, and /edu-deck still reads at once', async () => {
    vi.useFakeTimers();
    const plugin = (await import('./edu-tui.tsx')).default as { setup: (ctx: unknown) => () => void };
    const { context, openDeck, alerts } = fakeContext();
    const dispose = plugin.setup(context);
    // Every 3 s while healthy; after failures 6 s, then 12 s (the next 3 s tick at or after the wait).
    await vi.advanceTimersByTimeAsync(4_000);
    expect(cli.decks).toBe(1);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(cli.decks).toBe(2);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(cli.decks).toBe(2);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(cli.decks).toBe(3);
    cli.missing = false;
    openDeck();
    await vi.advanceTimersByTimeAsync(0);
    expect(cli.decks).toBe(4);
    expect(alerts.at(-1)).toMatch(/⊘ codex/);
    // A good read ends the backoff: every 3 s again.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(cli.decks).toBe(5);
    dispose();
  });
});
