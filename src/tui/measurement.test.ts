import { expect, it } from 'vitest';
import type { EduEvent } from '../core/contracts.js';
import { getGlyphs } from '../identity/index.js';
import { headerModel } from './components/Header.js';
import { computeLayout } from './layout.js';
import { reduceAll } from './state.js';
import { runTotals } from './selectors.js';
import { uiStrings } from './strings.js';
const at = '2026-10-22T00:00:00Z';
it('replays usage receipts once and renders partial tokens and unknown costs explicitly', () => {
  const receipt: EduEvent = { type: 'usage', agentId: 'fixture', at, usage: { inputTokens: 8, outputTokens: 0, observationId: 'call:0', known: { inputTokens: true, outputTokens: true } } };
  const state = reduceAll([receipt, receipt, { type: 'usage', agentId: 'fixture', at, usage: { inputTokens: 0, outputTokens: 0, observationId: 'missing:0', known: { inputTokens: false, outputTokens: false } } }]);
  expect(runTotals(state)).toMatchObject({ tokens: 8, tokensKnown: false, costPartial: true });
  const header = headerModel({ state, layout: computeLayout(120, 30), name: 'Edu', glyphs: getGlyphs({ EDU_ASCII: '1' }), strings: uiStrings('en') });
  expect(header.money).toContain('>=8 (partial) tok');
  expect(header.money).toContain('unknown');
});
