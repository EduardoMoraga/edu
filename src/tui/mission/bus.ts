/**
 * Message bus rows and the bottom status bar. Pure.
 *
 *   00:12.450 ● builder-1   → read_file    {"path":"src/example.ts"}
 *
 * The dot and the sender take the kind's color (tool, result, approval,
 * error, learning…); errors also tint the text.
 */
import { displayWidth, formatDuration, padEndDisplay, truncate, type Glyphs, type ToneToken } from '../../identity/index.js';
import type { DisplayLine } from '../lines.js';
import type { BusEntry, BusKind } from '../mission.js';
import { leadId } from '../selectors.js';
import type { PendingApproval, TuiState } from '../state.js';
import type { UiStrings } from '../strings.js';
import { fitLine, stamp } from './cells.js';

export const KIND_TONE: Readonly<Record<BusKind, ToneToken>> = {
  run: 'accent',
  spawn: 'muted',
  tool: 'peach',
  result: 'success',
  message: 'muted',
  approval: 'accent',
  error: 'danger',
  learning: 'brain',
  verify: 'success',
};

export function busLines(entries: readonly BusEntry[], width: number, start: number | undefined, glyphs: Glyphs): DisplayLine[] {
  const nameW = Math.max(8, Math.min(14, Math.floor(width / 9)));
  const arrow = glyphs.unicode ? ' → ' : ' > ';
  const origin = start ?? entries[0]?.at ?? 0;
  return entries.map((e) => {
    const tone = e.ok === false ? 'danger' : KIND_TONE[e.kind];
    const line: DisplayLine = [
      { text: stamp(e.at - origin), tone: 'muted', dim: true },
      { text: ` ${glyphs.mission.dot} `, tone },
      { text: padEndDisplay(truncate(e.from, nameW, glyphs.ellipsis), nameW), tone: e.kind === 'message' || e.kind === 'spawn' ? 'peach' : tone, bold: true },
      { text: arrow, tone: 'border' },
      { text: padEndDisplay(truncate(e.to, nameW, glyphs.ellipsis), nameW), tone: 'muted' },
      { text: '  ' },
      { text: e.text, ...(e.kind === 'error' || e.ok === false ? { tone: 'danger' as const } : e.kind === 'spawn' || e.kind === 'learning' ? { dim: true } : {}) },
    ];
    return fitLine(line, width, glyphs.ellipsis);
  });
}

export interface StatusInput {
  state: TuiState;
  width: number;
  now: number;
  glyphs: Glyphs;
  strings: UiStrings;
  approval?: PendingApproval;
  queued: number;
  cancelling?: boolean;
}

/** The full-width bottom bar; a filled banner for approvals and run errors. */
export function statusLine(input: StatusInput): DisplayLine {
  const { state, width, glyphs, strings, approval } = input;
  const sep = ` ${glyphs.sep} `;
  if (approval) {
    const lead = leadId(state);
    const spec = state.spec && approval.agentId === lead ? state.spec : undefined;
    const head = spec
      ? `${strings.approval.approve} spec${sep}${spec.requirements} reqs${sep}${spec.checks} checks`
      : `${strings.approval.title}  ${approval.agentId}${sep}${approval.title}`;
    const more = input.queued > 0 ? `${sep}+${input.queued} ${strings.approval.more}` : '';
    const keys = `y ${strings.approval.approve}${sep}n ${strings.approval.reject}${sep}d ${strings.approval.details} `;
    return banner(`${glyphs.roles.lead} ${head}${more}`, keys, width, 'accent', glyphs);
  }
  const runError = state.errors.filter((e) => !e.agentId).at(-1);
  if (runError && state.run.ok !== true) return banner(`${glyphs.fail} ${runError.message}`, '', width, 'danger', glyphs);

  const lead = leadId(state);
  const ids = state.order.filter((id) => id !== lead);
  const done = ids.filter((id) => state.agents[id]?.status === 'done').length;
  const ended = state.run.endedAt !== undefined;
  const elapsed = state.run.startedAt !== undefined ? formatDuration((state.run.endedAt ?? input.now) - state.run.startedAt) : '';
  const status = ended
    ? { text: `${state.run.ok ? glyphs.ok : glyphs.fail} ${state.run.ok ? strings.header.done : strings.header.failed}`, tone: (state.run.ok ? 'success' : 'danger') as ToneToken }
    : input.cancelling
      ? { text: `${strings.header.cancelling}${glyphs.ellipsis}`, tone: 'accent' as ToneToken }
      : state.run.startedAt !== undefined
        ? { text: `${glyphs.status.running} ${strings.status.running}`, tone: 'peach' as ToneToken }
        : { text: `${glyphs.status.queued} ${strings.header.waiting}`, tone: 'muted' as ToneToken };
  const left: DisplayLine = [
    { text: ' ' },
    { text: status.text, tone: status.tone, bold: true },
    ...(ids.length ? [{ text: `${sep}${done}/${ids.length} agents`, tone: 'muted' as const }] : []),
    ...(elapsed ? [{ text: `${sep}${elapsed}`, tone: 'muted' as const }] : []),
    ...(ended && state.run.summary ? [{ text: `${sep}${state.run.summary}`, dim: true }] : []),
  ];
  const hint = glyphs.unicode ? '↑↓ agents · pgup/pgdn bus · / commands · ? help · q quit ' : 'up/dn agents - pgup/pgdn bus - / commands - ? help - q quit ';
  const room = width - displayWidth(left.map((s) => s.text).join(''));
  if (room < displayWidth(hint) + 2) return fitLine(left, width, glyphs.ellipsis);
  return fitLine([...left, { text: ' '.repeat(room - displayWidth(hint)) }, { text: hint, tone: 'muted', dim: true }], width);
}

function banner(text: string, right: string, width: number, bg: ToneToken, glyphs: Glyphs): DisplayLine {
  const rightW = displayWidth(right);
  const left = truncate(` ${text}`, Math.max(1, width - rightW - 1), glyphs.ellipsis);
  const gap = Math.max(1, width - displayWidth(left) - rightW);
  return fitLine([{ text: left + ' '.repeat(gap) + right, tone: 'ink', bg, bold: true }], width);
}
