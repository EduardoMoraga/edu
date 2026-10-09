/**
 * Pure conversion of an agent log into styled display lines, so the focus
 * pane can show exactly the newest lines that fit (Ink clips from the top).
 */
import type { Glyphs, ToneToken } from '../identity/index.js';
import { displayWidth, truncate } from '../identity/index.js';
import type { LogEntry } from './state.js';

export interface Segment {
  text: string;
  tone?: ToneToken;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
}

export type DisplayLine = Segment[];

/** Max lines a thinking block occupies before it is collapsed. */
export const THINKING_LINES = 2;

/** Word wrap by display width; hard-splits words longer than the width. */
export function wrapText(text: string, width: number): string[] {
  const w = Math.max(1, width);
  const out: string[] = [];
  for (const paragraph of text.replace(/\t/g, '  ').split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (displayWidth(candidate) <= w) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      line = '';
      let rest = word;
      while (displayWidth(rest) > w) {
        const [head, tail] = splitAt(rest, w);
        out.push(head);
        rest = tail;
      }
      line = rest;
    }
    out.push(line);
  }
  while (out.length > 1 && out[out.length - 1] === '') out.pop();
  return out;
}

export function logLines(entries: readonly LogEntry[], width: number, glyphs: Glyphs): DisplayLine[] {
  const lines: DisplayLine[] = [];
  const w = Math.max(8, width);
  for (const entry of entries) {
    switch (entry.kind) {
      case 'text':
        for (const l of wrapText(entry.text.trim(), w)) lines.push([{ text: l }]);
        break;
      case 'thinking': {
        const wrapped = wrapText(entry.text.trim(), w - 2);
        const shown = wrapped.slice(0, THINKING_LINES);
        if (wrapped.length > THINKING_LINES) {
          const last = shown.length - 1;
          shown[last] = truncate(`${shown[last]} `, w - 2 - displayWidth(glyphs.ellipsis), '') + glyphs.ellipsis;
        }
        shown.forEach((l, i) =>
          lines.push([{ text: `${i === 0 ? glyphs.thinking : ' '} ${l}`, dim: true, italic: true }]),
        );
        break;
      }
      case 'tool':
        lines.push(toolHeader(entry, w, glyphs));
        lines.push(toolResult(entry, w, glyphs));
        break;
      case 'approval':
        lines.push(approvalLine(entry, w, glyphs));
        break;
      case 'error':
        lines.push([
          { text: `${glyphs.fail} `, tone: 'danger' },
          { text: truncate(entry.message, w - 2, glyphs.ellipsis), tone: 'danger' },
        ]);
        break;
      case 'end':
        lines.push([]);
        lines.push([
          { text: `${entry.ok ? glyphs.ok : glyphs.fail} `, tone: entry.ok ? 'success' : 'danger', bold: true },
          { text: entry.ok ? 'done' : 'failed', bold: true },
          ...(entry.summary ? [{ text: ` ${glyphs.sep} ${truncate(entry.summary, w - 10, glyphs.ellipsis)}`, dim: true }] : []),
        ]);
        break;
    }
  }
  return lines;
}

function toolHeader(entry: Extract<LogEntry, { kind: 'tool' }>, w: number, glyphs: Glyphs): DisplayLine {
  const head = `${glyphs.arrow} ${entry.tool}`;
  const input = oneLine(entry.input);
  const room = w - displayWidth(head) - 1;
  return [
    { text: `${glyphs.arrow} `, tone: 'accent' },
    { text: entry.tool, bold: true },
    ...(input && room > 3 ? [{ text: ` ${truncate(input, room, glyphs.ellipsis)}`, dim: true }] : []),
  ];
}

function toolResult(entry: Extract<LogEntry, { kind: 'tool' }>, w: number, glyphs: Glyphs): DisplayLine {
  if (entry.state === 'pending') return [{ text: `  ${glyphs.pending} running`, dim: true }];
  const ok = entry.state === 'ok';
  const output = entry.output ?? '';
  const nonEmpty = output.split(/\r?\n/).filter((l) => l.trim() !== '');
  const extra = nonEmpty.length > 1 ? ` (+${nonEmpty.length - 1} lines)` : '';
  const first = nonEmpty[0]?.trim() ?? (ok ? 'ok' : 'failed');
  const room = w - 4 - extra.length;
  return [
    { text: `  ${ok ? glyphs.ok : glyphs.fail} `, tone: ok ? 'success' : 'danger' },
    { text: truncate(first, Math.max(4, room), glyphs.ellipsis), dim: ok },
    ...(extra ? [{ text: extra, dim: true }] : []),
  ];
}

function approvalLine(entry: Extract<LogEntry, { kind: 'approval' }>, w: number, glyphs: Glyphs): DisplayLine {
  if (entry.approved === undefined) {
    return [
      { text: `${glyphs.approval} `, tone: 'accent' },
      { text: truncate(`approval requested ${glyphs.sep} ${entry.title}`, w - 2, glyphs.ellipsis), tone: 'accent' },
    ];
  }
  const verdict = `${entry.approved ? 'approved' : 'rejected'} by ${entry.by ?? 'user'}`;
  return [
    { text: `${entry.approved ? glyphs.ok : glyphs.fail} `, tone: entry.approved ? 'success' : 'danger' },
    { text: truncate(`${verdict} ${glyphs.sep} ${entry.title}`, w - 2, glyphs.ellipsis), dim: true },
  ];
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function splitAt(word: string, width: number): [string, string] {
  let head = '';
  let used = 0;
  const chars = [...word];
  let i = 0;
  for (; i < chars.length; i++) {
    const cw = displayWidth(chars[i] ?? '');
    if (used + cw > width && head) break;
    head += chars[i];
    used += cw;
  }
  return [head, chars.slice(i).join('')];
}
