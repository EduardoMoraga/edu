/**
 * Pure TUI state: a reducer over the EduEvent stream plus small selectors.
 * No React, no I/O — the whole live view is a fold of events.
 */
import type {
  AgentStatus,
  CliId,
  EduEvent,
  OrchestrationMode,
  RoleId,
  TransitiveKind,
  Usage,
} from '../core/contracts.js';

export type LogEntry =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; callId: string; tool: string; input: string; state: 'pending' | 'ok' | 'failed'; output?: string }
  | { kind: 'approval'; title: string; approved?: boolean; by?: 'user' | 'policy' }
  | { kind: 'error'; message: string }
  | { kind: 'end'; ok: boolean; summary: string };

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Sum of reported costs; undefined while no event reported one. */
  costUsd?: number;
  /** True when at least one usage event had no cost (total is a lower bound). */
  costPartial: boolean;
}

export interface AgentView {
  id: string;
  parentId?: string;
  role: RoleId;
  cli?: CliId;
  model?: string;
  task: string;
  status: AgentStatus;
  spawnedAt: number;
  startedAt?: number;
  endedAt?: number;
  usage: AgentUsage;
  log: LogEntry[];
  summary?: string;
  sessionId?: string;
}

export interface PendingApproval {
  approvalId: string;
  agentId: string;
  title: string;
  detail: string;
  at: number;
}

export interface BrainActivity {
  /** Total note ids recalled across the run (with repeats). */
  recalls: number;
  /** Distinct recalled note ids, first-seen order. */
  recalledIds: string[];
  learnings: Array<{ noteId: string; kind: TransitiveKind | 'canonical-proposal' | 'episode'; title: string }>;
}

export interface RunView {
  runId?: string;
  goal?: string;
  mode?: OrchestrationMode;
  startedAt?: number;
  endedAt?: number;
  ok?: boolean;
  summary?: string;
}

export interface TuiState {
  run: RunView;
  agents: Record<string, AgentView>;
  /** Spawn order. */
  order: string[];
  approvals: PendingApproval[];
  brain: BrainActivity;
  errors: Array<{ agentId?: string; message: string; at: number }>;
  /** Timestamp (ms) of the newest event; the reducer's notion of "now". */
  now: number;
  focus: { agentId?: string; pinned: boolean };
}

/** Per-agent log cap; older entries are dropped to keep memory bounded. */
export const MAX_LOG_ENTRIES = 500;

export const initialState: TuiState = {
  run: {},
  agents: {},
  order: [],
  approvals: [],
  brain: { recalls: 0, recalledIds: [], learnings: [] },
  errors: [],
  now: 0,
  focus: { pinned: false },
};

const TERMINAL: ReadonlySet<AgentStatus> = new Set(['done', 'failed', 'cancelled']);

export function reduce(state: TuiState, event: EduEvent): TuiState {
  const at = parseAt(event.at, state.now);
  const s: TuiState = at > state.now ? { ...state, now: at } : state;

  switch (event.type) {
    case 'run.start':
      return { ...s, run: { ...s.run, runId: event.runId, goal: event.goal, mode: event.mode, startedAt: at } };
    case 'run.end':
      // A finished run can no longer act on pending approvals.
      return {
        ...s,
        approvals: [],
        run: { ...s.run, runId: s.run.runId ?? event.runId, endedAt: at, ok: event.ok, summary: event.summary },
      };
    case 'agent.spawn': {
      const prev = s.agents[event.agentId];
      const agent: AgentView = {
        ...(prev ?? newAgent(event.agentId, at)),
        parentId: event.parentId,
        role: event.role,
        cli: event.cli,
        model: event.model,
        task: event.task,
      };
      const next = putAgent(s, agent);
      return autoFocus(next, agent.id);
    }
    case 'agent.status': {
      const next = updateAgent(s, event.agentId, at, (a) => withStatus(a, event.status, at));
      return event.status === 'running' || event.status === 'awaiting-approval' ? autoFocus(next, event.agentId) : next;
    }
    case 'agent.text':
      return updateAgent(s, event.agentId, at, (a) => appendText(a, 'text', event.text));
    case 'agent.thinking':
      return updateAgent(s, event.agentId, at, (a) => appendText(a, 'thinking', event.text));
    case 'tool.call':
      return updateAgent(s, event.agentId, at, (a) =>
        pushLog(a, { kind: 'tool', callId: event.callId, tool: event.tool, input: event.input, state: 'pending' }),
      );
    case 'tool.result':
      return updateAgent(s, event.agentId, at, (a) => resolveTool(a, event.callId, event.ok, event.output));
    case 'usage':
      return updateAgent(s, event.agentId, at, (a) => ({ ...a, usage: addUsage(a.usage, event.usage) }));
    case 'approval.request': {
      const pending: PendingApproval = {
        approvalId: event.approvalId,
        agentId: event.agentId,
        title: event.title,
        detail: event.detail,
        at,
      };
      const withCard = {
        ...s,
        approvals: [...s.approvals.filter((p) => p.approvalId !== event.approvalId), pending],
      };
      return updateAgent(withCard, event.agentId, at, (a) => pushLog(a, { kind: 'approval', title: event.title }));
    }
    case 'approval.resolve': {
      const pending = s.approvals.find((p) => p.approvalId === event.approvalId);
      const rest = s.approvals.filter((p) => p.approvalId !== event.approvalId);
      const next = { ...s, approvals: rest };
      if (!pending) return next;
      return updateAgent(next, pending.agentId, at, (a) =>
        pushLog(a, { kind: 'approval', title: pending.title, approved: event.approved, by: event.by }),
      );
    }
    case 'brain.recall': {
      const seen = new Set(s.brain.recalledIds);
      const fresh: string[] = [];
      for (const id of event.noteIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        fresh.push(id);
      }
      return {
        ...s,
        brain: {
          ...s.brain,
          recalls: s.brain.recalls + event.noteIds.length,
          recalledIds: fresh.length ? [...s.brain.recalledIds, ...fresh] : s.brain.recalledIds,
        },
      };
    }
    case 'brain.learn':
      return {
        ...s,
        brain: {
          ...s.brain,
          learnings: [...s.brain.learnings, { noteId: event.noteId, kind: event.kind, title: event.title }],
        },
      };
    case 'agent.end': {
      // Approvals of an agent that already ended are moot.
      const open = s.approvals.filter((p) => p.agentId !== event.agentId);
      const base = open.length === s.approvals.length ? s : { ...s, approvals: open };
      return updateAgent(base, event.agentId, at, (a) => {
        const status: AgentStatus = a.status === 'cancelled' ? 'cancelled' : event.ok ? 'done' : 'failed';
        const ended = withStatus(a, status, at);
        return pushLog(
          { ...ended, summary: event.summary, sessionId: event.sessionId ?? a.sessionId },
          { kind: 'end', ok: event.ok, summary: event.summary },
        );
      });
    }
    case 'error': {
      const next = { ...s, errors: [...s.errors, { agentId: event.agentId, message: event.message, at }] };
      return event.agentId
        ? updateAgent(next, event.agentId, at, (a) => pushLog(a, { kind: 'error', message: event.message }))
        : next;
    }
    default:
      return s;
  }
}

/** Folds a list of events from the initial state. */
export function reduceAll(events: Iterable<EduEvent>, from: TuiState = initialState): TuiState {
  let state = from;
  for (const e of events) state = reduce(state, e);
  return state;
}

// ─── Internals ───────────────────────────────────────────────────────────────

function parseAt(at: string, fallback: number): number {
  const t = Date.parse(at);
  return Number.isNaN(t) ? fallback : t;
}

function newAgent(id: string, at: number): AgentView {
  return {
    id,
    role: id,
    task: '',
    status: 'queued',
    spawnedAt: at,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costPartial: false },
    log: [],
  };
}

function putAgent(s: TuiState, agent: AgentView): TuiState {
  const known = Boolean(s.agents[agent.id]);
  return {
    ...s,
    agents: { ...s.agents, [agent.id]: agent },
    order: known ? s.order : [...s.order, agent.id],
  };
}

/** Updates an agent, creating a placeholder when events precede its spawn. */
function updateAgent(s: TuiState, id: string, at: number, fn: (a: AgentView) => AgentView): TuiState {
  return putAgent(s, fn(s.agents[id] ?? newAgent(id, at)));
}

function autoFocus(s: TuiState, agentId: string): TuiState {
  if (s.focus.pinned) return s;
  return { ...s, focus: { agentId, pinned: false } };
}

function withStatus(a: AgentView, status: AgentStatus, at: number): AgentView {
  const next: AgentView = { ...a, status };
  if (status === 'running' && a.startedAt === undefined) next.startedAt = at;
  if (TERMINAL.has(status)) {
    if (a.endedAt === undefined) next.endedAt = at;
  } else {
    next.endedAt = undefined;
  }
  return next;
}

function pushLog(a: AgentView, entry: LogEntry): AgentView {
  const log = [...a.log, entry];
  return { ...a, log: log.length > MAX_LOG_ENTRIES ? log.slice(log.length - MAX_LOG_ENTRIES) : log };
}

/** Consecutive text (or thinking) chunks merge into one entry: engines stream deltas. */
function appendText(a: AgentView, kind: 'text' | 'thinking', text: string): AgentView {
  const last = a.log[a.log.length - 1];
  if (last && last.kind === kind) {
    const merged = { kind, text: last.text + text };
    return { ...a, log: [...a.log.slice(0, -1), merged] };
  }
  return pushLog(a, { kind, text });
}

function resolveTool(a: AgentView, callId: string, ok: boolean, output: string): AgentView {
  for (let i = a.log.length - 1; i >= 0; i--) {
    const e = a.log[i];
    if (e && e.kind === 'tool' && e.callId === callId) {
      const log = a.log.slice();
      log[i] = { ...e, state: ok ? 'ok' : 'failed', output };
      return { ...a, log };
    }
  }
  return pushLog(a, { kind: 'tool', callId, tool: 'tool', input: '', state: ok ? 'ok' : 'failed', output });
}

function addUsage(u: AgentUsage, d: Usage): AgentUsage {
  return {
    inputTokens: u.inputTokens + safe(d.inputTokens),
    outputTokens: u.outputTokens + safe(d.outputTokens),
    cacheReadTokens: u.cacheReadTokens + safe(d.cacheReadTokens),
    cacheWriteTokens: u.cacheWriteTokens + safe(d.cacheWriteTokens),
    costUsd: d.costUsd === undefined ? u.costUsd : (u.costUsd ?? 0) + safe(d.costUsd),
    costPartial: u.costPartial || d.costUsd === undefined,
  };
}

function safe(n: number | undefined): number {
  return n !== undefined && Number.isFinite(n) && n > 0 ? n : 0;
}
