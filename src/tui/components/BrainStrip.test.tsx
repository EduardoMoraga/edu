import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import type { EduEvent } from '../../core/contracts.js';
import { UNICODE_GLYPHS, createTheme } from '../../identity/index.js';
import { App } from '../App.js';
import { fixtureAt, oauthRun } from '../fixtures.js';
import { initialState, reduce, reduceAll } from '../state.js';
import { BrainStrip } from './BrainStrip.js';
import { UiContext } from './ui.js';

const usage = (usedTokens: number, windowTokens: number, sec = 1): EduEvent => ({
  type: 'context.usage',
  agentId: 'builder-1',
  usedTokens,
  windowTokens,
  at: fixtureAt(sec),
});

describe('context.usage in the reducer', () => {
  it('keeps the newest snapshot (not a sum)', () => {
    const state = reduceAll([usage(1000, 8000, 1), usage(3280, 8000, 2)]);
    expect(state.brain.context).toEqual({ usedTokens: 3280, budgetTokens: 8000, agentId: 'builder-1' });
  });

  it('ignores snapshots without a usable window', () => {
    expect(reduce(initialState, usage(10, 0)).brain.context).toBeUndefined();
    expect(reduce(initialState, usage(Number.NaN, 8000)).brain.context).toBeUndefined();
  });
});

describe('BrainStrip ctx%', () => {
  const ui = { theme: createTheme(0), glyphs: UNICODE_GLYPHS };

  it('shows ctx% folded from context.usage events', () => {
    const brain = reduce(initialState, usage(3280, 8000)).brain;
    const { lastFrame, unmount } = render(
      <UiContext value={ui}>
        <BrainStrip brain={brain} width={80} />
      </UiContext>,
    );
    expect(lastFrame()).toContain('ctx 41% of 8k');
    unmount();
  });

  it('prefers an explicit context prop', () => {
    const brain = reduce(initialState, usage(3280, 8000)).brain;
    const { lastFrame, unmount } = render(
      <UiContext value={ui}>
        <BrainStrip brain={brain} context={{ usedTokens: 500, budgetTokens: 1000 }} width={80} />
      </UiContext>,
    );
    expect(lastFrame()).toContain('ctx 50% of 1k');
    unmount();
  });

  it('reaches the live App brain strip', () => {
    const { lastFrame, unmount } = render(
      <App events={[...oauthRun(), usage(4000, 16000, 999)]} theme={createTheme(0)} glyphs={UNICODE_GLYPHS} columns={110} rows={30} />,
    );
    expect(lastFrame()).toContain('ctx 25% of 16k');
    unmount();
  });
});
