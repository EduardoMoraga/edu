/**
 * One-line status for Claude Code's statusline and other prompts:
 * `◆ EDU · brain 243 · 3 lessons · ctx 41%`.
 */
import type { Glyphs } from './glyphs.js';
import { createTheme, type Theme } from './theme.js';

export interface StatuslineStats {
  /** Notes in the brain (all tiers). */
  brainNotes: number;
  /** Active lessons (candidate + proven). */
  lessons: number;
  /** Context window used, 0..100; omitted when unknown. */
  ctxPercent?: number;
}

export interface StatuslineOptions {
  glyphs: Glyphs;
  name?: string;
  theme?: Theme;
}

export function renderStatusline(stats: StatuslineStats, opts: StatuslineOptions): string {
  const { glyphs } = opts;
  const theme = opts.theme ?? createTheme(0);
  const name = (opts.name ?? 'Edu').toUpperCase();
  const mark = theme.paint('accent', `${glyphs.roles.lead} ${name}`, { bold: true });
  const parts = [
    `brain ${count(stats.brainNotes)}`,
    `${count(stats.lessons)} ${stats.lessons === 1 ? 'lesson' : 'lessons'}`,
  ];
  if (stats.ctxPercent !== undefined && Number.isFinite(stats.ctxPercent)) {
    parts.push(`ctx ${Math.round(Math.min(100, Math.max(0, stats.ctxPercent)))}%`);
  }
  const sep = ` ${glyphs.sep} `;
  return [mark, ...parts].join(sep);
}

function count(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
