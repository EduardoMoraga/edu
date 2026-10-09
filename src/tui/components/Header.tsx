import { Box, Text } from 'ink';
import { displayWidth, formatCost, formatDuration, formatTokens, truncate } from '../../identity/index.js';
import type { Layout } from '../layout.js';
import { runClis, runTotals } from '../selectors.js';
import type { TuiState } from '../state.js';
import { Tx, useUi } from './ui.js';

export interface HeaderProps {
  state: TuiState;
  layout: Layout;
  name: string;
  /** Display clock (ms); defaults to the reducer clock. */
  now?: number;
  cancelling?: boolean;
}

/** Identity, goal, mode · cli, elapsed, and run totals on one line (two when narrow). */
export function Header({ state, layout, name, now, cancelling }: HeaderProps) {
  const { glyphs } = useUi();
  const totals = runTotals(state);
  const sep = ` ${glyphs.sep} `;
  const mark = `${glyphs.roles.lead} ${name.toUpperCase()}`;

  const clis = runClis(state);
  const meta = [state.run.mode, clis.length ? clis.join('+') : undefined].filter(Boolean).join(sep);
  const clock = now ?? state.now;
  const elapsed = state.run.startedAt !== undefined ? formatDuration((state.run.endedAt ?? clock) - state.run.startedAt) : '';
  const metaLine = [meta, elapsed].filter(Boolean).join(sep);

  const costPrefix = totals.costPartial && totals.costUsd !== undefined ? (glyphs.unicode ? '≥' : '>=') : '';
  const money = `${costPrefix}${formatCost(totals.costUsd)}${sep}${formatTokens(totals.tokens)} tok`;

  const status = runStatus(state, cancelling, glyphs.ok, glyphs.fail, glyphs.ellipsis);
  const right = [status?.text, metaLine].filter(Boolean).join('  ');
  const rightWidth = displayWidth(right) + 3 + displayWidth(money);

  const goal = state.run.goal ?? 'waiting for a run';
  const goalRoom =
    layout.mode === 'narrow' ? layout.inner - 2 : layout.inner - displayWidth(mark) - 2 - rightWidth - 2;
  const goalText = goalRoom >= 8 ? truncate(`"${goal}"`, goalRoom, glyphs.ellipsis) : '';

  const Right = (
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
  );

  if (layout.mode === 'narrow') {
    return (
      <Box flexDirection="column">
        <Box justifyContent="space-between">
          <Tx tone="accent" bold>
            {mark}
          </Tx>
          {Right}
        </Box>
        <Tx dim={!state.run.goal}>{truncate(`"${goal}"`, layout.inner, glyphs.ellipsis)}</Tx>
      </Box>
    );
  }
  return (
    <Box justifyContent="space-between">
      <Text wrap="truncate-end">
        <Tx tone="accent" bold>
          {mark}
        </Tx>
        {goalText ? <Tx dim={!state.run.goal}>{`  ${goalText}`}</Tx> : null}
      </Text>
      {Right}
    </Box>
  );
}

function runStatus(
  state: TuiState,
  cancelling: boolean | undefined,
  ok: string,
  fail: string,
  ellipsis: string,
): { text: string; tone: 'success' | 'danger' | 'accent' } | undefined {
  if (state.run.endedAt !== undefined) {
    return state.run.ok ? { text: `${ok} done`, tone: 'success' } : { text: `${fail} failed`, tone: 'danger' };
  }
  if (cancelling) return { text: `cancelling${ellipsis}`, tone: 'accent' };
  return undefined;
}
