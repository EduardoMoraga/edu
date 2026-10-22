import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EduEvent } from '../../core/contracts.js';
import { ASCII_GLYPHS, UNICODE_GLYPHS, createTheme, displayWidth } from '../../identity/index.js';
import { uiStrings } from '../strings.js';
import { App, type AppProps } from '../App.js';
import { demoEvents as unmeasuredDemoEvents } from '../demo.js';

// This layout fixture declares complete measurements; incomplete real events have separate coverage.
function demoEvents(): EduEvent[] {
  const events = unmeasuredDemoEvents();
  const known = { inputTokens: true, outputTokens: true, costUsd: true };
  return events.flatMap((event): EduEvent[] => {
    if (event.type === 'usage') return [{ ...event, usage: { ...event.usage, known } }];
    if (event.type === 'agent.spawn') return [event, { type: 'usage', agentId: event.agentId, at: event.at, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, known } }];
    return [event];
  });
}
import { reduceAll } from '../state.js';
import { CARD_HEIGHT, constellationLines, placeCards } from './constellation.js';
import { overlaps } from './canvas.js';
import { missionLayout } from './layout.js';

const plain = createTheme(0);
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

/** Demo events up to (and including) the builder's write approval. */
function atWriteApproval(): EduEvent[] {
  const all = demoEvents();
  const i = all.findIndex((e) => e.type === 'approval.request' && e.approvalId === 'write-files');
  return all.slice(0, i + 2);
}

const mount = (props: Partial<AppProps> & { columns: number; rows: number }) =>
  render(<App events={atWriteApproval()} theme={plain} glyphs={UNICODE_GLYPHS} {...props} />);

let instance: ReturnType<typeof render> | undefined;
afterEach(() => {
  instance?.unmount();
  instance = undefined;
});

describe('mission layout breakpoints', () => {
  it('is full at ≥140 cols, compact at 100–139, and off below 100 cols or 26 rows', () => {
    const chrome = { composer: 1 };
    expect(missionLayout(160, 48, chrome)).toMatchObject({ mode: 'full', deckWidth: 48 });
    expect(missionLayout(140, 40, chrome)?.mode).toBe('full');
    expect(missionLayout(139, 40, chrome)).toMatchObject({ mode: 'compact', deckWidth: 0 });
    expect(missionLayout(100, 30, chrome)?.mode).toBe('compact');
    expect(missionLayout(99, 48, chrome)).toBeUndefined();
    expect(missionLayout(160, 25, chrome)).toBeUndefined();
  });
  it('budgets rows so the frame fills the terminal exactly', () => {
    for (const [cols, rows] of [[160, 48], [110, 40], [100, 26]] as const) {
      const l = missionLayout(cols, rows, { composer: 1 })!;
      const used = 1 + l.stage.height + (l.mode === 'compact' ? 1 : 0) + l.busHeight + 1 + 1;
      expect(used).toBe(rows);
    }
  });
});

describe('mission control rendering', () => {
  it('full (160×48): constellation, deck sections, bus and status bar, all within width', () => {
    instance = mount({ columns: 160, rows: 48 });
    const frame = instance.lastFrame()!;
    const lines = frame.split('\n');
    expect(lines).toHaveLength(48);
    for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(160);
    expect(lines[0]).toContain('◆ EDU  mission control');
    expect(frame).toContain('─ constellation ─');
    expect(frame).toMatch(/─ ◆ orchestrator ─+ 2\/5 ─╮/);
    for (const section of ['run', 'context', 'gate', 'agents', 'checks', 'brain', 'log · builder-1']) expect(frame).toContain(`╭─ ${section} ─`);
    expect(frame).toContain('demo-model · crew');
    expect(frame).toMatch(/ctx ▰+▱+ 34% 341k\/1M/);
    expect(frame).toContain('✓ 1 allowed · ✗ 0 denied · ⏸ 1 pending');
    expect(frame).toMatch(/✓ 1: Map the auth call path\s+━{8}\s+0:04/);
    expect(frame).toContain('○ regression');
    expect(frame).toContain('─ message bus ─');
    expect(frame).toMatch(/\d\d:\d\d\.\d{3} ● builder-1\s+→ you\s+builder-1 wants to write 3 files/);
  });
  it('shows five agent cards with progress, a spinner for running ones and connectors', () => {
    instance = mount({ columns: 160, rows: 48 });
    const frame = instance.lastFrame()!;
    for (const id of ['explorer-1', 'explorer-2', 'builder-1', 'builder-2', 'reviewer-1']) expect(frame).toContain(`✱ ${id}`);
    expect(frame).toMatch(/✓ ━+ 100%/);
    expect(frame).toMatch(/⏸ ━+─+\s+\d+%/);
    expect(frame).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] ━+─+\s+\d+%/);
    expect(frame).toContain('○ queued');
    expect(frame).toMatch(/┄┄/);
    expect(frame).toMatch(/┆/);
  });
  it('compact (110×40): constellation over the bus with a one-line deck summary', () => {
    instance = mount({ columns: 110, rows: 40 });
    const frame = instance.lastFrame()!;
    const lines = frame.split('\n');
    expect(lines).toHaveLength(40);
    expect(frame).toContain('─ constellation ─');
    expect(frame).not.toContain('╭─ gate ─');
    expect(frame).toMatch(/demo-model · crew\s+\$0\.48 · 78\.5k tok\s+│\s+ctx ▰+▱+ 34%\s+│\s+gate ✓1 ✗0 ⏸1\s+│\s+checks 0\/3\s+│\s+brain ↺3 \+0/);
    expect(frame).toContain('─ message bus ─');
  });
  it('keeps the list layout below 100 columns', () => {
    instance = mount({ columns: 99, rows: 40 });
    const frame = instance.lastFrame()!;
    expect(frame).toContain('AGENTS');
    expect(frame).not.toContain('constellation');
  });
  it('turns the status bar into an approval banner, and approves with y', async () => {
    const onApprove = vi.fn();
    instance = mount({ columns: 160, rows: 48, onApprove });
    const last = () => instance!.lastFrame()!.split('\n').at(-1)!;
    expect(last()).toMatch(/^ ◆ APPROVAL  builder-1 · builder-1 wants to write 3 files\s+y approve · n reject · d details$/);
    await tick();
    instance.stdin.write('d');
    await tick();
    expect(instance.lastFrame()).toContain('─ details · builder-1 wants to write 3 files ─');
    expect(instance.lastFrame()).toContain('src/routes/callback.ts');
    instance.stdin.write('y');
    await tick();
    expect(onApprove).toHaveBeenCalledWith('write-files', true);
    expect(last()).toMatch(/^ ● running · 2\/5 agents/);
  });
  it('names the spec in the banner when the lead asks to approve it', () => {
    const all = demoEvents();
    const events = all.slice(0, all.findIndex((e) => e.type === 'approval.request') + 1);
    instance = render(<App events={events} theme={plain} glyphs={UNICODE_GLYPHS} columns={160} rows={48} />);
    expect(instance.lastFrame()!.split('\n').at(-1)).toMatch(/^ ◆ approve spec · 3 reqs · 3 checks\s+y approve/);
  });
  it('turns the status bar into an error banner for run-level errors', () => {
    const events: EduEvent[] = [
      { type: 'run.start', runId: 'r', goal: 'g', mode: 'solo', at: '2026-10-08T12:00:00.000Z' },
      { type: 'error', message: 'no engine available', at: '2026-10-08T12:00:01.000Z' },
    ];
    instance = render(<App events={events} theme={plain} glyphs={UNICODE_GLYPHS} columns={120} rows={30} />);
    expect(instance.lastFrame()!.split('\n').at(-1)).toMatch(/^ ✗ no engine available$/);
  });
  it('scrolls the bus with page keys and shows how many rows are newer', async () => {
    instance = render(<App events={demoEvents()} theme={plain} glyphs={UNICODE_GLYPHS} columns={160} rows={48} />);
    expect(instance.lastFrame()).toMatch(/─ message bus ─+ \d+ ─╮/);
    await tick();
    instance.stdin.write('\u001B[5~');
    await tick();
    expect(instance.lastFrame()).toMatch(/─ message bus ─+ \d+ newer ↓ end ─╮/);
  });
  it('opens the help overlay in place of the stage and keeps the bus and status bar', async () => {
    instance = mount({ columns: 160, rows: 48 });
    await tick();
    instance.stdin.write('?');
    await tick();
    const frame = instance.lastFrame()!;
    expect(frame).toContain('KEYS');
    expect(frame).not.toContain('─ constellation ─');
    expect(frame).toContain('─ message bus ─');
    expect(frame.split('\n')).toHaveLength(48);
  });
  it('renders pure ASCII chrome with ASCII glyphs', () => {
    instance = render(<App events={atWriteApproval()} theme={plain} glyphs={ASCII_GLYPHS} columns={160} rows={48} />);
    const frame = instance.lastFrame()!;
    expect(frame).toContain('+- constellation -');
    expect(frame).toContain('* explorer-1');
    expect([...frame].every((ch) => ch.charCodeAt(0) < 128)).toBe(true);
  });
  it('plays the full demo to a finished, static mission view', () => {
    instance = render(<App events={demoEvents()} theme={plain} glyphs={UNICODE_GLYPHS} columns={160} rows={48} />);
    const frame = instance.lastFrame()!;
    expect(frame).toMatch(/─ ◆ orchestrator ─+ 5\/5 ─╮/);
    expect(frame).toContain('✓ done · 24s · claude');
    expect(frame).toMatch(/─ checks ─+ 3\/3 ─╮/);
    expect(frame).toContain('+ L-check-oauth-state-first');
    expect(frame.split('\n').at(-1)).toContain('✓ done · 5/5 agents');
  });
});

describe('constellation geometry and pulses', () => {
  it('places 1–8 cards without overlapping each other or the hub', () => {
    for (const [w, h] of [[106, 29], [102, 22], [140, 16]] as const) {
      for (let n = 1; n <= 8; n++) {
        const ids = Array.from({ length: n }, (_, i) => `a${i}`);
        const p = placeCards(ids, w, h);
        const rects = p.cards.map((c) => c.rect);
        expect(p.cards.length + p.hidden).toBe(n);
        for (const r of rects) {
          expect(overlaps(r, p.hub, 0, 0)).toBe(false);
          expect(r.x).toBeGreaterThanOrEqual(0);
          expect(r.x + r.w).toBeLessThanOrEqual(w);
          expect(r.y + CARD_HEIGHT).toBeLessThanOrEqual(h);
        }
        rects.forEach((a, i) => rects.slice(i + 1).forEach((b) => expect(overlaps(a, b, 0, 0)).toBe(false)));
      }
    }
  });
  it('draws a travelling dot only while animating a live run, moving along the connector', () => {
    const events = atWriteApproval();
    const state = reduceAll(events);
    const pulse = state.mission.pulses.at(-1)!;
    const draw = (animate: boolean, age: number) =>
      constellationLines({ state, width: 106, height: 29, now: pulse.at + age, glyphs: UNICODE_GLYPHS, strings: uiStrings('en'), animate })
        .map((l) => l.map((s) => s.text).join(''))
        .join('\n');
    // The hub's own `● running` status is not a pulse: subtract the static frame.
    const pulses = (age: number) => {
      const still = new Set([...draw(false, age).matchAll(/●/g)].map((m) => m.index));
      return [...draw(true, age).matchAll(/●/g)].map((m) => m.index).filter((i) => !still.has(i));
    };
    const early = pulses(50);
    const late = pulses(500);
    expect(early.length).toBeGreaterThan(0);
    expect(late.length).toBeGreaterThan(0);
    expect(late).not.toEqual(early);
    expect(pulses(5_000)).toHaveLength(0);
  });
});
