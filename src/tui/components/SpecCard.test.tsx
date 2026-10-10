import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import type { EduEvent } from '../../core/contracts.js';
import { ASCII_GLYPHS, UNICODE_GLYPHS, createTheme } from '../../identity/index.js';
import { computeLayout } from '../layout.js';
import { fixtureAt } from '../fixtures.js';
import { initialState, reduce, reduceAll } from '../state.js';
import { uiStrings } from '../strings.js';
import { headerModel } from './Header.js';
import { SpecCard, specLines } from './SpecCard.js';
import { UiContext } from './ui.js';

/** `spec.ready` may not be in the contract union yet: build it as a raw event. */
function specReady(fields: Record<string, unknown>, sec = 1): EduEvent {
  return { type: 'spec.ready', at: fixtureAt(sec), ...fields } as unknown as EduEvent;
}

const PATH = '.edu/specs/20261009-2200-hello-js.md';

describe('spec.ready in the reducer', () => {
  it('folds requirements, checks and steps counts plus the path', () => {
    const state = reduce(
      initialState,
      specReady({
        path: PATH,
        requirements: [{ id: 'R1' }, { id: 'R2' }],
        checks: [{ id: 'C1', command: 'node hello.js' }],
        steps: [{}, {}, {}],
      }),
    );
    expect(state.spec).toEqual({ path: PATH, requirements: 2, checks: 1, steps: 3 });
  });

  it('accepts numeric counts and treats missing lists as zero', () => {
    const state = reduce(initialState, specReady({ path: PATH, requirements: 4 }));
    expect(state.spec).toEqual({ path: PATH, requirements: 4, checks: 0 });
  });

  it('ignores a spec.ready without a usable path', () => {
    expect(reduce(initialState, specReady({ requirements: [] })).spec).toBeUndefined();
    expect(reduce(initialState, specReady({ path: '   ' })).spec).toBeUndefined();
  });

  it('the newest spec wins (re-planning replaces the card)', () => {
    const state = reduceAll([specReady({ path: 'a.md', requirements: 1 }, 1), specReady({ path: 'b.md', requirements: 2 }, 2)]);
    expect(state.spec?.path).toBe('b.md');
    expect(state.spec?.requirements).toBe(2);
  });

  it('tolerates unknown event types without changing state', () => {
    const unknown = { type: 'something.new', at: fixtureAt(1), payload: 1 } as unknown as EduEvent;
    const state = reduce(initialState, unknown);
    expect(state.spec).toBeUndefined();
    expect(state.agents).toEqual({});
  });
});

describe('SpecCard', () => {
  const spec = { path: PATH, requirements: 2, checks: 1, steps: 3 };

  it('lays out counts and path on one line when they fit', () => {
    const lines = specLines(spec, 100, UNICODE_GLYPHS);
    expect(lines).toHaveLength(1);
    const text = lines[0]!.map((s) => s.text).join('');
    expect(text).toContain('2 requirements');
    expect(text).toContain('1 check');
    expect(text).not.toContain('1 checks');
    expect(text).toContain('3 steps');
    expect(text).toContain(PATH);
  });

  it('moves the path to its own line when narrow, truncating it to the width', () => {
    const lines = specLines(spec, 36, ASCII_GLYPHS);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.map((s) => s.text).join('').length).toBeLessThanOrEqual(36);
    expect(lines[1]!.map((s) => s.text).join('')).toContain('hello-js.md');
  });

  it('renders the card', () => {
    const ui = { theme: createTheme(0), glyphs: UNICODE_GLYPHS };
    const { lastFrame, unmount } = render(
      <UiContext value={ui}>
        <SpecCard spec={spec} width={100} />
      </UiContext>,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('spec');
    expect(frame).toContain('2 requirements');
    expect(frame).toContain(PATH);
    unmount();
  });
});

describe('Header with a spec', () => {
  it('budgets the spec card lines into the header height', () => {
    const base = reduceAll([{ type: 'run.start', runId: 'r', goal: 'hello', mode: 'solo', at: fixtureAt(0) }]);
    const layout = computeLayout(120, 40);
    const input = { layout, name: 'Edu', glyphs: UNICODE_GLYPHS, strings: uiStrings('en') };
    const without = headerModel({ ...input, state: base });
    const withSpec = headerModel({ ...input, state: reduce(base, specReady({ path: PATH, requirements: 1, checks: 1 })) });
    expect(without.specLines).toEqual([]);
    expect(withSpec.specLines.length).toBe(1);
    expect(withSpec.height).toBe(without.height + 1);
  });
});
