import { describe, expect, it } from 'vitest';
import { ASCII_GLYPHS, UNICODE_GLYPHS } from '../identity/index.js';
import { computeLayout, focusLogHeight } from './layout.js';
import { THINKING_LINES, logLines, wrapText } from './lines.js';

const plain = (line: { text: string }[]) => line.map((s) => s.text).join('');

describe('wrapText', () => {
  it('wraps on words and keeps explicit newlines', () => {
    expect(wrapText('the quick brown fox', 9)).toEqual(['the quick', 'brown fox']);
    expect(wrapText('a\nb', 10)).toEqual(['a', 'b']);
  });
  it('hard-splits words longer than the width', () => {
    expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });
  it('drops trailing empty lines but keeps a single empty line for empty text', () => {
    expect(wrapText('hi\n\n', 10)).toEqual(['hi']);
    expect(wrapText('', 10)).toEqual(['']);
  });
});

describe('logLines', () => {
  it('renders verification outcomes and attribution/intervention details', () => {
    const lines = logLines([
      { kind: 'verify', ok: true, kindName: 'deterministic', checkId: 'C1', output: 'passed' },
      { kind: 'verify', ok: false, kindName: 'targeted-test', output: 'failed' },
      { kind: 'attribution', observed: 'test failed', failureType: 'verify', next: 'inspect fixture' },
      { kind: 'intervention', action: 'clarified', detail: 'provided a path', avoidable: true, harnessGap: 'context' },
    ], 80, UNICODE_GLYPHS).map(plain);
    expect(lines.join('\n')).toContain('✓ deterministic C1: passed');
    expect(lines.join('\n')).toContain('✗ targeted-test: failed');
    expect(lines.join('\n')).toContain('attribution [verify]: test failed');
    expect(lines.join('\n')).toContain('intervention: clarified (avoidable; context)');
  });
  it('collapses tool calls into a header and a one-line result', () => {
    const lines = logLines(
      [
        { kind: 'tool', callId: 'c1', tool: 'Edit', input: 'src/auth.ts', state: 'ok', output: '12 lines\nmore\nmore' },
        { kind: 'tool', callId: 'c2', tool: 'Bash', input: 'npm test', state: 'failed', output: '1 failing' },
        { kind: 'tool', callId: 'c3', tool: 'Read', input: 'x', state: 'pending' },
      ],
      40,
      UNICODE_GLYPHS,
    ).map(plain);
    expect(lines).toEqual([
      '› Edit src/auth.ts',
      '  ✓ 12 lines (+2 lines)',
      '› Bash npm test',
      '  ✗ 1 failing',
      '› Read x',
      '  … running',
    ]);
  });
  it('dims and collapses thinking', () => {
    const long = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
    const lines = logLines([{ kind: 'thinking', text: long }], 30, UNICODE_GLYPHS);
    expect(lines).toHaveLength(THINKING_LINES);
    expect(lines.every((l) => l.every((s) => s.dim && s.italic))).toBe(true);
    expect(plain(lines[0]!).startsWith('∴ ')).toBe(true);
    expect(plain(lines.at(-1)!).endsWith('…')).toBe(true);
  });
  it('renders approvals, errors and the end summary', () => {
    const lines = logLines(
      [
        { kind: 'approval', title: 'write 3 files' },
        { kind: 'approval', title: 'write 3 files', approved: false, by: 'policy' },
        { kind: 'error', message: 'boom' },
        { kind: 'end', ok: true, summary: 'shipped' },
      ],
      60,
      ASCII_GLYPHS,
    ).map(plain);
    expect(lines).toEqual([
      '! approval requested - write 3 files',
      'x rejected by policy - write 3 files',
      'x boom',
      '',
      '+ done - shipped',
    ]);
  });
  it('never exceeds the width', () => {
    const lines = logLines(
      [
        { kind: 'text', text: 'x'.repeat(200) },
        { kind: 'tool', callId: 'c', tool: 'Grep', input: 'y'.repeat(200), state: 'ok', output: 'z'.repeat(200) },
      ],
      30,
      UNICODE_GLYPHS,
    );
    for (const l of lines) expect(plain(l).length).toBeLessThanOrEqual(30);
  });
});

describe('layout', () => {
  it('picks a mode by width', () => {
    expect(computeLayout(120, 40).mode).toBe('wide');
    expect(computeLayout(100, 40).mode).toBe('wide');
    expect(computeLayout(99, 40).mode).toBe('medium');
    expect(computeLayout(80, 40).mode).toBe('medium');
    expect(computeLayout(79, 40).mode).toBe('narrow');
  });
  it('clamps tiny or missing sizes', () => {
    const l = computeLayout(0, 0);
    expect(l.columns).toBe(40);
    expect(l.rows).toBe(12);
    expect(l.focusWidth).toBe(36);
  });
  it('splits widths so both columns fit inside the frame', () => {
    const l = computeLayout(120, 40);
    expect(l.treeWidth + 2 + l.focusWidth).toBe(l.inner);
    expect(l.inner).toBe(116);
  });
  it('leaves at least three log lines', () => {
    expect(focusLogHeight(computeLayout(60, 12), { approvalLines: 4, treeRows: 6 })).toBe(3);
    expect(focusLogHeight(computeLayout(120, 40), { approvalLines: 0, treeRows: 6 })).toBe(32);
  });
});
