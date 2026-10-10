/**
 * The constellation: the orchestrator card in the center, agent cards on an
 * ellipse around it (or two rows when the ring would collide), dotted
 * connectors between them, and a dot travelling along a connector while a
 * message flows. Pure: (state, size, clock) → DisplayLines.
 */
import { formatDuration, type Glyphs, type ToneToken } from '../../identity/index.js';
import type { AgentStatus } from '../../core/contracts.js';
import type { DisplayLine } from '../lines.js';
import { PULSE_MS, type BusKind } from '../mission.js';
import { agentElapsed, leadId } from '../selectors.js';
import type { AgentView, TuiState } from '../state.js';
import type { UiStrings } from '../strings.js';
import { Canvas, inside, linePoints, overlaps, type Rect } from './canvas.js';
import { bar, fitLine, panel } from './cells.js';

export const CARD_HEIGHT = 5;
const HUB_HEIGHT = 4;
const CARD_MAX = 30;
const CARD_MIN = 16;

export interface ConstellationInput {
  state: TuiState;
  width: number;
  height: number;
  /** Display clock (ms): drives spinners, elapsed and pulse travel. */
  now: number;
  glyphs: Glyphs;
  strings: UiStrings;
  /** Draw travelling pulses (live runs only; finished runs stay static). */
  animate: boolean;
  focusId?: string;
}

export interface Placement {
  hub: Rect;
  cards: Array<{ id: string; rect: Rect }>;
  /** Agents that did not fit. */
  hidden: number;
}

/** Card positions for `ids` around a centered hub; pure geometry. */
export function placeCards(ids: readonly string[], width: number, height: number): Placement {
  const hubW = Math.min(36, Math.max(20, width - 4));
  const hub: Rect = { x: Math.floor((width - hubW) / 2), y: Math.floor((height - HUB_HEIGHT) / 2), w: hubW, h: HUB_HEIGHT };
  const n = ids.length;
  if (n === 0) return { hub, cards: [], hidden: 0 };
  const cw = Math.min(CARD_MAX, Math.max(CARD_MIN, Math.floor(width / 4.2)));
  const ring = ringPlacement(ids, width, height, cw, hub);
  if (ring) return { hub, cards: ring, hidden: 0 };
  return gridPlacement(ids, width, height, hub);
}

function ringPlacement(ids: readonly string[], width: number, height: number, cw: number, hub: Rect): Placement['cards'] | undefined {
  const n = ids.length;
  const cx = width / 2;
  const cy = height / 2;
  const rx = Math.max(0, (width - cw) / 2 - 1);
  const ry = Math.max(0, (height - CARD_HEIGHT) / 2);
  // Even counts start half a step off the top so pairs sit symmetrically.
  const offset = n % 2 === 0 ? Math.PI / n : 0;
  const cards: Placement['cards'] = [];
  for (let i = 0; i < n; i++) {
    const theta = -Math.PI / 2 + offset + (2 * Math.PI * i) / n;
    const x = clamp(Math.round(cx + rx * Math.cos(theta) - cw / 2), 0, width - cw);
    const y = clamp(Math.round(cy + ry * Math.sin(theta) - CARD_HEIGHT / 2), 0, height - CARD_HEIGHT);
    const rect = { x, y, w: cw, h: CARD_HEIGHT };
    if (overlaps(rect, hub, 2, 0) || cards.some((c) => overlaps(rect, c.rect))) return undefined;
    cards.push({ id: ids[i]!, rect });
  }
  return cards;
}

function gridPlacement(ids: readonly string[], width: number, height: number, hub: Rect): Placement {
  const rows = height >= CARD_HEIGHT * 2 + HUB_HEIGHT + 2 ? 2 : 0;
  if (rows === 0) return { hub, cards: [], hidden: ids.length };
  const perRow = Math.max(1, Math.floor((width + 2) / (CARD_MIN + 2)));
  const shown = ids.slice(0, perRow * 2);
  const top = Math.ceil(shown.length / 2);
  const cw = Math.min(CARD_MAX, Math.floor((width - (top - 1) * 2) / top));
  const cards: Placement['cards'] = [];
  shown.forEach((id, i) => {
    const row = i < top ? 0 : 1;
    const inRow = row === 0 ? top : shown.length - top;
    const col = row === 0 ? i : i - top;
    const span = inRow * cw + (inRow - 1) * 2;
    const x0 = Math.floor((width - span) / 2);
    cards.push({ id, rect: { x: x0 + col * (cw + 2), y: row === 0 ? 0 : height - CARD_HEIGHT, w: cw, h: CARD_HEIGHT } });
  });
  return { hub, cards, hidden: ids.length - shown.length };
}

export function constellationLines(input: ConstellationInput): DisplayLine[] {
  const { state, width, height, glyphs } = input;
  const canvas = new Canvas(width, height);
  const lead = leadId(state);
  const ids = state.order.filter((id) => id !== lead);
  const place = placeCards(ids, width, height);
  const centerOf = (r: Rect): [number, number] => [r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2)];
  const rects = [place.hub, ...place.cards.map((c) => c.rect)];

  // Connectors first; cards are drawn over them.
  const paths = new Map<string, Array<[number, number]>>();
  for (const { id, rect } of place.cards) {
    const [hx, hy] = centerOf(place.hub);
    const [ax, ay] = centerOf(rect);
    const path = linePoints(hx, hy, ax, ay).filter(([x, y]) => !rects.some((r) => inside(r, x, y)));
    paths.set(id, path);
    const tone = linkTone(state.agents[id]?.status);
    path.forEach(([x, y], i) => {
      const next = path[i + 1] ?? path[i - 1];
      canvas.plot(x, y, stroke(x, y, next, glyphs), { tone, dim: tone === 'border' });
    });
  }
  if (input.animate && state.run.endedAt === undefined) drawPulses(canvas, input, paths);

  hubCard(state, lead, ids, place, input).forEach((line, i) => canvas.blit(place.hub.x, place.hub.y + i, line));
  for (const { id, rect } of place.cards) {
    const agent = state.agents[id];
    if (!agent) continue;
    agentCard(agent, rect.w, input, id === input.focusId).forEach((line, i) => canvas.blit(rect.x, rect.y + i, line));
  }
  return canvas.lines();
}

function hubCard(state: TuiState, lead: string | undefined, ids: string[], place: Placement, input: ConstellationInput): DisplayLine[] {
  const { glyphs, strings, now } = input;
  const done = ids.filter((id) => state.agents[id]?.status === 'done').length;
  const agent = lead ? state.agents[lead] : undefined;
  const ended = state.run.endedAt !== undefined;
  const status: AgentStatus | undefined = ended ? (state.run.ok ? 'done' : 'failed') : agent?.status;
  const statusText = status ? strings.status[status] : strings.header.waiting;
  const elapsed = state.run.startedAt !== undefined ? formatDuration((state.run.endedAt ?? now) - state.run.startedAt) : '';
  const hidden = place.hidden > 0 ? ` +${place.hidden}` : '';
  const line1: DisplayLine = [
    { text: `${status ? glyphs.status[status] : glyphs.status.queued} `, tone: statusTone(status), bold: true },
    { text: statusText, tone: statusTone(status) },
    ...(elapsed ? [{ text: ` ${glyphs.sep} ${elapsed}`, tone: 'muted' as const }] : []),
    ...(agent?.cli ? [{ text: ` ${glyphs.sep} ${agent.cli}`, tone: 'muted' as const }] : []),
  ];
  const line2: DisplayLine = [{ text: state.run.goal ?? agent?.task ?? '', dim: !state.run.goal }];
  return panel([line1, line2], glyphs, {
    width: place.hub.w,
    title: `${glyphs.roles.lead} orchestrator`,
    titleTone: 'accent',
    note: ids.length ? `${done}/${ids.length}${hidden}` : undefined,
    tone: 'accent',
  });
}

function agentCard(agent: AgentView, width: number, input: ConstellationInput, focused: boolean): DisplayLine[] {
  const { glyphs, state, now } = input;
  const progress = state.mission.activity[agent.id]?.progress ?? 0;
  const pct = `${Math.round(progress * 100)}%`.padStart(4);
  const inner = width - 4;
  const elapsed = agent.startedAt !== undefined ? formatDuration(agentElapsed(agent, now)) : '';
  const meta = fitLine([{ text: [agent.cli ?? agent.role, agent.model].filter(Boolean).join(` ${glyphs.sep} `), tone: 'muted' }], Math.max(1, inner - elapsed.length - 1), glyphs.ellipsis);
  const line1: DisplayLine = [...meta, { text: ` ${elapsed}`, tone: 'muted', dim: true }];
  const line2: DisplayLine = [{ text: agent.task || agent.id }];
  const lead = statusLead(agent.status, now, glyphs);
  const barWidth = Math.max(3, inner - 2 - 1 - pct.length);
  const line3: DisplayLine =
    agent.status === 'queued'
      ? [{ text: `${glyphs.status.queued} `, tone: 'muted' }, { text: input.strings.status.queued, tone: 'muted' }]
      : [lead, { text: ' ' }, ...bar(progress, barWidth, glyphs, barTone(agent.status)), { text: ` ${pct}`, tone: barTone(agent.status), bold: agent.status === 'done' }];
  const frame = focused ? 'accent' : cardTone(agent.status);
  return panel([line1, line2, line3], glyphs, {
    width,
    title: `${glyphs.mission.agent} ${agent.id}`,
    titleTone: focused || agent.status === 'running' ? 'peach' : agent.status === 'awaiting-approval' ? 'accent' : 'muted',
    tone: frame,
  });
}

function drawPulses(canvas: Canvas, input: ConstellationInput, paths: Map<string, Array<[number, number]>>): void {
  const { state, now, glyphs } = input;
  for (const p of state.mission.pulses) {
    const age = now - p.at;
    if (age < 0 || age > PULSE_MS) continue;
    const path = paths.get(p.agentId);
    if (!path || path.length === 0) continue;
    const t = age / PULSE_MS;
    const step = Math.min(path.length - 1, Math.floor(t * path.length));
    const [x, y] = path[p.dir === 'out' ? step : path.length - 1 - step]!;
    canvas.plot(x, y, glyphs.mission.dot, { tone: pulseTone(p.kind), bold: true });
  }
}

function stroke(x: number, y: number, next: [number, number] | undefined, glyphs: Glyphs): string {
  const { link } = glyphs.mission;
  if (!next) return link.d;
  const dx = next[0] - x;
  const dy = next[1] - y;
  if (dy === 0) return link.h;
  if (dx === 0) return link.v;
  return link.d;
}

function statusLead(status: AgentStatus, now: number, glyphs: Glyphs): DisplayLine[number] {
  if (status === 'running') {
    const frames = glyphs.mission.spinner;
    return { text: frames[Math.floor(now / 100) % frames.length]!, tone: 'peach', bold: true };
  }
  return { text: glyphs.status[status], tone: statusTone(status), bold: true };
}

export function statusTone(status: AgentStatus | undefined): ToneToken {
  switch (status) {
    case 'done':
      return 'success';
    case 'failed':
      return 'danger';
    case 'awaiting-approval':
      return 'accent';
    case 'running':
      return 'peach';
    default:
      return 'muted';
  }
}

function barTone(status: AgentStatus): ToneToken {
  return status === 'done' ? 'success' : status === 'failed' || status === 'cancelled' ? 'danger' : status === 'awaiting-approval' ? 'accent' : 'peach';
}

function cardTone(status: AgentStatus): ToneToken {
  return status === 'awaiting-approval' ? 'accent' : status === 'failed' ? 'danger' : status === 'running' ? 'peach' : 'border';
}

function linkTone(status: AgentStatus | undefined): ToneToken {
  return status === 'running' ? 'peach' : status === 'awaiting-approval' ? 'accent' : status === 'failed' ? 'danger' : 'border';
}

export function pulseTone(kind: BusKind): ToneToken {
  switch (kind) {
    case 'error':
      return 'danger';
    case 'approval':
      return 'accent';
    case 'learning':
      return 'brain';
    case 'result':
      return 'success';
    default:
      return 'peach';
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
