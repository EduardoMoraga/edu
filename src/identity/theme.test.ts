import { describe, expect, it } from 'vitest';
import { PALETTE, createTheme, detectColorLevel } from './theme.js';

const tty = (env: Record<string, string | undefined>) => detectColorLevel({ env, isTTY: true });

describe('detectColorLevel', () => {
  it('disables color when NO_COLOR is set and non-empty', () => {
    expect(tty({ NO_COLOR: '1', COLORTERM: 'truecolor' })).toBe(0);
    expect(tty({ NO_COLOR: '', COLORTERM: 'truecolor' })).toBe(3);
  });
  it('lets FORCE_COLOR override NO_COLOR and non-TTY output', () => {
    expect(detectColorLevel({ env: { FORCE_COLOR: '3', NO_COLOR: '1' }, isTTY: false })).toBe(3);
    expect(detectColorLevel({ env: { FORCE_COLOR: '2' }, isTTY: false })).toBe(2);
    expect(detectColorLevel({ env: { FORCE_COLOR: '' }, isTTY: false })).toBe(1);
    expect(detectColorLevel({ env: { FORCE_COLOR: 'true' }, isTTY: false })).toBe(1);
    expect(tty({ FORCE_COLOR: '0', COLORTERM: 'truecolor' })).toBe(0);
    expect(tty({ FORCE_COLOR: 'false' })).toBe(0);
  });
  it('disables color for pipes and dumb terminals', () => {
    expect(detectColorLevel({ env: { COLORTERM: 'truecolor' }, isTTY: false })).toBe(0);
    expect(tty({ TERM: 'dumb' })).toBe(0);
  });
  it('detects truecolor, 256 and 16 color terminals', () => {
    expect(tty({ COLORTERM: 'truecolor' })).toBe(3);
    expect(tty({ COLORTERM: '24bit' })).toBe(3);
    expect(tty({ TERM_PROGRAM: 'iTerm.app' })).toBe(3);
    expect(tty({ WT_SESSION: 'abc' })).toBe(3);
    expect(tty({ TERM: 'xterm-256color' })).toBe(2);
    expect(tty({ TERM: 'xterm' })).toBe(1);
    expect(tty({})).toBe(1);
  });
});

describe('createTheme', () => {
  it('maps tokens to Ink color strings per level', () => {
    expect(createTheme(3).color('accent')).toBe(PALETTE.accent.truecolor);
    expect(createTheme(2).color('accent')).toBe(`ansi256(${PALETTE.accent.ansi256})`);
    expect(createTheme(1).color('accent')).toBe(PALETTE.accent.ansi16);
    expect(createTheme(0).color('accent')).toBeUndefined();
  });
  it('paints raw ANSI only when color is enabled', () => {
    expect(createTheme(0).paint('accent', 'EDU', { bold: true })).toBe('EDU');
    const painted = createTheme(2).paint('accent', 'EDU', { bold: true });
    expect(painted).toContain(`\u001B[38;5;${PALETTE.accent.ansi256}m`);
    expect(painted).toContain('\u001B[1m');
    expect(painted.endsWith('\u001B[0m')).toBe(true);
    expect(createTheme(3).paint('accent', 'x')).toMatch(/\u001B\[38;2;\d+;\d+;\d+mx/);
    expect(createTheme(1).paint('danger', 'x')).toBe('\u001B[31mx\u001B[0m');
  });
  it('reports whether styling is allowed', () => {
    expect(createTheme(0).styled).toBe(false);
    expect(createTheme(1).styled).toBe(true);
  });
});
