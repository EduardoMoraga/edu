/**
 * Mission-control breakpoints, as a pure function of terminal size.
 *
 * full    (≥ 140 cols): constellation + deck side by side, bus below.
 * compact (100–139):    constellation over the bus; deck as a one-line summary.
 * none    (< 100 cols or too short): the list layout (layout.ts) is used.
 */
export type MissionMode = 'full' | 'compact';

export interface MissionLayout {
  mode: MissionMode;
  columns: number;
  rows: number;
  /** Constellation panel (outer size, frame included). */
  stage: { width: number; height: number };
  /** Deck column width (full mode only; 0 when collapsed). */
  deckWidth: number;
  /** Bus panel height, frame included. */
  busHeight: number;
}

export const FULL_COLUMNS = 140;
export const COMPACT_COLUMNS = 100;
/** Below this many rows the constellation cannot breathe; use the list layout. */
export const MISSION_MIN_ROWS = 26;

export interface MissionChrome {
  /** Composer rows. */
  composer: number;
  /** Notice rows above the composer. */
  notice?: number;
}

export function missionLayout(columns: number, rows: number, chrome: MissionChrome): MissionLayout | undefined {
  const cols = Math.floor(columns || 0);
  const r = Math.floor(rows || 0);
  if (cols < COMPACT_COLUMNS || r < MISSION_MIN_ROWS) return undefined;
  const busHeight = Math.max(6, Math.min(14, Math.round(r * 0.26)));
  // Title row, composer, notice and the status bar.
  const chromeRows = 1 + chrome.composer + (chrome.notice ?? 0) + 1;
  if (cols >= FULL_COLUMNS) {
    const deckWidth = Math.max(42, Math.min(56, Math.round(cols * 0.3)));
    return { mode: 'full', columns: cols, rows: r, deckWidth, busHeight, stage: { width: cols - deckWidth - 1, height: r - chromeRows - busHeight } };
  }
  return { mode: 'compact', columns: cols, rows: r, deckWidth: 0, busHeight, stage: { width: cols, height: r - chromeRows - 1 - busHeight } };
}
