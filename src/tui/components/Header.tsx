import { Box, Text } from 'ink';
import { displayWidth, formatCost, formatDuration, formatTokens, type Glyphs } from '../../identity/index.js';
import type { Layout } from '../layout.js';
import { runClis, runTotals } from '../selectors.js';
import type { TuiState } from '../state.js';
import type { UiStrings } from '../strings.js';
import { wrapPlain } from '../wrap.js';
import { Tx, useUi } from './ui.js';

/** A goal never takes more than this many header lines. */
export const GOAL_LINES = 3;

export interface HeaderModel {
  mark: string;
  status?: { text: string; tone: 'success' | 'danger' | 'accent' };
  metaLine: string;
  money: string;
  /** Goal on the first line when it fits beside the totals. */
  inlineGoal?: string;
  /** Otherwise the goal, wrapped below the first line. */
  goalLines: string[];
  height: number;
}

export interface HeaderInput {
  state: TuiState;
  layout: Layout;
  name: string;
  now?: number;
  cancelling?: boolean;
  glyphs: Glyphs;
  strings: UiStrings;
}

/** Pure header layout so App can budget its height before rendering. */
export function headerModel({ state, layout, name, now, cancelling, glyphs, strings }: HeaderInput): HeaderModel {
  const totals = runTotals(state);
  const sep = ` ${glyphs.sep} `;
  const mark = `${glyphs.roles.lead} ${name.toUpperCase()}`;
  const clis = runClis(state);
  const meta = [state.run.mode, clis.length ? clis.join('+') : undefined].filter(Boolean).join(sep);
  const clock = now ?? state.now;
  const elapsed = state.run.startedAt !== undefined ? formatDuration((state.run.endedAt ?? clock) - state.run.startedAt) : '';
  const metaLine = [meta, elapsed, state.run.endedAt !== undefined ? state.run.outcomeLabel : undefined].filter(Boolean).join(sep);
  const costPrefix = totals.costPartial && totals.costUsd !== undefined ? (glyphs.unicode ? '≥' : '>=') : '';
  const money = `${costPrefix}${formatCost(totals.costUsd)}${sep}${formatTokens(totals.tokens)} tok`;

  let status: HeaderModel['status'];
  if (state.run.endedAt !== undefined) {
    status = state.run.ok ? { text: `${glyphs.ok} ${strings.header.done}`, tone: 'success' } : { text: `${glyphs.fail} ${strings.header.failed}`, tone: 'danger' };
  } else if (cancelling) {
    status = { text: `${strings.header.cancelling}${glyphs.ellipsis}`, tone: 'accent' };
  }

  const right = [status?.text, metaLine].filter(Boolean).join('  ');
  const rightWidth = displayWidth(right) + 3 + displayWidth(money);
  const goal = `"${state.run.goal ?? strings.header.waiting}"`;
  const room = layout.inner - displayWidth(mark) - 2 - rightWidth - 2;
  if (layout.mode !== 'narrow' && displayWidth(goal) <= room) {
    return { mark, status, metaLine, money, inlineGoal: goal, goalLines: [], height: 1 };
  }
  const goalLines = wrapPlain(goal, layout.inner, { maxLines: GOAL_LINES, ellipsis: glyphs.ellipsis });
  return { mark, status, metaLine, money, goalLines, height: 1 + goalLines.length };
}

/** Identity, goal, mode · cli, elapsed and run totals; a long goal wraps below. */
export function Header({ model, hasGoal }: { model: HeaderModel; hasGoal: boolean }) {
  const { glyphs } = useUi();
  const { mark, status, metaLine, money, inlineGoal, goalLines } = model;
  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text wrap="truncate-end">
          <Tx tone="accent" bold>
            {mark}
          </Tx>
          {inlineGoal ? <Tx dim={!hasGoal}>{`  ${inlineGoal}`}</Tx> : null}
        </Text>
        <Text wrap="truncate-end">
          {status ? (
            <Tx tone={status.tone} bold>
              {status.text}
              {'  '}
            </Tx>
          ) : null}
          <Tx tone="muted">{metaLine}</Tx>
          {metaLine ? <Tx tone="border">{glyphs.unicode ? ' │ ' : ' | '}</Tx> : null}
          <Tx bold>{money}</Tx>
        </Text>
      </Box>
      {goalLines.map((line, i) => (
        <Tx key={i} dim={!hasGoal} wrap="truncate-end">
          {line}
        </Tx>
      ))}
    </Box>
  );
}
