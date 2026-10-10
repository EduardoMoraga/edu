import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EduEvent } from '../core/contracts.js';
import { ASCII_GLYPHS, UNICODE_GLYPHS, createTheme } from '../identity/index.js';
import { App, type AppProps } from './App.js';
import { demoEvents } from './demo.js';
import { fixtureAt, oauthRun } from './fixtures.js';

const ANSI = /\u001B\[/;
const plain = createTheme(0);

const mount = (props: Partial<AppProps> = {}) =>
  render(<App events={oauthRun()} theme={plain} glyphs={UNICODE_GLYPHS} columns={100} rows={30} {...props} />);

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

let instance: ReturnType<typeof render> | undefined;
afterEach(() => {
  instance?.unmount();
  instance = undefined;
});

describe('App: wide layout', () => {
  it('renders identity, goal, mode · cli and run totals in the header', () => {
    instance = mount();
    const frame = instance.lastFrame()!;
    const header = frame.split('\n')[1]!;
    expect(header).toContain('◆ EDU');
    expect(header).toContain('"add oauth"');
    expect(header).toContain('solo · claude');
    expect(header).toContain('$0.42 · 38.1k tok');
  });
  it('shows the computed evidence outcome in the ended run header', () => {
    instance = mount({ events: [
      { type: 'run.start', runId: 'r', goal: 'verify', mode: 'solo', at: fixtureAt(0) },
      { type: 'outcome', label: 'autonomous_verified_success', metrics: {}, at: fixtureAt(1) },
      { type: 'run.end', runId: 'r', ok: true, summary: 'done', at: fixtureAt(2) },
    ] });
    expect(instance.lastFrame()).toContain('autonomous_verified_success');
  });
  it('renders the agent tree with role icons and status glyphs', () => {
    instance = mount();
    const frame = instance.lastFrame()!;
    expect(frame).toContain('AGENTS');
    expect(frame).toMatch(/◆ +lead\s+✓\s+41s/);
    expect(frame).toMatch(/├ 🔍 explorer\s+✓\s+1m02s\s+10\.1k/);
    expect(frame).toMatch(/▸ ├ ⚙ +builder\s+⏸\s+2m14s\s+28k/);
    expect(frame).toMatch(/└ ⚖ +reviewer\s+○\s+queued/);
  });
  it('focuses the active agent with collapsed tools and its text', () => {
    instance = mount();
    const frame = instance.lastFrame()!;
    expect(frame).toContain('⚙ builder · awaiting approval');
    expect(frame).toContain('› Edit src/auth.ts');
    expect(frame).toContain('✓ 12 lines');
    expect(frame).toContain('∴ The callback needs state validation first.');
    expect(frame).toContain('I added the callback route');
  });
  it('shows the approval card and the brain strip', () => {
    instance = mount({ context: { usedTokens: 3_280, budgetTokens: 8_000 } });
    const frame = instance.lastFrame()!;
    expect(frame).toContain('⏸ APPROVAL');
    expect(frame).toContain('builder wants to write 3 files');
    expect(frame).toContain('[y] approve  [n] reject  [d] details');
    expect(frame).toContain('🧠 recalled 4 · learned 1 lesson · ctx 41% of 8k');
  });
  it('keeps every line within the terminal width', () => {
    instance = mount();
    for (const line of instance.lastFrame()!.split('\n')) expect([...line].length).toBeLessThanOrEqual(100);
  });
});

describe('App: keyboard', () => {
  it('approves with y and hides the card', async () => {
    const onApprove = vi.fn();
    instance = mount({ onApprove });
    await tick();
    instance.stdin.write('d');
    await tick();
    expect(instance.lastFrame()).toContain('src/routes/callback.ts');
    instance.stdin.write('y');
    await tick();
    expect(onApprove).toHaveBeenCalledWith('ap-1', true);
    expect(instance.lastFrame()).not.toContain('APPROVAL');
  });
  it('rejects with n', async () => {
    const onApprove = vi.fn();
    instance = mount({ onApprove });
    await tick();
    instance.stdin.write('n');
    await tick();
    expect(onApprove).toHaveBeenCalledWith('ap-1', false);
  });
  it('moves the selection with arrows', async () => {
    instance = mount();
    await tick();
    instance.stdin.write('\u001B[A'); // up: builder → explorer
    await tick();
    expect(instance.lastFrame()).toContain('🔍 explorer · done');
    expect(instance.lastFrame()).toContain('› Grep passport');
  });
  it('toggles help with ?', async () => {
    instance = mount();
    await tick();
    instance.stdin.write('?');
    await tick();
    expect(instance.lastFrame()).toContain('KEYS');
    expect(instance.lastFrame()).toContain('cycle panes');
    instance.stdin.write('x');
    await tick();
    expect(instance.lastFrame()).not.toContain('KEYS');
  });
  it('sends a composer message to the lead', async () => {
    const onSubmit = vi.fn();
    instance = mount({ onSubmit });
    await tick();
    for (const ch of 'ship it') {
      instance.stdin.write(ch);
      await tick(5);
    }
    expect(instance.lastFrame()).toContain('› ship it');
    instance.stdin.write('\r');
    await tick();
    expect(onSubmit).toHaveBeenCalledWith('ship it');
  });
  it('cancels on the first ctrl+c', async () => {
    const onCancel = vi.fn();
    instance = mount({ onCancel });
    await tick();
    instance.stdin.write('\u0003');
    await tick();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(instance.lastFrame()).toContain('cancelling…');
  });
});

describe('App: rendering modes', () => {
  it('emits no ANSI escapes with an unstyled theme (NO_COLOR)', () => {
    instance = mount();
    expect(instance.lastFrame()).not.toMatch(ANSI);
  });
  it('stacks into a single column under 80 columns', () => {
    instance = mount({ columns: 70, rows: 40 });
    const lines = instance.lastFrame()!.split('\n');
    for (const line of lines) expect([...line].length).toBeLessThanOrEqual(70);
    const treeRow = lines.findIndex((l) => l.includes('AGENTS'));
    const focusRow = lines.findIndex((l) => l.includes('builder · awaiting approval'));
    expect(treeRow).toBeGreaterThan(0);
    expect(focusRow).toBeGreaterThan(treeRow);
    // Outer frame only: no column divider inside the row.
    expect(lines[treeRow]!.slice(1, -1)).not.toContain('│');
    expect(instance.lastFrame()).toContain('[y] approve');
  });
  it('uses two columns between 80 and 99 columns', () => {
    instance = mount({ columns: 90 });
    const frame = instance.lastFrame()!;
    const row = frame.split('\n').find((l) => l.includes('AGENTS'))!;
    expect(row).toContain('│');
  });
  it('renders pure ASCII chrome with ASCII glyphs', () => {
    instance = mount({ glyphs: ASCII_GLYPHS });
    const frame = instance.lastFrame()!;
    expect(/^[\x0a\x20-\x7e]*$/.test(frame)).toBe(true);
    expect(frame).toContain('* EDU');
  });
  it('shows the empty state before any event', () => {
    instance = mount({ events: [] });
    expect(instance.lastFrame()).toContain('waiting for a run');
    expect(instance.lastFrame()).toContain('no agents yet');
  });
  it('renders the engine demo script', () => {
    instance = mount({ events: demoEvents() });
    const frame = instance.lastFrame()!;
    expect(frame).toContain('crew · claude+codex+pi');
    expect(frame).toContain('✓ done');
  });
});

describe('App: live stream', () => {
  it('consumes an async iterable and updates as events arrive', async () => {
    async function* stream(): AsyncGenerator<EduEvent> {
      yield { type: 'run.start', runId: 'r', goal: 'live goal', mode: 'solo', at: fixtureAt(0) };
      await tick(10);
      yield { type: 'agent.spawn', agentId: 'a', role: 'builder', cli: 'codex', task: 'build', at: fixtureAt(1) };
      yield { type: 'agent.text', agentId: 'a', text: 'streaming now', at: fixtureAt(2) };
    }
    instance = mount({ events: stream() });
    // Poll rather than sleep a fixed time: slow CI runners (Windows) render later.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !instance.lastFrame()?.includes('streaming now')) await tick(25);
    const frame = instance.lastFrame()!;
    expect(frame).toContain('"live goal"');
    expect(frame).toContain('streaming now');
    expect(frame).toContain('solo · codex');
  });
  it('surfaces a failing stream as an error instead of crashing', async () => {
    async function* broken(): AsyncGenerator<EduEvent> {
      yield { type: 'agent.spawn', agentId: 'a', role: 'lead', cli: 'claude', task: 't', at: fixtureAt(0) };
      throw new Error('pipe closed');
    }
    instance = mount({ events: broken() });
    await tick(40);
    expect(instance.lastFrame()).toContain('✗ event stream: pipe closed');
  });
});

describe('App: home screen typing', () => {
  it('focuses the composer on mount so typing works without tab, and submits on enter', async () => {
    const onSubmit = vi.fn();
    instance = mount({ events: [], onSubmit });
    await tick();
    expect(instance.lastFrame()).toContain('type what you want Edu to do');
    instance.stdin.write('hola');
    await tick();
    expect(instance.lastFrame()).toContain('hola');
    instance.stdin.write('\r');
    await tick();
    expect(onSubmit).toHaveBeenCalledWith('hola');
  });

  it('quits on ctrl+c when nothing is running instead of waiting for a cancel', async () => {
    const onCancel = vi.fn();
    instance = mount({ events: [], onSubmit: () => {}, onCancel });
    await tick();
    instance.stdin.write('\u0003');
    await tick();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
