import { afterEach, describe, expect, it, vi } from 'vitest';

// The OpenCode TUI plugin runs inside OpenCode, which provides these modules at load time.
vi.mock('@opentui/solid', () => ({ useTerminalDimensions: () => () => ({ width: 120 }) }));
vi.mock('@opentui/solid/jsx-runtime', () => ({ jsx: () => null, jsxs: () => null, Fragment: () => null }));
vi.mock('@opentui/solid/jsx-dev-runtime', () => ({ jsxDEV: () => null, Fragment: () => null }));
vi.mock('solid-js', () => ({ createSignal: (v: unknown) => { let x = v; return [() => x, (n: unknown) => { x = n; }]; }, For: () => null, Show: () => null }));
const calls: Array<{ args: string[] }> = [];
vi.mock('node:child_process', () => ({
  execFile: (_cmd: string, args: string[], _opts: unknown, done: (error: Error | null, stdout: string) => void) => {
    calls.push({ args });
    setTimeout(() => done(null, args[0] === 'hook' ? 'EDU BRIEF\n' : '{}'), 0);
    return { stdin: { end() {} } };
  },
}));

afterEach(() => { vi.useRealTimers(); calls.length = 0; });

function fakeContext(entries: Array<{ key: string; value: string }>) {
  const put = vi.fn(async (input: { sessionID: string; key: string; value: string }) => { entries.push({ key: input.key, value: input.value }); });
  let route: { type: string; sessionID?: string } = { type: 'home' };
  const context = {
    location: { directory: '/work' },
    ui: { slot: () => undefined, router: { current: () => route }, dialog: { alert: async () => undefined } },
    keymap: { layer: () => undefined },
    data: { session: { root: (id: string) => id.replace(/-child$/, '') } },
    client: { session: { instructions: { entry: { put, list: async () => ({ data: [...entries] }) } } } },
  };
  return { context, put, go: (next: typeof route) => { route = next; } };
}

describe('OpenCode TUI brief', () => {
  it('attaches the brief once per root session as a session instruction entry', async () => {
    vi.useFakeTimers();
    const plugin = (await import('../../templates/opencode/edu-tui.tsx')).default as { setup: (ctx: unknown) => () => void };
    const entries: Array<{ key: string; value: string }> = [];
    const { context, put, go } = fakeContext(entries);
    const dispose = plugin.setup(context);
    await vi.advanceTimersByTimeAsync(1100);
    expect(put).not.toHaveBeenCalled();
    go({ type: 'session', sessionID: 'ses_1' });
    await vi.advanceTimersByTimeAsync(1100);
    expect(put).toHaveBeenCalledWith({ sessionID: 'ses_1', key: 'edu-brief', value: 'EDU BRIEF' });
    expect(calls.some(c => c.args[0] === 'hook' && c.args[1] === 'session-start')).toBe(true);
    go({ type: 'session', sessionID: 'ses_1-child' });
    await vi.advanceTimersByTimeAsync(3000);
    expect(put).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('leaves a resumed session that already carries the brief alone', async () => {
    vi.useFakeTimers();
    const plugin = (await import('../../templates/opencode/edu-tui.tsx')).default as { setup: (ctx: unknown) => () => void };
    const { context, put, go } = fakeContext([{ key: 'edu-brief', value: 'older brief' }]);
    const dispose = plugin.setup(context);
    go({ type: 'session', sessionID: 'ses_2' });
    await vi.advanceTimersByTimeAsync(2100);
    expect(put).not.toHaveBeenCalled();
    dispose();
  });
});
