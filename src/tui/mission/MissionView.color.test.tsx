/**
 * Mission control under each color level. FORCE_COLOR makes Ink's chalk emit
 * ANSI, so only the theme decides what styling reaches the output.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';

const previous = vi.hoisted(() => {
  const value = process.env.FORCE_COLOR;
  process.env.FORCE_COLOR = '3';
  return value;
});

import { render } from 'ink-testing-library';
import { UNICODE_GLYPHS, createTheme, detectColorLevel, type ColorLevel } from '../../identity/index.js';
import { App } from '../App.js';
import { demoEvents } from '../demo.js';

const ANSI = /\u001B\[[0-9;]*m/;
const strip = (s: string) => s.replace(/\u001B\[[0-9;]*m/g, '');

afterAll(() => {
  if (previous === undefined) delete process.env.FORCE_COLOR;
  else process.env.FORCE_COLOR = previous;
});

function frameAt(level: ColorLevel): string {
  const all = demoEvents();
  const events = all.slice(0, all.findIndex((e) => e.type === 'approval.request' && e.approvalId === 'write-files') + 1);
  const i = render(<App events={events} theme={createTheme(level)} glyphs={UNICODE_GLYPHS} columns={160} rows={48} />);
  const frame = i.lastFrame()!;
  i.unmount();
  return frame;
}

describe('mission control color handling', () => {
  it('fills the approval banner with the amber accent in truecolor', () => {
    const banner = frameAt(3).split('\n').at(-1)!;
    expect(banner).toContain('\u001B[48;2;245;168;85m');
    expect(banner).toContain('\u001B[38;2;28;26;23m');
    expect(strip(banner)).toContain('◆ APPROVAL  builder-1');
  });
  it('uses 256-color codes at level 2', () => {
    const frame = frameAt(2);
    expect(frame).toMatch(/48;5;215m/);
    expect(frame).not.toMatch(/38;2;|48;2;/);
  });
  it('stays legible with the 16-color palette', () => {
    const frame = frameAt(1);
    expect(frame).not.toMatch(/38;2;|38;5;|48;2;|48;5;/);
    expect(frame).toMatch(/\u001B\[43m/);
    expect(strip(frame)).toContain('─ message bus ─');
  });
  it('emits no escapes at all under NO_COLOR', () => {
    const frame = frameAt(detectColorLevel({ env: { NO_COLOR: '1' }, isTTY: true }));
    expect(frame).not.toMatch(ANSI);
    expect(frame).toContain('◆ APPROVAL  builder-1 · builder-1 wants to write 3 files');
  });
});
