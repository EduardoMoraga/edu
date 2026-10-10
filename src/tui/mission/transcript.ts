/**
 * The conversation view: the home chat as a transcript, newest at the bottom.
 *
 *   › you  hola                                   12:03
 *
 *   ◆ edu  12:03
 *     ¡Hola! Tienes dos compromisos abiertos…
 *     ↺ C-entregar-informe · D-usar-bun
 *
 * Pure; the stage panel windows and frames these lines.
 */
import { displayWidth, truncate, type Glyphs } from '../../identity/index.js';
import type { ChatTurn } from '../chat.js';
import { wrapText, type DisplayLine, type Segment } from '../lines.js';
import { wrapSegments } from '../wrap.js';
import { fitLine } from './cells.js';

export interface TranscriptInput {
  turns: readonly ChatTurn[];
  width: number;
  glyphs: Glyphs;
  /** Edu is working on an answer to the last user turn. */
  waiting?: boolean;
  /** Shown while the conversation is empty. */
  empty?: string;
}

/** When the full ids do not fit, each is cut to this many cells before the line is. */
const ID_CELLS = 22;
const INDENT = '  ';

export function transcriptLines(input: TranscriptInput): DisplayLine[] {
  const { turns, glyphs } = input;
  const w = Math.max(8, input.width);
  const out: DisplayLine[] = [];
  if (turns.length === 0 && !input.waiting) {
    return input.empty ? [[{ text: input.empty, dim: true }]] : [];
  }
  for (const turn of turns) {
    if (out.length) out.push([]);
    if (turn.role === 'user') out.push(...userLines(turn, w, glyphs));
    else out.push(...eduLines(turn, w, glyphs));
  }
  if (input.waiting && turns.at(-1)?.role !== 'edu') {
    if (out.length) out.push([]);
    out.push([...eduHead(glyphs), { text: `  ${glyphs.ellipsis}`, dim: true }]);
  }
  return out;
}

/** Local wall-clock `HH:MM` of an event time. */
export function timeOfDay(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function userLines(turn: Extract<ChatTurn, { role: 'user' }>, w: number, glyphs: Glyphs): DisplayLine[] {
  return wrapSegments(
    [
      { text: `${glyphs.arrow} you`, tone: 'accent', bold: true },
      { text: '  ' },
      { text: turn.text.replace(/\s*\n\s*/g, ' ') },
      { text: `  ${timeOfDay(turn.at)}`, tone: 'muted', dim: true },
    ],
    w,
    { indent: 2, ellipsis: glyphs.ellipsis },
  );
}

function eduHead(glyphs: Glyphs): DisplayLine {
  return [{ text: `${glyphs.roles.lead} edu`, tone: 'peach', bold: true }];
}

function eduLines(turn: Extract<ChatTurn, { role: 'edu' }>, w: number, glyphs: Glyphs): DisplayLine[] {
  const lines: DisplayLine[] = [[...eduHead(glyphs), { text: `  ${timeOfDay(turn.at)}`, tone: 'muted', dim: true }]];
  // Paragraph by paragraph so Markdown emphasis renders as styling instead of raw `**` and backticks.
  for (const paragraph of turn.text.trim() ? turn.text.trim().split('\n') : []) {
    if (!paragraph.trim()) { lines.push([{ text: '' }]); continue; }
    lines.push(...wrapSegments([{ text: INDENT }, ...inlineMarkdown(paragraph)], w, { indent: INDENT.length }));
  }
  if (turn.ok === false && turn.error) {
    lines.push(...wrapSegments([{ text: `${INDENT}${glyphs.fail} `, tone: 'danger' }, { text: turn.error.trim(), tone: 'danger' }], w, { indent: 4, maxLines: 3, ellipsis: glyphs.ellipsis }));
  }
  if (turn.recalled.length) {
    const recalled = (cut: boolean) =>
      `${INDENT}${glyphs.unicode ? '↺' : '<'} ${turn.recalled.map((id) => (cut ? truncate(id, ID_CELLS, glyphs.ellipsis) : id)).join(` ${glyphs.sep} `)}`;
    const full = recalled(false);
    lines.push(fitLine([{ text: displayWidth(full) <= w ? full : recalled(true), tone: 'muted', dim: true }], w, glyphs.ellipsis));
  }
  return lines;
}

/** `**bold**` → bold, `` `code` `` and `[[note-id]]` → accent; everything else plain. */
export function inlineMarkdown(text: string): Segment[] {
  const out: Segment[] = [];
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`|\[\[([^\]]+)\]\]/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) out.push({ text: text.slice(last, match.index) });
    if (match[1] !== undefined) out.push({ text: match[1], bold: true });
    else if (match[2] !== undefined) out.push({ text: match[2], tone: 'accent' });
    else out.push({ text: match[3]!, tone: 'accent', dim: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
