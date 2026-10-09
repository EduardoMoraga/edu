import { describe, expect, it } from 'vitest';
import { availableCommands, filterCommands, paletteQuery, parseCommand } from './palette.js';
import { langFromEnv, uiStrings } from './strings.js';

describe('palette model', () => {
  it('offers crew actions only in watch mode', () => {
    expect(availableCommands(false).map((c) => c.name)).not.toContain('dispatch');
    expect(availableCommands(true).map((c) => c.name)).toEqual(expect.arrayContaining(['dispatch', 'status']));
  });

  it('filters by prefix first, then substring', () => {
    const names = filterCommands(availableCommands(true), 're').map((c) => c.name);
    expect(names).toEqual(['reject', 'recall']);
    expect(filterCommands(availableCommands(false), 'a').map((c) => c.name)[0]).toBe('agents');
  });

  it('opens only for a bare /word draft', () => {
    expect(paletteQuery('/')).toBe('');
    expect(paletteQuery('/rec')).toBe('rec');
    expect(paletteQuery('/recall x')).toBeUndefined();
    expect(paletteQuery('hello /x')).toBeUndefined();
  });

  it('parses commands with arguments', () => {
    expect(parseCommand('/recall oauth flow ')).toEqual({ name: 'recall', args: 'oauth flow' });
    expect(parseCommand('/Quit')).toEqual({ name: 'quit', args: '' });
    expect(parseCommand('ship it')).toBeUndefined();
  });

  it('describes every command in both languages', () => {
    for (const lang of ['en', 'es'] as const) {
      for (const c of availableCommands(true)) expect(uiStrings(lang).palette.describe[c.name]).toBeTruthy();
    }
  });
});

describe('langFromEnv', () => {
  it('selects Spanish from EDU_LANG or the locale chain', () => {
    expect(langFromEnv({ LANG: 'es_CL.UTF-8' })).toBe('es');
    expect(langFromEnv({ LC_ALL: 'es-AR', LANG: 'en_US.UTF-8' })).toBe('es');
    expect(langFromEnv({ LC_ALL: 'en_US.UTF-8', LANG: 'es_CL.UTF-8' })).toBe('en');
    expect(langFromEnv({ EDU_LANG: 'es' })).toBe('es');
    expect(langFromEnv({ LANG: 'C' })).toBe('en');
    expect(langFromEnv({ LANG: 'est_EE' })).toBe('en');
  });
});
