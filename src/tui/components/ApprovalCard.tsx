import { Box, Text } from 'ink';
import { roleIcon, truncate } from '../../identity/index.js';
import { wrapText } from '../lines.js';
import type { PendingApproval } from '../state.js';
import { Tx, useUi } from './ui.js';

export interface ApprovalCardProps {
  approval: PendingApproval;
  role: string;
  width: number;
  /** Additional approvals queued behind this one. */
  queued: number;
  showDetail: boolean;
}

/** Max detail lines shown when the card is expanded with `d`. */
export const DETAIL_LINES = 8;
/** Below this width the key hints move to their own line. */
const NARROW_CARD = 70;

export function approvalCardHeight(showDetail: boolean, detail: string, width: number): number {
  return (width < NARROW_CARD ? 2 : 1) + (showDetail ? Math.min(DETAIL_LINES, wrapText(detail, width - 2).length) : 0);
}

/** The pending decision, with its keyboard actions: [y] approve · [n] reject · [d] details. */
export function ApprovalCard({ approval, role, width, queued, showDetail }: ApprovalCardProps) {
  const { glyphs } = useUi();
  const keys = '[y] approve  [n] reject  [d] details';
  const narrow = width < NARROW_CARD;
  const titleRoom = width - 13 - (narrow ? 0 : keys.length + 2) - (queued ? 10 : 0);
  const detail = showDetail ? wrapText(approval.detail, width - 2).slice(0, DETAIL_LINES) : [];
  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text wrap="truncate-end">
          <Tx tone="accent" bold>{`${glyphs.approval} APPROVAL  `}</Tx>
          <Tx>{truncate(`${roleIcon(role, glyphs)} ${role} ${glyphs.sep} ${approval.title}`, Math.max(10, titleRoom), glyphs.ellipsis)}</Tx>
          {queued > 0 ? <Tx tone="muted">{`  +${queued} more`}</Tx> : null}
        </Text>
        {narrow ? null : <Keys />}
      </Box>
      {narrow ? <Keys /> : null}
      {detail.map((l, i) => (
        <Tx key={i} dim wrap="truncate-end">{`  ${l}`}</Tx>
      ))}
    </Box>
  );
}

function Keys() {
  return (
    <Text>
      <Tx tone="accent" bold>[y]</Tx>
      <Tx> approve  </Tx>
      <Tx tone="accent" bold>[n]</Tx>
      <Tx> reject  </Tx>
      <Tx tone="accent" bold>[d]</Tx>
      <Tx> details</Tx>
    </Text>
  );
}
