import { describe, expect, it } from 'vitest';
import type { EduEvent } from '../../core/contracts.js';
import { ASCII_GLYPHS, UNICODE_GLYPHS } from '../../identity/index.js';
import { fixtureAt, oauthRun } from '../../test-support/tui-events.js';
import type { DisplayLine } from '../lines.js';
import { initialState, reduceAll } from '../state.js';
import { uiStrings } from '../strings.js';
import { lineWidth } from './cells.js';
import { deckLines, deckSummary, type DeckInput } from './deck.js';

/** The OAuth fixture (builder waiting for approval) plus a spec, one passed check and a context reading. */
function mission(): EduEvent[] {
  return [
    ...oauthRun(),
    { type: 'spec.ready', path: 'specs/oauth.md', requirements: [], checks: [{ id: 'C-1' }, { id: 'C-2' }] as never, steps: [], at: fixtureAt(238) },
    { type: 'verify.result', checkId: 'C-1', requirementIds: ['R-1'], ok: true, output: 'ok', kind: 'deterministic', at: fixtureAt(239) },
    { type: 'context.usage', usedTokens: 50_000, windowTokens: 200_000, at: fixtureAt(240) },
  ];
}

const text = (lines: DisplayLine[]): string[] => lines.map((line) => line.map((s) => s.text).join(''));
/** Panel titles in drawing order, read from the top edges. */
const titles = (lines: DisplayLine[]): string[] =>
  text(lines).flatMap((row) => /^[╭+][─-] (.+?) [─-]/.exec(row)?.[1] ?? []);

const input = (over: Partial<DeckInput> = {}): DeckInput => ({
  state: reduceAll(mission()),
  width: 48,
  height: 40,
  now: Date.parse(fixtureAt(300)),
  glyphs: UNICODE_GLYPHS,
  strings: uiStrings('en'),
  ...over,
});

describe('deckLines', () => {
  it('stacks every panel at exactly the asked width and height', () => {
    for (const [width, height] of [[48, 40], [32, 22], [80, 60]] as const) {
      const lines = deckLines(input({ width, height, focusId: 'bld' }));
      expect(lines).toHaveLength(height);
      for (const line of lines) if (line.length) expect(lineWidth(line)).toBe(width);
    }
  });

  it('shows the run, context, gate, agents, checks, brain and the focused agent log', () => {
    const lines = deckLines(input({ focusId: 'bld' }));
    expect(titles(lines)).toEqual(['run', 'context', 'gate', 'agents', 'checks', 'brain', 'log · bld']);
    const shown = text(lines).join('\n');
    expect(shown).toMatch(/claude · solo/);
    expect(shown).toMatch(/\$0\.42 · 38\.1k tok · 1 active/);
    expect(shown).toMatch(/25% 50k\/200k/);
    expect(shown).toMatch(/⏸ 1 pending/);
    expect(shown).toMatch(/⏸ builder wants to write 3 files/);
    expect(shown).toMatch(/ 1\/3 /);
    expect(shown).toMatch(/✓ 1: Map the auth flow/);
    expect(shown).toMatch(/⏸ 2: Add the callback route/);
    expect(shown).toMatch(/ 1\/2 /);
    expect(shown).toMatch(/✓ C-1 R-1/);
    expect(shown).toMatch(/○ C-2/);
    expect(shown).toMatch(/↺4 \+1/);
    expect(shown).toMatch(/Edit src\/auth\.ts/);
  });

  it('highlights the focused agent row', () => {
    const lines = deckLines(input({ focusId: 'bld' }));
    const row = lines.find((line) => line.some((s) => s.text.includes('Add the callback route')));
    expect(row?.find((s) => s.text.includes('Add the callback route'))).toMatchObject({ tone: 'peach', bold: true });
    const other = lines.find((line) => line.some((s) => s.text.includes('Map the auth flow')));
    expect(other?.find((s) => s.text.includes('Map the auth flow'))?.bold).toBeUndefined();
  });

  it('drops panels by priority when short: log first, then brain, checks and agents; run stays', () => {
    // Framed heights: run 4, context 3, gate 4, agents 5, checks 4, brain 5, log at least 5.
    const at = (height: number) => titles(deckLines(input({ height, focusId: 'bld' })));
    expect(at(30)).toEqual(['run', 'context', 'gate', 'agents', 'checks', 'brain', 'log · bld']);
    expect(at(29)).toEqual(['run', 'context', 'gate', 'agents', 'checks', 'brain']);
    expect(at(24)).toEqual(['run', 'context', 'gate', 'agents', 'checks']);
    expect(at(19)).toEqual(['run', 'context', 'gate', 'agents']);
    expect(at(15)).toEqual(['run', 'context', 'gate']);
    expect(at(10)).toEqual(['run', 'context']);
    expect(at(6)).toEqual(['run']);
    const tiny = deckLines(input({ height: 2 }));
    expect(tiny).toHaveLength(2);
    expect(titles(tiny)).toEqual(['run']);
  });

  it('draws nothing when there is no room (a tall composer can leave the stage at zero or less)', () => {
    for (const height of [0, -1, -3, Number.NaN]) expect(deckLines(input({ height }))).toEqual([]);
  });

  it('says it is waiting when no agent is focused', () => {
    const shown = text(deckLines(input())).join('\n');
    expect(shown).toMatch(/─ log ─/);
    expect(shown).toContain(uiStrings('en').focus.waiting);
  });

  it('in the conversation view keeps run, the gate once used, brain and context only', () => {
    expect(titles(deckLines(input({ chat: true })))).toEqual(['run', 'gate', 'brain', 'context']);
    const quiet = reduceAll(mission().filter((e) => e.type !== 'approval.request' && !(e.type === 'agent.status' && e.status === 'awaiting-approval')));
    expect(titles(deckLines(input({ state: quiet, chat: true })))).toEqual(['run', 'brain', 'context']);
  });

  it('draws an empty run honestly: no model, unknown cost and tokens, no optional panels', () => {
    const lines = deckLines(input({ state: initialState, height: 20 }));
    expect(titles(lines)).toEqual(['run', 'gate', 'log']);
    expect(text(lines).join('\n')).toMatch(/— · solo/);
    expect(text(lines).join('\n')).toMatch(/unknown · unknown tok · 0 active/);
  });

  it('draws with ASCII glyphs', () => {
    const lines = deckLines(input({ glyphs: ASCII_GLYPHS, focusId: 'bld' }));
    expect(lines).toHaveLength(40);
    expect(text(lines).join('\n')).toMatch(/<4 \+1/);
    for (const row of text(lines)) expect(row).toMatch(/^[\x20-\x7e]*$/);
  });
});

describe('deckSummary', () => {
  it('fits run, context, gate, checks and brain on one line', () => {
    expect(text([deckSummary(reduceAll(mission()), UNICODE_GLYPHS)])[0]).toBe(
      'claude · solo  $0.42 · 38.1k tok  │  ctx ▰▱▱▱▱ 25%  │  gate ✓0 ✗0 ⏸1  │  checks 1/2  │  brain ↺4 +1',
    );
  });

  it('leaves out what has not happened, and the conversation view hides an unused gate', () => {
    expect(text([deckSummary(initialState, UNICODE_GLYPHS)])[0]).toBe('— · solo  unknown · unknown tok  │  gate ✓0 ✗0 ⏸0');
    expect(text([deckSummary(initialState, UNICODE_GLYPHS, true)])[0]).toBe('— · solo  unknown · unknown tok');
  });

  it('uses ASCII separators and marks without Unicode', () => {
    const line = text([deckSummary(reduceAll(mission()), ASCII_GLYPHS)])[0]!;
    expect(line).toMatch(/  \|  brain <4 \+1$/);
    expect(line).toMatch(/^[\x20-\x7e]*$/);
  });
});
