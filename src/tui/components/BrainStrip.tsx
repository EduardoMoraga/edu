import { Text } from 'ink';
import { formatPercent, formatTokens, truncate } from '../../identity/index.js';
import type { BrainActivity } from '../state.js';
import { Tx, useUi } from './ui.js';

export interface ContextUsage {
  usedTokens: number;
  budgetTokens: number;
}

export interface BrainStripProps {
  brain: BrainActivity;
  context?: ContextUsage;
  width: number;
}

/** Live second-brain activity: `🧠 recalled 4 · learned 1 lesson · ctx 41% of 8k`. */
export function BrainStrip({ brain, context: override, width }: BrainStripProps) {
  const { glyphs } = useUi();
  // An explicit prop wins; otherwise use the latest `context.usage` event folded into state.
  const context = override ?? brain.context;
  const sep = ` ${glyphs.sep} `;
  const parts = [`recalled ${brain.recalledIds.length}`, learnedLabel(brain)];
  if (context && context.budgetTokens > 0) {
    parts.push(`ctx ${formatPercent(context.usedTokens / context.budgetTokens)} of ${formatTokens(context.budgetTokens)}`);
  }
  const summary = parts.join(sep);
  const latest = brain.learnings.at(-1);
  const room = width - summary.length - 6 - glyphs.brain.length;
  const quote = latest && room > 12 ? `${sep}${truncate(latest.title, room, glyphs.ellipsis)}` : '';
  return (
    <Text wrap="truncate-end">
      <Tx tone="accent">{`${glyphs.brain} `}</Tx>
      <Tx tone="muted">{summary}</Tx>
      {quote ? <Tx dim italic>{quote}</Tx> : null}
    </Text>
  );
}

function learnedLabel(brain: BrainActivity): string {
  const n = brain.learnings.length;
  if (n === 0) return 'nothing learned yet';
  const kinds = new Set(brain.learnings.map((l) => l.kind));
  if (kinds.size === 1) {
    const kind = brain.learnings[0]!.kind;
    const noun = kind === 'canonical-proposal' ? 'proposal' : kind;
    return `learned ${n} ${noun}${n === 1 ? '' : 's'}`;
  }
  return `learned ${n} notes`;
}
