import { Box } from 'ink';
import { displayWidth, roleIcon, type Glyphs } from '../../identity/index.js';
import type { DisplayLine } from '../lines.js';
import { wrapText } from '../lines.js';
import type { PendingApproval } from '../state.js';
import { uiStrings, type UiStrings } from '../strings.js';
import { wrapSegments } from '../wrap.js';
import { Line, useUi } from './ui.js';

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
/** Max lines for the request title. */
export const TITLE_LINES = 3;

export interface ApprovalLayout {
  title: DisplayLine[];
  keys: DisplayLine;
  /** Keys share the first line when the title fits beside them. */
  keysInline: boolean;
  detail: string[];
  height: number;
}

export function approvalLayout(
  props: ApprovalCardProps,
  glyphs: Glyphs,
  strings: UiStrings = uiStrings('en'),
): ApprovalLayout {
  const { approval, role, width, queued, showDetail } = props;
  const a = strings.approval;
  const keys: DisplayLine = [
    { text: '[y]', tone: 'accent', bold: true },
    { text: ` ${a.approve}  ` },
    { text: '[n]', tone: 'accent', bold: true },
    { text: ` ${a.reject}  ` },
    { text: '[d]', tone: 'accent', bold: true },
    { text: ` ${a.details}` },
  ];
  const keysWidth = displayWidth(keys.map((s) => s.text).join(''));
  const head: DisplayLine = [
    { text: `${glyphs.approval} ${a.title}  `, tone: 'accent', bold: true },
    { text: `${roleIcon(role, glyphs)} ${role} ${glyphs.sep} ${approval.title}` },
    ...(queued > 0 ? [{ text: `  +${queued} ${a.more}`, tone: 'muted' as const }] : []),
  ];
  const single = wrapSegments(head, width - keysWidth - 2);
  const keysInline = single.length === 1;
  const title = keysInline ? single : wrapSegments(head, width, { indent: 2, maxLines: TITLE_LINES, ellipsis: glyphs.ellipsis });
  const detail = showDetail ? wrapText(approval.detail, width - 2).slice(0, DETAIL_LINES) : [];
  return { title, keys, keysInline, detail, height: title.length + (keysInline ? 0 : 1) + detail.length };
}

/** Lines the card occupies (used by App to budget the focus pane). */
export function approvalCardHeight(props: ApprovalCardProps, glyphs: Glyphs, strings?: UiStrings): number {
  return approvalLayout(props, glyphs, strings).height;
}

/** The pending decision, with its keyboard actions: [y] approve · [n] reject · [d] details. */
export function ApprovalCard(props: ApprovalCardProps) {
  const { glyphs, strings } = useUi();
  const { title, keys, keysInline, detail } = approvalLayout(props, glyphs, strings);
  return (
    <Box flexDirection="column">
      {keysInline ? (
        <Box justifyContent="space-between">
          <Line line={title[0]!} />
          <Line line={keys} />
        </Box>
      ) : (
        <>
          {title.map((l, i) => (
            <Line key={i} line={l} />
          ))}
          <Line line={keys} />
        </>
      )}
      {detail.map((l, i) => (
        <Line key={`d${i}`} line={[{ text: `  ${l}`, dim: true }]} />
      ))}
    </Box>
  );
}
