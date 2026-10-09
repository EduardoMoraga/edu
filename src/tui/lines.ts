/**
 * Pure conversion of an agent log into styled display lines, so the focus
 * pane can show exactly the lines that fit. Long entries wrap to the pane
 * width; only collapsed thinking and tool calls are capped (with an ellipsis).
 */
import type { Glyphs, ToneToken } from '../identity/index.js';
import { displayWidth, truncate } from '../identity/index.js';
import type { LogEntry } from './state.js';
import { uiStrings, type UiStrings } from './strings.js';
import { wrapSegments } from './wrap.js';

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

export function logLines(
  entries: readonly LogEntry[],
  width: number,
  glyphs: Glyphs,
  strings: UiStrings = uiStrings('en'),
): DisplayLine[] {
  const lines: DisplayLine[] = [];
  const w = Math.max(8, width);
  // Wrapped entries hang under their glyph so the left edge stays scannable.
  const push = (line: DisplayLine, indent = 2) => lines.push(...wrapSegments(line, w, { indent, ellipsis: glyphs.ellipsis }));
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
        lines.push(...wrapSegments(toolHeader(entry, glyphs), w, { indent: 2, maxLines: TOOL_LINES, ellipsis: glyphs.ellipsis }));
        lines.push(...wrapSegments(toolResult(entry, glyphs, strings), w, { indent: 4, maxLines: TOOL_LINES, ellipsis: glyphs.ellipsis }));
        break;
      case 'approval':
        push(approvalLine(entry, glyphs, strings));
        break;
      case 'error':
        push([
          { text: `${glyphs.fail} `, tone: 'danger' },
          { text: entry.message.trim(), tone: 'danger' },
        ]);
        break;
      case 'verify':
        push([
          { text: `${entry.ok ? glyphs.ok : glyphs.fail} `, tone: entry.ok ? 'success' : 'danger', bold: true },
          { text: `${entry.kindName}${entry.checkId ? ` ${entry.checkId}` : ''}: `, bold: true },
          { text: oneLine(entry.output), dim: entry.ok },
        ]);
        break;
      case 'attribution':
        push([{ text: `attribution [${entry.failureType}]: ${oneLine(entry.observed)}`, tone: 'danger' }]);
        push([{ text: `  next: ${oneLine(entry.next)}`, dim: true }], 4);
        break;
      case 'intervention':
        push([{ text: `intervention: ${entry.action}${entry.avoidable ? ` (avoidable; ${entry.harnessGap})` : ''}${entry.detail ? ` — ${oneLine(entry.detail)}` : ''}`, dim: !entry.avoidable }]);
        break;
      case 'end':
        lines.push([]);
        push([
          { text: `${entry.ok ? glyphs.ok : glyphs.fail} `, tone: entry.ok ? 'success' : 'danger', bold: true },
          { text: entry.ok ? strings.log.done : strings.log.failed, bold: true },
          ...(entry.summary ? [{ text: ` ${glyphs.sep} ${entry.summary.trim()}`, dim: true }] : []),
        ]);
        break;
    }
  }
  return lines;
}

/** Collapsed tool calls keep at most this many lines for the call and for its result. */
export const TOOL_LINES = 2;

function toolHeader(entry: Extract<LogEntry, { kind: 'tool' }>, glyphs: Glyphs): DisplayLine {
  const input = oneLine(entry.input);
  return [
    { text: `${glyphs.arrow} `, tone: 'accent' },
    { text: entry.tool, bold: true },
    ...(input ? [{ text: ` ${input}`, dim: true }] : []),
  ];
}

function toolResult(entry: Extract<LogEntry, { kind: 'tool' }>, glyphs: Glyphs, strings: UiStrings): DisplayLine {
  if (entry.state === 'pending') return [{ text: `  ${glyphs.pending} ${strings.focus.toolRunning}`, dim: true }];
  const ok = entry.state === 'ok';
  const output = entry.output ?? '';
  const nonEmpty = output.split(/\r?\n/).filter((l) => l.trim() !== '');
  const extra = nonEmpty.length > 1 ? ` (+${nonEmpty.length - 1} lines)` : '';
  const first = nonEmpty[0]?.trim() ?? (ok ? 'ok' : 'failed');
  return [
    { text: `  ${ok ? glyphs.ok : glyphs.fail} `, tone: ok ? 'success' : 'danger' },
    { text: first, dim: ok },
    ...(extra ? [{ text: extra, dim: true }] : []),
  ];
}

function approvalLine(entry: Extract<LogEntry, { kind: 'approval' }>, glyphs: Glyphs, strings: UiStrings): DisplayLine {
  if (entry.approved === undefined) {
    return [
      { text: `${glyphs.approval} `, tone: 'accent' },
      { text: `${strings.log.approvalRequested} ${glyphs.sep} ${entry.title}`, tone: 'accent' },
    ];
  }
  const verdict = `${entry.approved ? strings.log.approvedBy : strings.log.rejectedBy} ${entry.by ?? 'user'}`;
  return [
    { text: `${entry.approved ? glyphs.ok : glyphs.fail} `, tone: entry.approved ? 'success' : 'danger' },
    { text: `${verdict} ${glyphs.sep} ${entry.title}`, dim: true },
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
