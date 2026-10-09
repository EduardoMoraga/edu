import { Box, Text } from 'ink';
import type { AgentStatus } from '../../core/contracts.js';
import {
  displayWidth,
  formatDuration,
  formatTokens,
  padEndDisplay,
  roleIcon,
  statusGlyph,
  truncate,
  type Glyphs,
  type ToneToken,
} from '../../identity/index.js';
import type { Layout } from '../layout.js';
import { agentElapsed, agentTokens, agentTree, focusedAgent, type TreeRow } from '../selectors.js';
import type { TuiState } from '../state.js';
import { Label, Tx, useUi } from './ui.js';

export const STATUS_TONE: Record<AgentStatus, ToneToken | undefined> = {
  queued: 'muted',
  running: 'accent',
  'awaiting-approval': 'accent',
  done: 'success',
  failed: 'danger',
  cancelled: 'muted',
};

export interface AgentTreeProps {
  state: TuiState;
  layout: Layout;
  now: number;
  active: boolean;
}

export function AgentTree({ state, layout, now, active }: AgentTreeProps) {
  const { glyphs, strings } = useUi();
  const rows = agentTree(state);
  const selected = focusedAgent(state)?.id;
  const running = rows.filter((r) => r.agent.status === 'running' || r.agent.status === 'awaiting-approval').length;
  return (
    <Box flexDirection="column" width={layout.treeWidth} flexShrink={0}>
      <Text>
        <Label active={active}>{strings.tree.title}</Label>
        {rows.length > 0 ? <Tx tone="muted">{`  ${running}/${rows.length} ${strings.tree.active}`}</Tx> : null}
      </Text>
      {rows.length === 0 ? <Tx dim>{strings.tree.empty}</Tx> : null}
      {rows.map((row) => (
        <TreeLine key={row.agent.id} row={row} width={layout.treeWidth} now={now} selected={row.agent.id === selected}
          showTokens={layout.showTreeTokens} glyphs={glyphs} queuedLabel={strings.tree.queued} />
      ))}
    </Box>
  );
}

interface TreeLineProps {
  row: TreeRow;
  width: number;
  now: number;
  selected: boolean;
  showTokens: boolean;
  glyphs: Glyphs;
  queuedLabel: string;
}

function TreeLine({ row, width, now, selected, showTokens, glyphs, queuedLabel }: TreeLineProps) {
  const { agent } = row;
  const marker = selected ? `${glyphs.selected} ` : '  ';
  const rails =
    row.depth === 0
      ? ''
      : row.rails.map((r) => (r ? glyphs.tree.pipe : glyphs.tree.space)).join('') +
        (row.last ? glyphs.tree.last : glyphs.tree.branch);
  const icon = padEndDisplay(roleIcon(agent.role, glyphs), 2);

  const glyph = statusGlyph(agent.status, glyphs);
  const time = agent.status === 'queued' ? queuedLabel : formatDuration(agentElapsed(agent, now));
  const tokens = showTokens && agentTokens(agent) > 0 ? formatTokens(agentTokens(agent)) : '';
  const right = `${glyph} ${time.padStart(6)}${showTokens ? ` ${tokens.padStart(5)}` : ''}`;

  // marker · rails · icon(2)+space · label · space · right · trailing gap before the divider
  const room = width - displayWidth(marker) - displayWidth(rails) - 3 - displayWidth(right) - 2;
  const label = padEndDisplay(truncate(agent.role, Math.max(1, room), glyphs.ellipsis), Math.max(1, room));

  return (
    <Text wrap="truncate-end">
      <Tx tone="accent">{marker}</Tx>
      <Tx tone="border">{rails}</Tx>
      <Tx tone={selected ? 'accent' : undefined}>{`${icon} `}</Tx>
      <Tx bold={selected}>{label}</Tx>
      <Tx> </Tx>
      <Tx tone={STATUS_TONE[agent.status]}>{glyph}</Tx>
      <Tx tone="muted">{right.slice(glyph.length)}</Tx>
    </Text>
  );
}
