import { describe, expect, it } from 'vitest';
import {
  EMPTY_EDITOR,
  backspace,
  composerView,
  deleteForward,
  insert,
  moveEnd,
  moveHome,
  moveLeft,
  moveLine,
  moveRight,
  type EditorState,
} from './editor.js';

const type = (s: string, state: EditorState = EMPTY_EDITOR) => insert(state, s);

describe('editor model', () => {
  it('inserts at the cursor and moves left/right by code point', () => {
    let s = type('héllo 🚀');
    expect(s).toEqual({ text: 'héllo 🚀', cursor: 7 });
    s = moveLeft(moveLeft(s));
    s = insert(s, 'X');
    expect(s.text).toBe('hélloX 🚀');
    s = moveRight(moveRight(moveRight(s)));
    expect(s.cursor).toBe(8);
  });

  it('backspace and forward delete edit around the cursor', () => {
    let s = moveLeft(type('abc'));
    expect(backspace(s)).toEqual({ text: 'ac', cursor: 1 });
    expect(deleteForward(s)).toEqual({ text: 'ab', cursor: 2 });
    s = { text: 'abc', cursor: 0 };
    expect(backspace(s)).toBe(s);
  });

  it('home/end work on the current logical line', () => {
    const s = { text: 'first\nsecond line', cursor: 9 };
    expect(moveHome(s).cursor).toBe(6);
    expect(moveEnd(s).cursor).toBe(17);
  });

  it('moves between lines keeping the column', () => {
    const s = { text: 'abcdef\nxy\nlonger', cursor: 4 };
    expect(moveLine(s, 1)!.cursor).toBe(9); // clamped to end of "xy"
    expect(moveLine(s, -1)).toBeUndefined();
  });

  it('normalizes pasted chunks: CRLF to newline, strips escapes and control chars', () => {
    expect(type('one\r\ntwo\rthree\u0007\u001B[31m!').text).toBe('one\ntwo\nthree!');
  });
});

describe('composerView', () => {
  it('wraps long input into rows and places the cursor', () => {
    const view = composerView({ text: 'abcdefghij', cursor: 10 }, 5, 5);
    expect(view.rows.map((r) => r.text)).toEqual(['abcd', 'efgh', 'ij']);
    expect(view.rows[2]!.cursorAt).toBe(2);
  });

  it('shows explicit lines and scrolls to keep the cursor visible past the row cap', () => {
    const text = ['1', '2', '3', '4', '5', '6', '7'].join('\n');
    const end = composerView({ text, cursor: text.length }, 20, 5);
    expect(end.rows.map((r) => r.text)).toEqual(['3', '4', '5', '6', '7']);
    expect(end.above).toBe(2);
    const start = composerView({ text, cursor: 0 }, 20, 5);
    expect(start.rows[0]).toEqual({ text: '1', cursorAt: 0 });
    expect(start.below).toBe(2);
  });
});
