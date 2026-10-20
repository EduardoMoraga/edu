import { describe, expect, it } from 'vitest';
import { estimateTokens, truncateToTokens } from './tokens.js';

describe('token estimates', () => {
  it('approximates ordinary English while charging more for code and CJK', () => {
    const prose = 'A thoughtful sentence with several ordinary English words.'.repeat(8);
    expect(estimateTokens(prose)).toBeGreaterThan(prose.length / 4.5);
    expect(estimateTokens(prose)).toBeLessThan(prose.length / 3);
    expect(estimateTokens('if(x){y++;}'.repeat(20))).toBeGreaterThan(estimateTokens('abcdefghijk'.repeat(20)));
    expect(estimateTokens('東京大学'.repeat(20))).toBeGreaterThan(estimateTokens('abcd'.repeat(20)));
  });

  it('truncates at a line boundary and never exceeds the limit', () => {
    const text = 'First paragraph has useful information.\nSecond line carries detail.\nThird line is extra.';
    const result = truncateToTokens(text, estimateTokens('First paragraph has useful information.\n…'));
    expect(result).toBe('First paragraph has useful information.\n…');
    expect(estimateTokens(result)).toBeLessThanOrEqual(estimateTokens('First paragraph has useful information.\n…'));
    expect(truncateToTokens(text, 0)).toBe('');
    expect(truncateToTokens(text, 1000)).toBe(text);
  });
});


it('fills the budget after a short header instead of discarding the body', () => {
  const result = truncateToTokens('# Header\n\n' + 'Operational detail matters. '.repeat(200), 100);
  expect(result).toContain('Operational detail');
  expect(estimateTokens(result)).toBeGreaterThanOrEqual(90);
  expect(estimateTokens(result)).toBeLessThanOrEqual(100);
});

it('preserves Unicode graphemes at truncation boundaries', () => {
  const unit = '👩🏽‍💻e\u0301東京';
  const input = unit.repeat(100);
  const boundaries = new Set([...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(input)].map(part => part.index));
  for (let budget = 1; budget < 80; budget++) {
    const result = truncateToTokens(input, budget);
    expect(estimateTokens(result)).toBeLessThanOrEqual(budget);
    expect(boundaries.has(result.replace(/…$/, '').length)).toBe(true);
  }
});
