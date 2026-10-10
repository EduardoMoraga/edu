/**
 * The flight deck: stacked panels beside the constellation (run, context,
 * gate, agents, checks, brain, log) fitted to an exact height, plus the
 * one-line summary used when the deck collapses. Pure.
 */
import { formatCost, formatPercent, formatTokens, type Glyphs } from '../../identity/index.js';
import type { DisplayLine } from '../lines.js';
import { logLines } from '../lines.js';
import { wrapSegments } from '../wrap.js';
import { agentElapsed, leadId, runClis, runTotals } from '../selectors.js';
import type { TuiState } from '../state.js';
import type { UiStrings } from '../strings.js';
import { bar, clock, fitLine, meter, panel } from './cells.js';
import { statusTone } from './constellation.js';

export interface DeckInput {
  state: TuiState;
  width: number;
  height: number;
  now: number;
  glyphs: Glyphs;
  strings: UiStrings;
  focusId?: string;
}

interface Section {
  title: string;
  note?: string;
  lines: DisplayLine[];
  /** Lower drops first when height is short. */
  priority: number;
  /** Takes the leftover height. */
  grow?: boolean;
  min?: number;
}

/** Deck panels stacked to exactly `height` rows (sections drop by priority). */
export function deckLines(input: DeckInput): DisplayLine[] {
  const { width, height, glyphs } = input;
  const inner = width - 4;
  let sections = buildSections(input, inner).filter((s) => s.lines.length > 0 || s.grow);
  const cost = (s: Section) => (s.grow ? (s.min ?? 1) : s.lines.length) + 2;
  while (sections.length > 1 && sections.reduce((n, s) => n + cost(s), 0) > height) {
    const lowest = sections.reduce((a, b) => (b.priority < a.priority ? b : a));
    sections = sections.filter((s) => s !== lowest);
  }
  const fixed = sections.reduce((n, s) => n + (s.grow ? 0 : s.lines.length + 2), 0);
  const out: DisplayLine[] = [];
  for (const s of sections) {
    const h = s.grow ? Math.max((s.min ?? 1) + 2, height - fixed) : s.lines.length + 2;
    // A growing log shows its newest lines.
    const lines = s.grow ? s.lines.slice(Math.max(0, s.lines.length - (h - 2))) : s.lines;
    out.push(...panel(lines, glyphs, { width, height: h, title: s.title, note: s.note }));
  }
  while (out.length < height) out.push([]);
  return out.slice(0, height);
}

function buildSections(input: DeckInput, inner: number): Section[] {
  const { state, glyphs, strings, now } = input;
  const sep = ` ${glyphs.sep} `;
  const totals = runTotals(state);
  const lead = leadId(state);
  const model = state.order.map((id) => state.agents[id]?.model).find(Boolean) ?? runClis(state).join('+');
  const sections: Section[] = [];

  sections.push({
    title: 'run',
    priority: 9,
    lines: [
      [{ text: [model || '—', state.run.mode ?? 'solo'].join(sep), tone: 'peach', bold: true }],
      [
        { text: `${totals.costPartial && totals.costUsd !== undefined ? (glyphs.unicode ? '≥' : '>=') : ''}${formatCost(totals.costUsd)}`, bold: true },
        { text: sep, tone: 'muted' },
        { text: `${formatTokens(totals.tokens)} tok`, bold: true },
        { text: `${sep}${totals.running} active`, tone: 'muted' },
      ],
    ],
  });

  const ctx = state.brain.context;
  if (ctx && ctx.budgetTokens > 0) {
    const ratio = ctx.usedTokens / ctx.budgetTokens;
    const label = `${formatPercent(ratio)} ${formatTokens(ctx.usedTokens)}/${formatTokens(ctx.budgetTokens)}`;
    const cells = Math.max(5, Math.min(16, inner - label.length - 5));
    sections.push({ title: 'context', priority: 8, lines: [[{ text: 'ctx ', tone: 'muted' }, ...meter(ratio, cells, glyphs), { text: ` ${label}` }]] });
  }

  const { gate } = state.mission;
  const pending = state.approvals.length;
  const current = state.approvals[0];
  const gateLine: DisplayLine = [
    { text: `${glyphs.ok} ${gate.allowed} allowed`, tone: 'success' },
    { text: sep, tone: 'muted' },
    { text: `${glyphs.fail} ${gate.denied} denied`, tone: gate.denied ? 'danger' : 'muted' },
    { text: sep, tone: 'muted' },
    { text: `${glyphs.approval} ${pending} pending`, tone: pending ? 'accent' : 'muted', bold: pending > 0 },
  ];
  sections.push({
    title: 'gate',
    priority: 7,
    lines: current ? [gateLine, [{ text: `${glyphs.approval} `, tone: 'accent', bold: true }, { text: current.title }]] : [gateLine],
  });

  const ids = state.order.filter((id) => id !== lead);
  const agentRows: DisplayLine[] = ids.map((id, i) => {
    const a = state.agents[id]!;
    const p = state.mission.activity[id]?.progress ?? 0;
    const time = a.startedAt !== undefined ? clock(agentElapsed(a, now)) : '';
    const label = fitLine([{ text: `${i + 1}: ${a.task || a.id}` }], Math.max(6, inner - 2 - 9 - 6), glyphs.ellipsis);
    return [
      { text: `${glyphs.status[a.status]} `, tone: statusTone(a.status), bold: true },
      ...label.map((s) => (id === input.focusId ? { ...s, tone: 'peach' as const, bold: true } : s)),
      { text: ' ' },
      ...bar(p, 8, glyphs, a.status === 'done' ? 'success' : statusTone(a.status)),
      { text: ` ${time.padStart(5)}`, tone: 'muted' },
    ];
  });
  sections.push({ title: 'agents', note: ids.length ? `${ids.filter((id) => state.agents[id]?.status === 'done').length}/${ids.length}` : undefined, priority: 6, lines: agentRows });

  const checkLines = checkRows(state, glyphs);
  if (checkLines.length) {
    const passed = state.mission.checks.filter((c) => c.ok).length;
    const total = Math.max(state.mission.specChecks.length, state.mission.checks.length);
    sections.push({ title: 'checks', note: `${passed}/${total}`, priority: 5, lines: checkLines });
  }

  const brain: DisplayLine[] = [];
  if (state.brain.recalledIds.length) {
    const recalled: DisplayLine = [{ text: `${recallMark(glyphs)} `, tone: 'brain' }, { text: state.brain.recalledIds.join(', '), tone: 'muted' }];
    brain.push(...wrapSegments(recalled, inner, { indent: 2, maxLines: 2, ellipsis: glyphs.ellipsis }));
  }
  for (const l of state.brain.learnings.slice(-2)) brain.push([{ text: '+ ', tone: 'brain', bold: true }, { text: l.noteId, tone: 'brain' }, { text: ` ${l.title}`, dim: true }]);
  if (brain.length) sections.push({ title: 'brain', priority: 4, lines: brain });

  const focus = input.focusId ? state.agents[input.focusId] : undefined;
  const log = focus ? logLines(focus.log, inner, glyphs, strings) : [];
  sections.push({ title: focus ? `log ${glyphs.sep} ${focus.id}` : 'log', priority: 3, grow: true, min: 3, lines: log.length ? log : [[{ text: strings.focus.waiting, dim: true }]] });
  return sections;
}

function checkRows(state: TuiState, glyphs: Glyphs): DisplayLine[] {
  const results = new Map(state.mission.checks.map((c) => [c.id, c]));
  const ids = [...state.mission.specChecks, ...state.mission.checks.map((c) => c.id).filter((id) => !state.mission.specChecks.includes(id))];
  return ids.map((id) => {
    const r = results.get(id);
    if (!r) return [{ text: `${glyphs.status.queued} `, tone: 'muted' }, { text: id, tone: 'muted' }];
    return [
      { text: `${r.ok ? glyphs.ok : glyphs.fail} `, tone: r.ok ? 'success' : 'danger', bold: true },
      { text: id },
      { text: ` ${r.requirementIds.join(',')}`, tone: 'muted' },
    ];
  });
}

/** The collapsed deck: one line of run, context, gate, checks and brain. */
export function deckSummary(state: TuiState, glyphs: Glyphs): DisplayLine {
  const sep: DisplayLine[number] = { text: glyphs.unicode ? '  │  ' : '  |  ', tone: 'border' };
  const totals = runTotals(state);
  const model = state.order.map((id) => state.agents[id]?.model).find(Boolean) ?? runClis(state).join('+');
  const out: DisplayLine = [
    { text: [model || '—', state.run.mode ?? 'solo'].join(` ${glyphs.sep} `), tone: 'peach', bold: true },
    { text: `  ${formatCost(totals.costUsd)} ${glyphs.sep} ${formatTokens(totals.tokens)} tok`, bold: true },
  ];
  const ctx = state.brain.context;
  if (ctx && ctx.budgetTokens > 0) {
    const ratio = ctx.usedTokens / ctx.budgetTokens;
    out.push(sep, { text: 'ctx ', tone: 'muted' }, ...meter(ratio, 5, glyphs), { text: ` ${formatPercent(ratio)}` });
  }
  const { gate } = state.mission;
  out.push(sep, { text: 'gate ', tone: 'muted' }, { text: `${glyphs.ok}${gate.allowed} `, tone: 'success' }, { text: `${glyphs.fail}${gate.denied} `, tone: gate.denied ? 'danger' : 'muted' }, {
    text: `${glyphs.approval}${state.approvals.length}`,
    tone: state.approvals.length ? 'accent' : 'muted',
  });
  const total = Math.max(state.mission.specChecks.length, state.mission.checks.length);
  if (total) out.push(sep, { text: 'checks ', tone: 'muted' }, { text: `${state.mission.checks.filter((c) => c.ok).length}/${total}` });
  if (state.brain.recalledIds.length || state.brain.learnings.length) {
    out.push(sep, { text: 'brain ', tone: 'muted' }, { text: `${recallMark(glyphs)}${state.brain.recalledIds.length} +${state.brain.learnings.length}`, tone: 'brain' });
  }
  return out;
}

function recallMark(glyphs: Glyphs): string {
  return glyphs.unicode ? '↺' : '<';
}
