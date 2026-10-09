import { describe, expect, it } from 'vitest';
import { TAGLINE, renderBanner } from './banner.js';
import { displayWidth } from './format.js';
import { createTheme } from './theme.js';

const ANSI = /\u001B\[[0-9;]*m/g;

describe('renderBanner', () => {
  it('fits in 60 columns in both glyph modes', () => {
    for (const unicode of [true, false]) {
      const lines = renderBanner({ unicode }).split('\n');
      expect(lines.length).toBeGreaterThan(3);
      for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(60);
    }
  });
  it('includes the tagline and an optional version', () => {
    const text = renderBanner({ unicode: true, version: '0.1.0' });
    expect(text).toContain(TAGLINE);
    expect(text).toContain('v0.1.0');
  });
  it('uses only ASCII in fallback mode', () => {
    expect(/^[\x0a\x20-\x7e]*$/.test(renderBanner({ unicode: false }))).toBe(true);
  });
  it('paints the wordmark with the accent only when color is on', () => {
    expect(renderBanner({ unicode: true, theme: createTheme(0) })).not.toMatch(ANSI);
    const colored = renderBanner({ unicode: true, theme: createTheme(3) });
    expect(colored).toMatch(ANSI);
    expect(colored.replace(ANSI, '')).toBe(renderBanner({ unicode: true }));
  });
  it('shows a custom identity name in the signature line', () => {
    expect(renderBanner({ unicode: true, name: 'Ada' })).toContain('Ada');
  });
});
