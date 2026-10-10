/**
 * Mission-control slice of the TUI state: the message bus, per-agent
 * activity and progress, approval gate counters, verification checks and the
 * flow pulses that animate connectors. Folded by `reduce` in state.ts right
 * after the core fold, so the reducer stays the single source of truth.
 *
 * Progress heuristic (no engine reports real progress, so it is estimated):
 *   queued              → 0
 *   running / awaiting  → 8% + 84% × (1 − 0.72^steps), where steps counts tool
 *                         calls and assistant turns; it rises fast at first,
 *                         flattens, and never passes 92% before the agent ends
 *   done                → 100%
 *   failed / cancelled  → frozen at the last estimate
 */
import type { AgentStatus, EduEvent } from '../core/contracts.js';

export type BusKind = 'run' | 'spawn' | 'tool' | 'result' | 'message' | 'approval' | 'error' | 'learning' | 'verify';

export interface BusEntry {
  seq: number;
  /** Event time (ms). */
  at: number;
  from: string;
  to: string;
  kind: BusKind;
  text: string;
  /** Outcome, for results, verification, approvals and endings. */
  ok?: boolean;
  /** Tool call id, so a result can name its tool. */
  callId?: string;
}

/** A message travelling along the connector between an agent and the lead. */
export interface Pulse {
  seq: number;
  agentId: string;
  at: number;
  /** `in` travels agent → lead, `out` lead → agent. */
  dir: 'in' | 'out';
  kind: BusKind;
}

export interface AgentActivity {
  calls: number;
  turns: number;
  /** Estimated completion, 0..1 (see the heuristic above). */
  progress: number;
}

export interface GateCounters {
  requested: number;
  allowed: number;
  denied: number;
}

export interface CheckResult {
  id: string;
  ok: boolean;
  kind: string;
  requirementIds: string[];
  output: string;
  at: number;
}

export interface MissionState {
  seq: number;
  bus: BusEntry[];
  pulses: Pulse[];
  activity: Record<string, AgentActivity>;
  gate: GateCounters;
  /** Newest result per check id, first-seen order. */
  checks: CheckResult[];
  /** Check ids declared by the newest spec (pending until verified). */
  specChecks: string[];
}

export const MAX_BUS_ENTRIES = 300;
export const MAX_PULSES = 24;
/** How long a pulse takes to travel its connector (display ms). */
export const PULSE_MS = 700;
/** Pulses closer than this on the same connector and direction merge. */
const PULSE_GAP_MS = 120;
const MAX_TEXT = 240;

export const initialMission: MissionState = {
  seq: 0,
  bus: [],
  pulses: [],
  activity: {},
  gate: { requested: 0, allowed: 0, denied: 0 },
  checks: [],
  specChecks: [],
};

/** What the mission reducer needs to know about the folded core state. */
export interface MissionContext {
  at: number;
  leadId?: string;
  agentStatus(id: string): AgentStatus | undefined;
  parentOf(id: string): string | undefined;
  /** The agent's newest assistant text, so an identical end summary is not logged twice. */
  lastText?(id: string): string | undefined;
  /** Agent that owned an approval, resolved before the core fold removed it. */
  approvalAgent?: string;
}

export function reduceMission(m: MissionState, event: EduEvent, ctx: MissionContext): MissionState {
  const { at } = ctx;
  const lead = ctx.leadId ?? 'edu';
  const up = (id: string) => ctx.parentOf(id) ?? (id === lead ? 'you' : lead);
  switch (event.type) {
    case 'run.start':
      return bus(m, { at, from: 'edu', to: 'crew', kind: 'run', text: `run started · ${event.goal}` });
    case 'run.end':
      return bus(m, { at, from: 'edu', to: 'you', kind: 'run', text: event.summary, ok: event.ok });
    case 'chat.user': {
      const text = oneLine(event.text);
      return text ? bus(m, { at, from: 'you', to: 'edu', kind: 'message', text }) : m;
    }
    case 'agent.spawn': {
      const parent = event.parentId ?? 'edu';
      // Edu answering in chat "spawns" itself: `edu → edu` says nothing, the user's line already did.
      const next = parent === event.agentId ? m : bus(m, { at, from: parent, to: event.agentId, kind: 'spawn', text: event.task });
      return progress(pulse(next, ctx, event.agentId, 'out', 'spawn'), event.agentId, ctx);
    }
    case 'agent.status':
      return progress(m, event.agentId, ctx);
    case 'agent.text': {
      const text = oneLine(event.text);
      if (!text) return m;
      const last = m.bus.at(-1);
      if (last && last.kind === 'message' && last.from === event.agentId) {
        const merged = { ...last, text: clip(`${last.text}${event.text.startsWith(' ') ? ' ' : ''}${text}`) };
        return { ...m, bus: [...m.bus.slice(0, -1), merged] };
      }
      const counted = count(m, event.agentId, 'turns');
      const next = bus(counted, { at, from: event.agentId, to: up(event.agentId), kind: 'message', text });
      return progress(pulse(next, ctx, event.agentId, 'in', 'message'), event.agentId, ctx);
    }
    case 'tool.call': {
      const counted = count(m, event.agentId, 'calls');
      const next = bus(counted, { at, from: event.agentId, to: event.tool, kind: 'tool', text: oneLine(event.input), callId: event.callId });
      return progress(pulse(next, ctx, event.agentId, 'in', 'tool'), event.agentId, ctx);
    }
    case 'tool.result': {
      const tool = toolName(m, event.agentId, event.callId);
      const next = bus(m, { at, from: tool, to: event.agentId, kind: event.ok ? 'result' : 'error', text: oneLine(event.output), ok: event.ok });
      return pulse(next, ctx, event.agentId, 'in', event.ok ? 'result' : 'error');
    }
    case 'approval.request': {
      const gate = { ...m.gate, requested: m.gate.requested + 1 };
      const next = bus({ ...m, gate }, { at, from: event.agentId, to: 'you', kind: 'approval', text: event.title });
      return pulse(next, ctx, event.agentId, 'in', 'approval');
    }
    case 'approval.resolve': {
      const gate = event.approved ? { ...m.gate, allowed: m.gate.allowed + 1 } : { ...m.gate, denied: m.gate.denied + 1 };
      const to = ctx.approvalAgent ?? lead;
      const verdict = `${event.approved ? 'approved' : 'rejected'} by ${event.by}`;
      const next = bus({ ...m, gate }, { at, from: event.by === 'user' ? 'you' : 'policy', to, kind: 'approval', text: verdict, ok: event.approved });
      return ctx.approvalAgent ? pulse(next, ctx, ctx.approvalAgent, 'out', 'approval') : next;
    }
    case 'brain.recall': {
      if (event.noteIds.length === 0) return m;
      const to = event.agentId ?? lead;
      return bus(m, { at, from: 'brain', to, kind: 'learning', text: `recalled ${event.noteIds.join(', ')}` });
    }
    case 'brain.learn':
      return bus(m, { at, from: lead, to: 'brain', kind: 'learning', text: `${event.noteId} · ${event.title}` });
    case 'agent.end': {
      const text = event.ok && sameText(event.summary, ctx.lastText?.(event.agentId)) ? 'done' : oneLine(event.summary);
      const next = bus(m, { at, from: event.agentId, to: up(event.agentId), kind: event.ok ? 'result' : 'error', text, ok: event.ok });
      return progress(pulse(next, ctx, event.agentId, 'in', event.ok ? 'result' : 'error'), event.agentId, ctx);
    }
    case 'error': {
      const from = event.agentId ?? 'edu';
      const next = bus(m, { at, from, to: event.agentId ? up(event.agentId) : 'you', kind: 'error', text: oneLine(event.message), ok: false });
      return event.agentId ? pulse(next, ctx, event.agentId, 'in', 'error') : next;
    }
    case 'spec.ready': {
      // Read structurally, like the core reducer: malformed specs must not break the view.
      const checks: unknown[] = Array.isArray(event.checks) ? event.checks : [];
      const reqs = Array.isArray(event.requirements) ? event.requirements.length : 0;
      const specChecks = checks.map((c) => (c as { id?: unknown })?.id).filter((id): id is string => typeof id === 'string');
      const text = `spec ready · ${reqs} reqs · ${checks.length} checks · ${String(event.path ?? '')}`;
      return bus({ ...m, specChecks }, { at, from: lead, to: 'you', kind: 'message', text });
    }
    case 'verify.result': {
      const id = event.checkId ?? event.method ?? `check-${m.checks.length + 1}`;
      const result: CheckResult = { id, ok: event.ok, kind: event.kind, requirementIds: event.requirementIds, output: event.output, at };
      const idx = m.checks.findIndex((c) => c.id === id);
      const checks = idx < 0 ? [...m.checks, result] : m.checks.map((c, i) => (i === idx ? result : c));
      return bus({ ...m, checks }, { at, from: 'verify', to: lead, kind: 'verify', text: `${id} · ${oneLine(event.output)}`, ok: event.ok });
    }
    case 'failure.attribution':
      return bus(m, { at, from: 'verify', to: lead, kind: 'error', text: `${event.failureType}: ${oneLine(event.observed)}`, ok: false });
    case 'intervention':
      return bus(m, { at, from: 'you', to: lead, kind: 'message', text: oneLine(event.action) });
    default:
      return m;
  }
}

/** Estimated completion for one agent, from its status and activity counts. */
export function estimateProgress(status: AgentStatus | undefined, activity: Pick<AgentActivity, 'calls' | 'turns' | 'progress'>): number {
  switch (status) {
    case undefined:
    case 'queued':
      return 0;
    case 'done':
      return 1;
    case 'failed':
    case 'cancelled':
      return activity.progress;
    default: {
      const steps = activity.calls + activity.turns;
      return Math.min(0.92, 0.08 + 0.84 * (1 - 0.72 ** steps));
    }
  }
}

// ─── Internals ───────────────────────────────────────────────────────────────

function bus(m: MissionState, entry: Omit<BusEntry, 'seq'>): MissionState {
  const seq = m.seq + 1;
  const list = [...m.bus, { ...entry, text: clip(entry.text), seq }];
  return { ...m, seq, bus: list.length > MAX_BUS_ENTRIES ? list.slice(list.length - MAX_BUS_ENTRIES) : list };
}

/** Adds a pulse on the agent's connector to the lead; the lead itself has none. */
function pulse(m: MissionState, ctx: MissionContext, agentId: string, dir: Pulse['dir'], kind: BusKind): MissionState {
  if (agentId === ctx.leadId || !ctx.leadId) return m;
  const last = m.pulses.findLast((p) => p.agentId === agentId && p.dir === dir);
  if (last && ctx.at - last.at < PULSE_GAP_MS) return m;
  const list = [...m.pulses, { seq: m.seq, agentId, at: ctx.at, dir, kind }];
  return { ...m, pulses: list.length > MAX_PULSES ? list.slice(list.length - MAX_PULSES) : list };
}

function activityOf(m: MissionState, id: string): AgentActivity {
  return m.activity[id] ?? { calls: 0, turns: 0, progress: 0 };
}

function count(m: MissionState, id: string, field: 'calls' | 'turns'): MissionState {
  const a = activityOf(m, id);
  return { ...m, activity: { ...m.activity, [id]: { ...a, [field]: a[field] + 1 } } };
}

function progress(m: MissionState, id: string, ctx: MissionContext): MissionState {
  const a = activityOf(m, id);
  const value = estimateProgress(ctx.agentStatus(id), a);
  if (m.activity[id] && value === a.progress) return m;
  return { ...m, activity: { ...m.activity, [id]: { ...a, progress: value } } };
}

/** The tool named by the matching call, so results read `Edit → builder`. */
function toolName(m: MissionState, agentId: string, callId: string): string {
  return m.bus.findLast((e) => e.kind === 'tool' && e.from === agentId && e.callId === callId)?.to ?? 'tool';
}

/** True when an end summary only repeats the agent's last text. */
export function sameText(summary: string, text: string | undefined): boolean {
  return text !== undefined && oneLine(summary) !== '' && oneLine(summary) === oneLine(text);
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}
