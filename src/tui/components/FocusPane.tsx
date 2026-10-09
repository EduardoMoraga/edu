import { Box, Text } from 'ink';
import { displayWidth, formatCost, formatDuration, formatTokens, roleIcon } from '../../identity/index.js';
import type { FocusWindow } from '../focus.js';
import type { DisplayLine } from '../lines.js';
import { agentElapsed, agentTokens } from '../selectors.js';
import type { AgentView } from '../state.js';
import { fill } from '../strings.js';
import { STATUS_TONE } from './AgentTree.js';
import { Line, Tx, useUi } from './ui.js';

export interface FocusPaneProps {
  agent?: AgentView;
  width: number;
  now: number;
  active: boolean;
  /** Wrapped task description (see App). */
  task: DisplayLine[];
  /** Visible log slice and how many lines sit below it. */
  view: FocusWindow;
}

/** Streams the selected agent: wrapped text, dimmed thinking, collapsed tool calls. */
export function FocusPane({ agent, width, now, active, task, view }: FocusPaneProps) {
  const { glyphs, strings } = useUi();
  if (!agent) {
    return (
      <Box flexDirection="column" width={width}>
        <Tx dim>{strings.focus.empty}</Tx>
      </Box>
    );
  }
  const sep = ` ${glyphs.sep} `;
  const status = strings.status[agent.status];
  const time = agent.status === 'queued' ? '' : `${sep}${formatDuration(agentElapsed(agent, now))}`;
  const tokens = agentTokens(agent);
  const usage = tokens > 0 ? `${formatTokens(tokens)} tok${sep}${formatCost(agent.usage.costUsd)}` : '';
  const engine = [agent.cli, agent.model].filter(Boolean).join(sep);
  const title = `${roleIcon(agent.role, glyphs)} ${agent.role}`;
  const leftWidth = displayWidth(`${title}${sep}${status}${time}`);
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
          <Tx tone={STATUS_TONE[agent.status]}>{status}</Tx>
          <Tx tone="muted">{time}</Tx>
        </Text>
        {right ? <Tx tone="muted">{right}</Tx> : null}
      </Box>
      {task.map((line, i) => (
        <Line key={`t${i}`} line={line.map((s) => ({ ...s, dim: true }))} />
      ))}
      {view.lines.length === 0 ? <Tx dim>{`${strings.focus.waiting}${glyphs.ellipsis}`}</Tx> : null}
      {view.lines.map((line, i) => (
        <Line key={i} line={line} />
      ))}
      {view.newer > 0 ? (
        <Tx tone="accent" wrap="truncate-end">{`${glyphs.unicode ? '↓' : 'v'} ${fill(strings.focus.newerBelow, { n: view.newer })}`}</Tx>
      ) : null}
    </Box>
  );
}
