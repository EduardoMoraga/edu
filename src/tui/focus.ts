/**
 * Focus pane scrolling, as pure functions. The pane follows new output until
 * the user scrolls up; then its top line is pinned (new output does not move
 * the view) until they scroll back to the bottom or press End.
 */
import type { DisplayLine } from './lines.js';

export type ScrollState = { follow: true } | { follow: false; top: number };

export const FOLLOW: ScrollState = { follow: true };

export interface FocusWindow {
  lines: DisplayLine[];
  /** Lines below the window (0 while following). */
  newer: number;
}

function maxTop(total: number, height: number): number {
  return Math.max(0, total - height);
}

/** The visible slice; when pinned, the last row is reserved for the "newer lines" hint. */
export function focusWindow(lines: readonly DisplayLine[], height: number, scroll: ScrollState): FocusWindow {
  const h = Math.max(1, height);
  if (scroll.follow || lines.length <= h || scroll.top > maxTop(lines.length, h)) {
    return { lines: lines.slice(Math.max(0, lines.length - h)), newer: 0 };
  }
  const top = Math.max(0, scroll.top);
  const shown = lines.slice(top, top + Math.max(1, h - 1));
  return { lines: shown, newer: lines.length - top - shown.length };
}

/** Scrolls by `delta` lines (negative = up); reaching the bottom resumes following. */
export function scrollBy(scroll: ScrollState, total: number, height: number, delta: number): ScrollState {
  // Pinned tops run 0..bottom (the last row is the hint); bottom + 1 is "following".
  const bottom = maxTop(total, height);
  if (total <= height) return FOLLOW;
  const current = scroll.follow ? bottom + 1 : Math.min(scroll.top, bottom);
  const next = current + delta;
  if (next > bottom) return FOLLOW;
  return { follow: false, top: Math.max(0, next) };
}

/** Jumps to the oldest line (pinned) unless everything already fits. */
export function scrollToTop(total: number, height: number): ScrollState {
  return total <= height ? FOLLOW : { follow: false, top: 0 };
}
