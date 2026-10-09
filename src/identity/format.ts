/**
 * Number, cost, duration and width formatting shared by the TUI and the
 * statusline. Pure functions, no I/O.
 */

/** Compact token count: 950, 38.1k, 1.3M. */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n < 1_000) return String(Math.round(n));
  const k = n / 1_000;
  if (k < 999.95) return `${trimZero(k.toFixed(1))}k`;
  return `${trimZero((n / 1_000_000).toFixed(1))}M`;
}

/** USD with cents; unknown costs render as `$—`, never as a guess. */
export function formatCost(usd: number | undefined): string {
  if (usd === undefined || !Number.isFinite(usd)) return '$—';
  if (usd <= 0) return '$0.00';
  if (usd < 0.005) return '<$0.01';
  if (usd >= 100) return `$${Math.round(usd)}`;
  return `$${usd.toFixed(2)}`;
}

/** Elapsed time: 41s, 2m14s, 1h02m. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h${pad2(m)}m`;
  if (m > 0) return `${m}m${pad2(s)}s`;
  return `${s}s`;
}

/** Ratio (0..1) as an integer percent. */
export function formatPercent(ratio: number): string {
  const v = Number.isFinite(ratio) ? ratio : 0;
  return `${Math.round(v * 100)}%`;
}

/**
 * Terminal cell width of a string. Good enough for UI chrome: wide emoji and
 * CJK count as 2, combining marks and zero-width joiners as 0, and VS16
 * (emoji presentation selector) widens the preceding narrow glyph.
 */
export function displayWidth(text: string): number {
  let width = 0;
  let prev = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0xfe0f) {
      if (prev === 1) width += 1;
      prev = 2;
      continue;
    }
    const w = codePointWidth(cp);
    width += w;
    prev = w;
  }
  return width;
}

/** Pads with spaces on the right up to `width` cells (never truncates). */
export function padEndDisplay(text: string, width: number): string {
  const gap = width - displayWidth(text);
  return gap > 0 ? text + ' '.repeat(gap) : text;
}

/** Truncates to at most `max` cells, appending `ellipsis` when cut. */
export function truncate(text: string, max: number, ellipsis = '…'): string {
  if (max <= 0) return '';
  if (displayWidth(text) <= max) return text;
  const room = max - displayWidth(ellipsis);
  if (room <= 0) return ellipsis.slice(0, max);
  let out = '';
  let used = 0;
  for (const ch of text) {
    const w = displayWidth(ch);
    if (used + w > room) break;
    out += ch;
    used += w;
  }
  return out + ellipsis;
}

function codePointWidth(cp: number): number {
  if (cp === 0 || cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0xfe00 && cp <= 0xfe0e)) {
    return 0;
  }
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f680 && cp <= 0x1f6ff) ||
    (cp >= 0x1f900 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

function trimZero(s: string): string {
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
