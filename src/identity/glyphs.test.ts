import { describe, expect, it } from 'vitest';
import type { AgentStatus } from '../core/contracts.js';
import { ASCII_GLYPHS, UNICODE_GLYPHS, detectUnicode, getGlyphs, roleIcon, statusGlyph } from './glyphs.js';

describe('detectUnicode', () => {
  it('honors EDU_ASCII=1', () => {
    expect(detectUnicode({ EDU_ASCII: '1', LANG: 'en_US.UTF-8' })).toBe(false);
    expect(detectUnicode({ EDU_ASCII: '0', LANG: 'en_US.UTF-8' })).toBe(true);
  });
  it('uses the first non-empty of LC_ALL, LC_CTYPE, LANG', () => {
    expect(detectUnicode({ LC_ALL: 'C', LANG: 'en_US.UTF-8' })).toBe(false);
    expect(detectUnicode({ LC_ALL: '', LC_CTYPE: 'es_CL.utf8', LANG: 'C' })).toBe(true);
    expect(detectUnicode({ LANG: 'POSIX' })).toBe(false);
    expect(detectUnicode({ LANG: 'en_US.ISO-8859-1' })).toBe(false);
  });
  it('assumes unicode when no locale is set', () => {
    expect(detectUnicode({})).toBe(true);
  });
});

describe('glyph sets', () => {
  it('uses the identity icons in unicode mode', () => {
    expect(UNICODE_GLYPHS.roles).toEqual({ lead: '◆', explorer: '🔍', builder: '⚙', reviewer: '⚖' });
    const statuses: AgentStatus[] = ['queued', 'running', 'awaiting-approval', 'done', 'failed', 'cancelled'];
    expect(statuses.map((s) => statusGlyph(s, UNICODE_GLYPHS))).toEqual(['○', '●', '⏸', '✓', '✗', '⊘']);
  });
  it('is pure 7-bit ASCII in fallback mode', () => {
    const all = JSON.stringify(ASCII_GLYPHS);
    expect(/^[\x20-\x7e]*$/.test(all)).toBe(true);
  });
  it('keeps every ASCII status glyph distinct', () => {
    const values = Object.values(ASCII_GLYPHS.status);
    expect(new Set(values).size).toBe(values.length);
  });
  it('selects the set from the environment', () => {
    expect(getGlyphs({ EDU_ASCII: '1' })).toBe(ASCII_GLYPHS);
    expect(getGlyphs({ LANG: 'en_US.UTF-8' })).toBe(UNICODE_GLYPHS);
  });
});

describe('roleIcon', () => {
  it('maps built-in roles and falls back for custom roles', () => {
    expect(roleIcon('builder', UNICODE_GLYPHS)).toBe('⚙');
    expect(roleIcon('designer', UNICODE_GLYPHS)).toBe(UNICODE_GLYPHS.customRole);
    expect(roleIcon('lead', ASCII_GLYPHS)).toBe('*');
  });
});
