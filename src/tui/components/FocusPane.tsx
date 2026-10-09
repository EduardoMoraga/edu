import { Box, Text } from 'ink';
import { displayWidth, formatCost, formatDuration, formatTokens, roleIcon, truncate } from '../../identity/index.js';
import { logLines } from '../lines.js';
import { agentElapsed, agentTokens } from '../selectors.js';
import type { AgentView } from '../state.js';
import { STATUS_TONE } from './AgentTree.js';
import { Line, Tx, useUi } from './ui.js';

export interface FocusPaneProps {
  agent?: AgentView;
  width: number;
  /** Lines available for the log body. */
  height: number;
  now: number;
  active: boolean;
  /** Lines scrolled up from the newest output. */
  scroll?: number;
}

const STATUS_LABEL: Record<AgentView['status'], string> = {
  queued: 'queued',
  running: 'running',
  'awaiting-approval': 'awaiting approval',
  done: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
};

/** Streams the selected agent: text, dimmed thinking, collapsed tool calls. */
export function FocusPane({ agent, width, height, now, active, scroll = 0 }: FocusPaneProps) {
  const { glyphs } = useUi();
  if (!agent) {
    return (
      <Box flexDirection="column" width={width}>
        <Tx dim>select an agent to follow its work</Tx>
      </Box>
    );
  }
  const sep = ` ${glyphs.sep} `;
  const lines = logLines(agent.log, width, glyphs);
  const maxScroll = Math.max(0, lines.length - height);
  const offset = Math.min(Math.max(0, scroll), maxScroll);
  const visible = lines.slice(Math.max(0, lines.length - height - offset), lines.length - offset);

  const time = agent.status === 'queued' ? '' : `${sep}${formatDuration(agentElapsed(agent, now))}`;
  const tokens = agentTokens(agent);
  const usage = tokens > 0 ? `${formatTokens(tokens)} tok${sep}${formatCost(agent.usage.costUsd)}` : '';
  const engine = [agent.cli, agent.model].filter(Boolean).join(sep);
  const title = `${roleIcon(agent.role, glyphs)} ${agent.role}`;
  const leftWidth = displayWidth(`${title}${sep}${STATUS_LABEL[agent.status]}${time}`);
  // Drop the engine, then usage, rather than letting the two halves collide.
  const right =
    [[usage, engine].filter(Boolean).join('  '), usage].find((r) => leftWidth + 2 + displayWidth(r) <= width) ?? '';

  return (
    <Box flexDirection="column" width={width}>
      <Box justifyContent="space-between">
        <Text wrap="truncate-end">
          <Tx tone={active ? 'accent' : undefined} bold>
            {title}
          </Tx>
          <Tx tone="muted">{sep}</Tx>
          <Tx tone={STATUS_TONE[agent.status]}>{STATUS_LABEL[agent.status]}</Tx>
          <Tx tone="muted">{time}</Tx>
        </Text>
        {right ? <Tx tone="muted">{right}</Tx> : null}
      </Box>
      <Tx dim wrap="truncate-end">
        {agent.task ? truncate(agent.task, width, glyphs.ellipsis) : ' '}
      </Tx>
      {visible.length === 0 ? <Tx dim>{`waiting for output${glyphs.ellipsis}`}</Tx> : null}
      {visible.map((line, i) => (
        <Line key={i} line={line} />
      ))}
      {offset > 0 ? <Tx tone="muted">{`${glyphs.arrow} ${offset} newer lines below`}</Tx> : null}
    </Box>
  );
}
