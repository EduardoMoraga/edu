import { describe, expect, it } from 'vitest';
import { ASCII_GLYPHS, UNICODE_GLYPHS } from './glyphs.js';
import { renderStatusline } from './statusline.js';
import { createTheme } from './theme.js';

describe('renderStatusline', () => {
  it('renders the canonical one-liner', () => {
    expect(renderStatusline({ brainNotes: 243, lessons: 3, ctxPercent: 41 }, { glyphs: UNICODE_GLYPHS })).toBe(
      '◆ EDU · brain 243 · 3 lessons · ctx 41%',
    );
  });
  it('uses singular lesson and omits unknown context', () => {
    expect(renderStatusline({ brainNotes: 1, lessons: 1 }, { glyphs: UNICODE_GLYPHS })).toBe(
      '◆ EDU · brain 1 · 1 lesson',
    );
  });
  it('clamps and rounds the context percent', () => {
    expect(renderStatusline({ brainNotes: 0, lessons: 0, ctxPercent: 140.6 }, { glyphs: UNICODE_GLYPHS })).toContain(
      'ctx 100%',
    );
    expect(renderStatusline({ brainNotes: 0, lessons: 0, ctxPercent: 12.4 }, { glyphs: UNICODE_GLYPHS })).toContain(
      'ctx 12%',
    );
  });
  it('uses the configured name and ASCII glyphs', () => {
    expect(renderStatusline({ brainNotes: 5, lessons: 2 }, { glyphs: ASCII_GLYPHS, name: 'Ada' })).toBe(
      '* ADA - brain 5 - 2 lessons',
    );
  });
  it('paints only the identity mark when color is on', () => {
    const line = renderStatusline({ brainNotes: 5, lessons: 2 }, { glyphs: UNICODE_GLYPHS, theme: createTheme(1) });
    expect(line.startsWith('\u001B[')).toBe(true);
    expect(line.replace(/\u001B\[[0-9;]*m/g, '')).toBe('◆ EDU · brain 5 · 2 lessons');
  });
});
