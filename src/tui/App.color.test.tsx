/**
 * Proves the NO_COLOR path is escape-free even when the terminal *could*
 * render color: FORCE_COLOR makes Ink's chalk emit ANSI, and only the theme
 * decides whether any styling reaches the output.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';

const previous = vi.hoisted(() => {
  const value = process.env.FORCE_COLOR;
  process.env.FORCE_COLOR = '3';
  return value;
});

import { render } from 'ink-testing-library';
import { UNICODE_GLYPHS, createTheme, detectColorLevel } from '../identity/index.js';
import { App } from './App.js';
import { oauthRun } from './fixtures.js';

const ANSI = /\u001B\[[0-9;]*m/;

afterAll(() => {
  if (previous === undefined) delete process.env.FORCE_COLOR;
  else process.env.FORCE_COLOR = previous;
});

describe('App color handling', () => {
  it('emits ANSI color with a truecolor theme', () => {
    const i = render(<App events={oauthRun()} theme={createTheme(3)} glyphs={UNICODE_GLYPHS} columns={100} rows={30} />);
    expect(i.lastFrame()).toMatch(ANSI);
    i.unmount();
  });
  it('emits no escapes at all when NO_COLOR resolves the theme to level 0', () => {
    const level = detectColorLevel({ env: { NO_COLOR: '1' }, isTTY: true });
    const i = render(<App events={oauthRun()} theme={createTheme(level)} glyphs={UNICODE_GLYPHS} columns={100} rows={30} />);
    const frame = i.lastFrame()!;
    expect(frame).not.toMatch(ANSI);
    expect(frame).toContain('◆ EDU');
    i.unmount();
  });
  it('stays legible with the 16-color palette', () => {
    const i = render(<App events={oauthRun()} theme={createTheme(1)} glyphs={UNICODE_GLYPHS} columns={100} rows={30} />);
    const frame = i.lastFrame()!;
    expect(frame).not.toMatch(/38;2;|38;5;/);
    expect(frame.replace(/\u001B\[[0-9;]*m/g, '')).toContain('$0.42 · 38.1k tok');
    i.unmount();
  });
});
