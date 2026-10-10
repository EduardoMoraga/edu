/**
 * Exact-width line primitives for mission control. Every block (cards,
 * panels, deck, bus) is built as DisplayLines of a known width, so columns
 * can be joined side by side without Ink layout guesswork.
 */
import { displayWidth, type Glyphs, type ToneToken } from '../../identity/index.js';
import type { DisplayLine, Segment } from '../lines.js';

export function lineWidth(line: DisplayLine): number {
  return line.reduce((w, s) => w + displayWidth(s.text), 0);
}

/** Truncates (with an ellipsis) or pads a line to exactly `width` cells. */
export function fitLine(line: DisplayLine, width: number, ellipsis = '…'): DisplayLine {
  if (width <= 0) return [];
  const total = lineWidth(line);
  if (total <= width) return total === width ? line : [...line, { text: ' '.repeat(width - total) }];
  const out: Segment[] = [];
  let used = 0;
  const room = width - displayWidth(ellipsis);
  for (const seg of line) {
    const w = displayWidth(seg.text);
    if (used + w <= room) {
      out.push(seg);
      used += w;
      continue;
    }
    const cut = `${sliceWidth(seg.text, Math.max(0, room - used))}${ellipsis}`;
    out.push({ ...seg, text: cut });
    used += displayWidth(cut);
    break;
  }
  if (used < width) out.push({ text: ' '.repeat(width - used) });
  return out;
}

/** Joins equally tall columns into rows, padding short columns with blanks. */
export function joinColumns(columns: Array<{ lines: DisplayLine[]; width: number }>, gap = 1): DisplayLine[] {
  const height = Math.max(0, ...columns.map((c) => c.lines.length));
  const rows: DisplayLine[] = [];
  for (let r = 0; r < height; r++) {
    const row: Segment[] = [];
    columns.forEach((c, i) => {
      if (i > 0 && gap > 0) row.push({ text: ' '.repeat(gap) });
      row.push(...fitLine(c.lines[r] ?? [], c.width));
    });
    rows.push(row);
  }
  return rows;
}

export interface PanelOptions {
  width: number;
  /** Total height including the frame; content is clipped or padded to fit. */
  height?: number;
  title?: string;
  /** Right-aligned note in the top edge (e.g. a count). */
  note?: string;
  tone?: ToneToken;
  titleTone?: ToneToken;
}

/** A hand-drawn rounded panel with a title in its top edge. */
export function panel(content: DisplayLine[], glyphs: Glyphs, opts: PanelOptions): DisplayLine[] {
  const { box } = glyphs.mission;
  const inner = Math.max(1, opts.width - 4);
  const tone = opts.tone ?? 'border';
  const title = opts.title ? ` ${opts.title} ` : '';
  const note = opts.note ? ` ${opts.note} ` : '';
  const fill = Math.max(0, opts.width - 2 - 1 - displayWidth(title) - displayWidth(note) - 1);
  const top: DisplayLine = [
    { text: `${box.tl}${box.h}`, tone },
    ...(title ? [{ text: title, tone: opts.titleTone ?? 'muted', bold: true }] : []),
    { text: box.h.repeat(fill), tone },
    ...(note ? [{ text: note, tone: 'muted' as const }] : []),
    { text: `${box.h}${box.tr}`, tone },
  ];
  const rows = opts.height !== undefined ? Math.max(0, opts.height - 2) : content.length;
  const body: DisplayLine[] = [];
  for (let i = 0; i < rows; i++) {
    body.push([{ text: `${box.v} `, tone }, ...fitLine(content[i] ?? [], inner, glyphs.ellipsis), { text: ` ${box.v}`, tone }]);
  }
  const bottom: DisplayLine = [{ text: `${box.bl}${box.h.repeat(Math.max(0, opts.width - 2))}${box.br}`, tone }];
  return [fitLine(top, opts.width), ...body, bottom];
}

/** `━━━━━───` progress bar of `width` cells. */
export function bar(ratio: number, width: number, glyphs: Glyphs, tone: ToneToken = 'peach'): Segment[] {
  const filled = Math.round(clamp01(ratio) * width);
  return [
    { text: glyphs.mission.bar.full.repeat(filled), tone },
    { text: glyphs.mission.bar.empty.repeat(width - filled), tone: 'border' },
  ];
}

/** `▰▰▰▱▱` meter; turns amber past 70% and red past 90%. */
export function meter(ratio: number, width: number, glyphs: Glyphs): Segment[] {
  const r = clamp01(ratio);
  const filled = Math.round(r * width);
  const tone: ToneToken = r >= 0.9 ? 'danger' : r >= 0.7 ? 'accent' : 'success';
  return [
    { text: glyphs.mission.meter.full.repeat(filled), tone },
    { text: glyphs.mission.meter.empty.repeat(width - filled), tone: 'border' },
  ];
}

/** The longest prefix of `text` that fits in `width` cells. */
export function sliceWidth(text: string, width: number): string {
  let out = '';
  let used = 0;
  for (const ch of text) {
    const w = displayWidth(ch);
    if (used + w > width) break;
    out += ch;
    used += w;
  }
  return out;
}

export function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

/** `0:13`, `2:14`, `1:02:09` — compact clock for elapsed time. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** `mm:ss.mmm` offset from the run start. */
export function stamp(ms: number): string {
  const v = Math.max(0, Math.floor(Number.isFinite(ms) ? ms : 0));
  const m = Math.floor(v / 60_000);
  const s = Math.floor((v % 60_000) / 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(v % 1000).padStart(3, '0')}`;
}
