import { describe, expect, it } from 'vitest';
import { displayWidth } from '../identity/index.js';
import type { DisplayLine } from './lines.js';
import { wrapPlain, wrapSegments } from './wrap.js';

const text = (line: DisplayLine) => line.map((s) => s.text).join('');

describe('wrapSegments', () => {
  it('wraps on words without dropping any text', () => {
    const lines = wrapPlain('the quick brown fox jumps over the lazy dog', 12);
    expect(lines).toEqual(['the quick', 'brown fox', 'jumps over', 'the lazy dog']);
    expect(lines.join(' ')).toBe('the quick brown fox jumps over the lazy dog');
  });

  it('keeps a word that spans styled segments together and preserves styles', () => {
    const lines = wrapSegments([{ text: 'press ' }, { text: '[y]', bold: true }, { text: ' approve now' }], 9);
    expect(lines.map(text)).toEqual(['press [y]', 'approve', 'now']);
    expect(lines[0]).toContainEqual({ text: '[y]', bold: true });
  });

  it('applies a hanging indent to continuation lines', () => {
    expect(wrapPlain('✗ something failed badly here', 12, { indent: 2 })).toEqual(['✗ something', '  failed', '  badly here']);
  });

  it('counts CJK and emoji as two cells', () => {
    const lines = wrapPlain('日本語のテキスト 🚀🚀🚀', 6);
    for (const l of lines) expect(displayWidth(l)).toBeLessThanOrEqual(6);
    expect(lines.join('')).toBe('日本語のテキスト🚀🚀🚀');
  });

  it('hard-splits long words and honors explicit newlines', () => {
    expect(wrapPlain('abcdefghij\nxy', 4)).toEqual(['abcd', 'efgh', 'ij', 'xy']);
  });

  it('caps lines with an ellipsis only when asked', () => {
    const lines = wrapPlain('one two three four five six', 9, { maxLines: 2 });
    expect(lines).toHaveLength(2);
    expect(lines[1]!.endsWith('…')).toBe(true);
    expect(displayWidth(lines[1]!)).toBeLessThanOrEqual(9);
  });

  it('keeps deliberate leading spaces on the first line only', () => {
    expect(wrapPlain('  ✓ ok fine', 6)).toEqual(['  ✓ ok', 'fine']);
  });
});
