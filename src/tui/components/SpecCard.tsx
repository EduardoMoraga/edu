import { Box } from 'ink';
import { displayWidth, type Glyphs } from '../../identity/index.js';
import type { DisplayLine } from '../lines.js';
import type { SpecView } from '../state.js';
import { wrapSegments } from '../wrap.js';
import { Line, useUi } from './ui.js';

/** The spec card never takes more than this many lines. */
export const SPEC_LINES = 2;

/**
 * The plan the lead wrote, before anyone builds: requirement, check and step
 * counts plus the spec file to review. One line when it fits; otherwise the
 * path drops to its own line, truncated from the start so the filename stays.
 */
export function specLines(spec: SpecView, width: number, glyphs: Glyphs): DisplayLine[] {
  const w = Math.max(1, Math.floor(width));
  const sep = ` ${glyphs.sep} `;
  const counts = [
    plural(spec.requirements, 'requirement'),
    plural(spec.checks, 'check'),
    ...(spec.steps !== undefined ? [plural(spec.steps, 'step')] : []),
  ].join(sep);
  const head: DisplayLine = [
    { text: `${glyphs.unicode ? '≡' : '='} spec  `, tone: 'accent', bold: true },
    { text: counts, tone: spec.checks === 0 ? 'danger' : undefined },
  ];
  const headWidth = displayWidth(head.map((s) => s.text).join(''));
  if (headWidth + 2 + displayWidth(spec.path) <= w) {
    return [[...head, { text: `  ${spec.path}`, tone: 'muted' }]];
  }
  const first = wrapSegments(head, w, { maxLines: 1, ellipsis: glyphs.ellipsis });
  const path: DisplayLine = [{ text: `  ${truncateStart(spec.path, w - 2, glyphs.ellipsis)}`, tone: 'muted' }];
  return [...first, path].slice(0, SPEC_LINES);
}

export function SpecCard({ spec, width }: { spec: SpecView; width: number }) {
  const { glyphs } = useUi();
  return (
    <Box flexDirection="column">
      {specLines(spec, width, glyphs).map((l, i) => (
        <Line key={i} line={l} />
      ))}
    </Box>
  );
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** Keeps the tail of `text` within `width` cells, prefixing the ellipsis when cut. */
function truncateStart(text: string, width: number, ellipsis: string): string {
  if (displayWidth(text) <= width) return text;
  const room = Math.max(0, width - displayWidth(ellipsis));
  const chars = Array.from(text);
  let tail = '';
  for (let i = chars.length - 1; i >= 0; i--) {
    const next = chars[i] + tail;
    if (displayWidth(next) > room) break;
    tail = next;
  }
  return ellipsis + tail;
}
