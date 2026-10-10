/**
 * Mission control: title row, constellation (+ deck in full mode, or a deck
 * summary line in compact mode), message bus, composer and status bar. Every
 * row is a pre-measured DisplayLine, so the frame fills the terminal exactly.
 */
import { Box } from 'ink';
import type { ReactNode } from 'react';
import { displayWidth, formatDuration, type Glyphs } from '../../identity/index.js';
import { Line, useUi } from '../components/ui.js';
import type { DisplayLine } from '../lines.js';
import { runClis } from '../selectors.js';
import type { PendingApproval, TuiState } from '../state.js';
import { wrapText } from '../lines.js';
import { statusLine } from './bus.js';
import { fitLine, joinColumns, panel } from './cells.js';
import { constellationLines } from './constellation.js';
import { deckLines, deckSummary } from './deck.js';
import type { MissionLayout } from './layout.js';

export interface MissionViewProps {
  state: TuiState;
  layout: MissionLayout;
  now: number;
  name: string;
  animate: boolean;
  focusId?: string;
  approval?: PendingApproval;
  queued: number;
  showDetail: boolean;
  cancelling: boolean;
  /** The visible bus rows and how many newer rows are hidden below. */
  bus: { lines: DisplayLine[]; newer: number; total: number };
  /** Replaces the stage (help, palette). */
  overlay?: ReactNode;
  notice: DisplayLine[];
  composer: ReactNode;
}

export function MissionView(props: MissionViewProps) {
  const { glyphs, strings } = useUi();
  const { state, layout, now } = props;
  const { stage } = layout;
  const stageLines = props.overlay
    ? []
    : panel(
        constellationLines({ state, width: stage.width - 4, height: stage.height - 2, now, glyphs, strings, animate: props.animate, focusId: props.focusId }),
        glyphs,
        { width: stage.width, height: stage.height, title: 'constellation', tone: 'border' },
      );
  const main =
    layout.mode === 'full' && !props.overlay
      ? joinColumns(
          [
            { lines: stageLines, width: stage.width },
            { lines: deckLines({ state, width: layout.deckWidth, height: stage.height, now, glyphs, strings, focusId: props.focusId }), width: layout.deckWidth },
          ],
          1,
        )
      : stageLines;

  const detail = props.approval && props.showDetail ? wrapText(props.approval.detail, layout.columns - 6).map((t): DisplayLine => [{ text: t }]) : undefined;
  const busPanel = panel(detail ?? props.bus.lines, glyphs, {
    width: layout.columns,
    height: layout.busHeight,
    title: detail ? `${strings.approval.details} ${glyphs.sep} ${props.approval!.title}` : 'message bus',
    titleTone: detail ? 'accent' : 'muted',
    note: detail ? undefined : props.bus.newer > 0 ? `${props.bus.newer} newer ${glyphs.unicode ? '↓' : 'v'} end` : `${props.bus.total}`,
  });
  const status = statusLine({ state, width: layout.columns, now, glyphs, strings, approval: props.approval, queued: props.queued, cancelling: props.cancelling });

  return (
    <Box flexDirection="column" width={layout.columns}>
      <Line line={titleLine(state, layout.columns, props.name, now, glyphs)} />
      {props.overlay ? (
        <Box height={stage.height} flexDirection="column" overflow="hidden">
          {props.overlay}
        </Box>
      ) : (
        main.map((line, i) => <Line key={`m${i}`} line={line} />)
      )}
      {layout.mode === 'compact' ? <Line line={fitLine([{ text: ' ' }, ...deckSummary(state, glyphs)], layout.columns, glyphs.ellipsis)} /> : null}
      {busPanel.map((line, i) => (
        <Line key={`b${i}`} line={line} />
      ))}
      {props.notice.map((line, i) => (
        <Line key={`n${i}`} line={line} />
      ))}
      <Box paddingX={1}>{props.composer}</Box>
      <Line line={status} />
    </Box>
  );
}

function titleLine(state: TuiState, width: number, name: string, now: number, glyphs: Glyphs): DisplayLine {
  const sep = ` ${glyphs.sep} `;
  const clis = runClis(state);
  const elapsed = state.run.startedAt !== undefined ? formatDuration((state.run.endedAt ?? now) - state.run.startedAt) : '';
  const right = [state.run.mode, clis.length ? clis.join('+') : undefined, elapsed].filter(Boolean).join(sep);
  const left: DisplayLine = [
    { text: ` ${glyphs.roles.lead} ${name.toUpperCase()}`, tone: 'accent', bold: true },
    { text: '  mission control', tone: 'peach' },
    ...(state.run.goal ? [{ text: `  "${state.run.goal}"` }] : []),
  ];
  const room = width - displayWidth(right) - 2;
  const head = fitLine(left, Math.max(1, room), glyphs.ellipsis);
  return fitLine([...head, { text: ' ' }, { text: right, tone: 'muted' }, { text: ' ' }], width);
}
