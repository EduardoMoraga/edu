import { Box } from 'ink';
import { formatPercent, formatTokens, type Glyphs } from '../../identity/index.js';
import type { DisplayLine } from '../lines.js';
import type { BrainActivity } from '../state.js';
import { fill, uiStrings, type UiStrings } from '../strings.js';
import { wrapSegments } from '../wrap.js';
import { Line, useUi } from './ui.js';

export interface ContextUsage {
  usedTokens: number;
  budgetTokens: number;
}

export interface BrainStripProps {
  brain: BrainActivity;
  context?: ContextUsage;
  width: number;
}

/** The strip never takes more than this many lines. */
export const BRAIN_LINES = 2;

/** `🧠 recalled 4 · learned 1 lesson · ctx 41% of 8k · <latest learning>`, wrapped to `width`. */
export function brainLines(
  brain: BrainActivity,
  override: ContextUsage | undefined,
  width: number,
  glyphs: Glyphs,
  strings: UiStrings = uiStrings('en'),
): DisplayLine[] {
  // An explicit prop wins; otherwise use the latest `context.usage` event folded into state.
  const context = override ?? brain.context;
  const sep = ` ${glyphs.sep} `;
  const parts = [`${strings.brain.recalled} ${brain.recalledIds.length}`, learnedLabel(brain, strings)];
  if (context && context.budgetTokens > 0) {
    parts.push(fill(strings.brain.ctx, { pct: formatPercent(context.usedTokens / context.budgetTokens), budget: formatTokens(context.budgetTokens) }));
  }
  const latest = brain.learnings.at(-1);
  const line: DisplayLine = [
    { text: `${glyphs.brain} `, tone: 'accent' },
    { text: parts.join(sep), tone: 'muted' },
    ...(latest ? [{ text: `${sep}${latest.title}`, dim: true, italic: true }] : []),
  ];
  return wrapSegments(line, width, { indent: 3, maxLines: BRAIN_LINES, ellipsis: glyphs.ellipsis });
}

/** Live second-brain activity, wrapped instead of cut. */
export function BrainStrip({ brain, context, width }: BrainStripProps) {
  const { glyphs, strings } = useUi();
  return (
    <Box flexDirection="column" width={width}>
      {brainLines(brain, context, width, glyphs, strings).map((line, i) => (
        <Line key={i} line={line} />
      ))}
    </Box>
  );
}

function learnedLabel(brain: BrainActivity, strings: UiStrings): string {
  const n = brain.learnings.length;
  if (n === 0) return strings.brain.nothing;
  const kinds = new Set(brain.learnings.map((l) => l.kind));
  if (kinds.size === 1 && strings.lang === 'en') {
    const kind = brain.learnings[0]!.kind;
    const noun = kind === 'canonical-proposal' ? 'proposal' : kind;
    return `${strings.brain.learned} ${n} ${noun}${n === 1 ? '' : 's'}`;
  }
  if (kinds.size === 1) return `${strings.brain.learned} ${n} ${brain.learnings[0]!.kind}`;
  return `${strings.brain.learned} ${n} ${strings.brain.notes}`;
}
