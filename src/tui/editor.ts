/**
 * Pure multi-line text editor model for the composer. The cursor is an index
 * into the text's code points, so emoji and CJK move as single characters.
 * `composerView` lays the text out into visual rows for a given width.
 */
import { displayWidth } from '../identity/index.js';

export interface EditorState {
  text: string;
  /** Cursor position in code points, 0..length. */
  cursor: number;
}

export const EMPTY_EDITOR: EditorState = { text: '', cursor: 0 };

const chars = (text: string) => [...text];

/** Normalizes line endings and drops control characters other than newlines. */
export function sanitize(input: string): string {
  return input
    .replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '');
}

export function insert(state: EditorState, input: string): EditorState {
  const add = chars(sanitize(input));
  if (!add.length) return state;
  const all = chars(state.text);
  all.splice(state.cursor, 0, ...add);
  return { text: all.join(''), cursor: state.cursor + add.length };
}

export function backspace(state: EditorState): EditorState {
  if (state.cursor === 0) return state;
  const all = chars(state.text);
  all.splice(state.cursor - 1, 1);
  return { text: all.join(''), cursor: state.cursor - 1 };
}

export function deleteForward(state: EditorState): EditorState {
  const all = chars(state.text);
  if (state.cursor >= all.length) return state;
  all.splice(state.cursor, 1);
  return { text: all.join(''), cursor: state.cursor };
}

export function moveLeft(state: EditorState): EditorState {
  return { ...state, cursor: Math.max(0, state.cursor - 1) };
}

export function moveRight(state: EditorState): EditorState {
  return { ...state, cursor: Math.min(chars(state.text).length, state.cursor + 1) };
}

/** Start of the current logical line. */
export function moveHome(state: EditorState): EditorState {
  const { lineStart } = locate(state);
  return { ...state, cursor: lineStart };
}

/** End of the current logical line. */
export function moveEnd(state: EditorState): EditorState {
  const { lineStart, line } = locate(state);
  return { ...state, cursor: lineStart + line.length };
}

/** Moves to the same column on the previous/next logical line; false at the edge. */
export function moveLine(state: EditorState, delta: -1 | 1): EditorState | undefined {
  const lines = state.text.split('\n').map(chars);
  const { row, col } = locate(state);
  const target = row + delta;
  if (target < 0 || target >= lines.length) return undefined;
  let cursor = 0;
  for (let i = 0; i < target; i++) cursor += lines[i]!.length + 1;
  return { ...state, cursor: cursor + Math.min(col, lines[target]!.length) };
}

function locate(state: EditorState): { row: number; col: number; lineStart: number; line: string[] } {
  const lines = state.text.split('\n').map(chars);
  let start = 0;
  for (let row = 0; row < lines.length; row++) {
    const line = lines[row]!;
    if (state.cursor <= start + line.length) return { row, col: state.cursor - start, lineStart: start, line };
    start += line.length + 1;
  }
  const last = lines[lines.length - 1] ?? [];
  return { row: lines.length - 1, col: last.length, lineStart: start - last.length - 1, line: last };
}

export interface ComposerRow {
  text: string;
  /** Character (code point) offset of the cursor on this row, when it sits here. */
  cursorAt?: number;
}

export interface ComposerView {
  rows: ComposerRow[];
  /** Rows hidden above/below the visible window. */
  above: number;
  below: number;
}

/**
 * Lays text out in rows of at most `width` cells, reserving one cell for the
 * cursor, and keeps a window of `maxRows` rows around the cursor.
 */
export function composerView(state: EditorState, width: number, maxRows: number): ComposerView {
  const room = Math.max(2, width) - 1;
  const rows: ComposerRow[] = [];
  let index = 0;
  let cursorRow = 0;
  for (const line of state.text.split('\n')) {
    let row = '';
    let used = 0;
    let count = 0;
    let cursorAt: number | undefined;
    const flush = () => {
      rows.push(cursorAt === undefined ? { text: row } : { text: row, cursorAt });
      if (cursorAt !== undefined) cursorRow = rows.length - 1;
      row = '';
      used = 0;
      count = 0;
      cursorAt = undefined;
    };
    for (const ch of chars(line)) {
      const cells = displayWidth(ch);
      if (used + cells > room && row) flush();
      if (index === state.cursor) cursorAt = count;
      row += ch;
      used += cells;
      count++;
      index++;
    }
    if (index === state.cursor) cursorAt = count;
    flush();
    index++; // the newline
  }
  const visible = Math.max(1, maxRows);
  const top = Math.min(Math.max(0, cursorRow - visible + 1), Math.max(0, rows.length - visible));
  return { rows: rows.slice(top, top + visible), above: top, below: Math.max(0, rows.length - top - visible) };
}

/** The subset of Ink's `Key` the editor reads. */
export interface EditKey {
  leftArrow: boolean;
  rightArrow: boolean;
  upArrow: boolean;
  downArrow: boolean;
  home: boolean;
  end: boolean;
  return: boolean;
  backspace: boolean;
  delete: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
}

export type EditResult = { kind: 'edit'; state: EditorState } | { kind: 'submit' } | { kind: 'ignored' };

/**
 * Maps one key press to an editor change. Newline: alt+enter (ESC CR, sent by
 * every terminal when Option/Alt is Meta) is the reliable chord; shift+enter
 * is only distinguishable when the terminal reports modifiers (kitty keyboard
 * protocol), so it is accepted but not advertised. Plain Enter submits.
 * ctrl+a / ctrl+e mirror home / end for keyboards without those keys.
 */
export function editKey(state: EditorState, input: string, key: EditKey): EditResult {
  const edit = (next: EditorState | undefined): EditResult => (next ? { kind: 'edit', state: next } : { kind: 'ignored' });
  if (key.return) return key.meta || key.shift ? edit(insert(state, '\n')) : { kind: 'submit' };
  if (key.backspace) return edit(backspace(state));
  if (key.delete) return edit(deleteForward(state));
  if (key.leftArrow) return edit(moveLeft(state));
  if (key.rightArrow) return edit(moveRight(state));
  if (key.home || (key.ctrl && input === 'a')) return edit(moveHome(state));
  if (key.end || (key.ctrl && input === 'e')) return edit(moveEnd(state));
  if (key.upArrow || key.downArrow) return edit(moveLine(state, key.upArrow ? -1 : 1));
  if (!input || key.ctrl || key.meta) return { kind: 'ignored' };
  return edit(insert(state, input));
}
