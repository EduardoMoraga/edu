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
