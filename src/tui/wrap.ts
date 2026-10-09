/**
 * Word-aware wrapping of styled segments by terminal cell width. Words that
 * span several segments (`[y]` + `approve`) stay together, words wider than
 * the line are hard-split, and CJK/emoji count as two cells (displayWidth).
 */
import { displayWidth } from '../identity/index.js';
import type { DisplayLine, Segment } from './lines.js';

export interface WrapOptions {
  /** Spaces prefixed to continuation lines (hanging indent). */
  indent?: number;
  /** Line cap; the last kept line ends with `ellipsis` when more text was cut. */
  maxLines?: number;
  ellipsis?: string;
}

type Style = Omit<Segment, 'text'>;
interface Piece {
  text: string;
  style: Style;
}
type Item = { kind: 'word'; pieces: Piece[]; width: number } | { kind: 'space'; piece: Piece } | { kind: 'break' };

/** Wraps one styled line into as many lines as `width` needs. Never returns an empty array. */
export function wrapSegments(line: DisplayLine, width: number, opts: WrapOptions = {}): DisplayLine[] {
  const w = Math.max(1, Math.floor(width));
  const indent = Math.min(Math.max(0, opts.indent ?? 0), Math.floor(w / 2));
  const out: DisplayLine[] = [];
  let current: Piece[] = [];
  let used = 0;
  let fresh = true; // nothing but indentation on the current line yet
  let first = true;

  const room = () => w - used;
  const newLine = () => {
    out.push(toLine(current));
    current = indent > 0 ? [{ text: ' '.repeat(indent), style: {} }] : [];
    used = indent;
    fresh = true;
    first = false;
  };
  const put = (piece: Piece, cells: number) => {
    current.push(piece);
    used += cells;
    fresh = false;
  };

  for (const item of tokenize(line)) {
    if (item.kind === 'break') {
      newLine();
      continue;
    }
    if (item.kind === 'space') {
      // Leading spaces survive only on the first line (they are deliberate indentation there).
      if (fresh && !first) continue;
      const cells = displayWidth(item.piece.text);
      if (cells <= room()) put(item.piece, cells);
      else newLine();
      continue;
    }
    if (item.width > room() && !fresh) {
      trimTrailingSpace(current, (cells) => (used -= cells));
      newLine();
    }
    if (item.width <= room()) {
      for (const p of item.pieces) put(p, displayWidth(p.text));
      continue;
    }
    // Hard split a word that cannot fit on a line of its own.
    for (const p of item.pieces) {
      for (const ch of p.text) {
        const cells = displayWidth(ch);
        if (cells > room() && !fresh) newLine();
        put({ text: ch, style: p.style }, cells);
      }
    }
  }
  out.push(toLine(current));
  return cap(out, w, opts);
}

/** Plain-text convenience over wrapSegments. */
export function wrapPlain(text: string, width: number, opts: WrapOptions = {}): string[] {
  return wrapSegments([{ text }], width, opts).map((l) => l.map((s) => s.text).join(''));
}

function tokenize(line: DisplayLine): Item[] {
  const items: Item[] = [];
  let word: Piece[] = [];
  let wordWidth = 0;
  const flush = () => {
    if (word.length) items.push({ kind: 'word', pieces: word, width: wordWidth });
    word = [];
    wordWidth = 0;
  };
  for (const segment of line) {
    const { text, ...style } = segment;
    for (const part of text.replace(/\r\n?/g, '\n').replace(/\t/g, '  ').split(/(\n| +)/)) {
      if (!part) continue;
      if (part === '\n') {
        flush();
        items.push({ kind: 'break' });
      } else if (part.startsWith(' ')) {
        flush();
        items.push({ kind: 'space', piece: { text: part, style } });
      } else {
        word.push({ text: part, style });
        wordWidth += displayWidth(part);
      }
    }
  }
  flush();
  return items;
}

function trimTrailingSpace(pieces: Piece[], release: (cells: number) => void): void {
  while (pieces.length && /^ +$/.test(pieces[pieces.length - 1]!.text)) release(displayWidth(pieces.pop()!.text));
}

function toLine(pieces: Piece[]): DisplayLine {
  const merged: DisplayLine = [];
  for (const { text, style } of pieces) {
    const last = merged[merged.length - 1];
    if (last && sameStyle(last, style)) last.text += text;
    else merged.push({ text, ...style });
  }
  // Trailing spaces would only push the line past its box.
  const tail = merged[merged.length - 1];
  if (tail) {
    tail.text = tail.text.replace(/ +$/, '');
    if (!tail.text && merged.length > 1) merged.pop();
  }
  return merged.filter((s) => s.text !== '' || merged.length === 1);
}

function sameStyle(a: Segment, b: Style): boolean {
  return a.tone === b.tone && a.bold === b.bold && a.dim === b.dim && a.italic === b.italic;
}

function cap(lines: DisplayLine[], width: number, opts: WrapOptions): DisplayLine[] {
  const max = opts.maxLines;
  if (max === undefined || lines.length <= max) return lines;
  const kept = lines.slice(0, Math.max(1, max));
  const ellipsis = opts.ellipsis ?? '…';
  const last = kept[kept.length - 1]!;
  const budget = width - displayWidth(ellipsis);
  const clipped: DisplayLine = [];
  let used = 0;
  for (const s of last) {
    let text = '';
    for (const ch of s.text) {
      const cells = displayWidth(ch);
      if (used + cells > budget) break;
      text += ch;
      used += cells;
    }
    if (text) clipped.push({ ...s, text });
    if (text.length < s.text.length) break;
  }
  const tail = clipped[clipped.length - 1];
  clipped.push({ ...(tail ? { ...tail, text: '' } : {}), text: ellipsis });
  kept[kept.length - 1] = clipped;
  return kept;
}
