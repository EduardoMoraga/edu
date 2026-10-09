import { describe, expect, it } from 'vitest';
import { FOLLOW, focusWindow, scrollBy, scrollToTop } from './focus.js';
import type { DisplayLine } from './lines.js';

const lines = (n: number): DisplayLine[] => Array.from({ length: n }, (_, i) => [{ text: `l${i + 1}` }]);
const texts = (ls: DisplayLine[]) => ls.map((l) => l[0]!.text);

describe('focus scrolling', () => {
  it('shows the newest lines while following', () => {
    expect(texts(focusWindow(lines(10), 4, FOLLOW).lines)).toEqual(['l7', 'l8', 'l9', 'l10']);
  });

  it('pins the top line and reserves the last row for the newer-lines hint', () => {
    const up = scrollBy(FOLLOW, 10, 4, -1);
    expect(up).toEqual({ follow: false, top: 6 });
    expect(focusWindow(lines(10), 4, up)).toEqual({ lines: lines(10).slice(6, 9), newer: 1 });
    // More output does not move a pinned view.
    expect(texts(focusWindow(lines(20), 4, up).lines)).toEqual(['l7', 'l8', 'l9']);
  });

  it('resumes following when scrolled back to the bottom', () => {
    expect(scrollBy({ follow: false, top: 6 }, 10, 4, 1)).toEqual(FOLLOW);
    expect(scrollBy({ follow: false, top: 2 }, 10, 4, -5)).toEqual({ follow: false, top: 0 });
  });

  it('jumps to the oldest line only when there is something to scroll', () => {
    expect(scrollToTop(10, 4)).toEqual({ follow: false, top: 0 });
    expect(scrollToTop(3, 4)).toEqual(FOLLOW);
    expect(scrollBy(FOLLOW, 3, 4, -1)).toEqual(FOLLOW);
  });
});
