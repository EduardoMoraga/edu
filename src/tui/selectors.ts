/**
 * Pure selectors and UI-driven focus transitions over TuiState.
 */
import type { CliId } from '../core/contracts.js';
import type { AgentView, TuiState } from './state.js';

export interface TreeRow {
  agent: AgentView;
  depth: number;
  /** Ancestor continuation flags (true = ancestor has later siblings). */
  rails: boolean[];
  last: boolean;
}

/** Depth-first rows: roots in spawn order, children under their parent. */
export function agentTree(state: TuiState): TreeRow[] {
  const children = new Map<string | undefined, string[]>();
  for (const id of state.order) {
    const a = state.agents[id];
    if (!a) continue;
    const parent = a.parentId && state.agents[a.parentId] && a.parentId !== a.id ? a.parentId : undefined;
    children.set(parent, [...(children.get(parent) ?? []), id]);
  }
  const rows: TreeRow[] = [];
  const visit = (parent: string | undefined, depth: number, rails: boolean[], seen: Set<string>) => {
    const ids = children.get(parent) ?? [];
    ids.forEach((id, i) => {
      const agent = state.agents[id];
      if (!agent || seen.has(id)) return;
      seen.add(id);
      const last = i === ids.length - 1;
      rows.push({ agent, depth, rails, last });
      visit(id, depth + 1, depth === 0 ? [] : [...rails, !last], seen);
    });
  };
  visit(undefined, 0, [], new Set());
  return rows;
}

export function focusedAgent(state: TuiState): AgentView | undefined {
  const id = state.focus.agentId ?? state.order[0];
  return id ? state.agents[id] : undefined;
}

/** Pins focus to an agent (user selection). */
export function selectAgent(state: TuiState, agentId: string): TuiState {
  if (!state.agents[agentId]) return state;
  return { ...state, focus: { agentId, pinned: true } };
}

/** Moves focus by `delta` rows in tree order, wrapping around. */
export function moveFocus(state: TuiState, delta: number): TuiState {
  const rows = agentTree(state);
  if (rows.length === 0) return state;
  const current = focusedAgent(state)?.id;
  const idx = Math.max(0, rows.findIndex((r) => r.agent.id === current));
  const next = rows[(((idx + delta) % rows.length) + rows.length) % rows.length];
  return next ? selectAgent(state, next.agent.id) : state;
}

/** Wall time an agent has been active, using the reducer clock unless `now` is given. */
export function agentElapsed(agent: AgentView, now: number): number {
  const start = agent.startedAt ?? agent.spawnedAt;
  return Math.max(0, (agent.endedAt ?? now) - start);
}

export function agentTokens(agent: AgentView): number {
  const u = agent.usage;
  return u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens;
}

export interface RunTotals {
  tokens: number;
  costUsd?: number;
  costPartial: boolean;
  agents: number;
  running: number;
}

export function runTotals(state: TuiState): RunTotals {
  let tokens = 0;
  let cost: number | undefined;
  let partial = false;
  let running = 0;
  for (const id of state.order) {
    const a = state.agents[id];
    if (!a) continue;
    tokens += agentTokens(a);
    if (a.usage.costUsd !== undefined) cost = (cost ?? 0) + a.usage.costUsd;
    if (a.usage.costPartial) partial = true;
    if (a.status === 'running' || a.status === 'awaiting-approval') running += 1;
  }
  return { tokens, costUsd: cost, costPartial: partial, agents: state.order.length, running };
}

/** Distinct CLIs in spawn order, e.g. ["claude"] in solo mode. */
export function runClis(state: TuiState): CliId[] {
  const out: CliId[] = [];
  for (const id of state.order) {
    const cli = state.agents[id]?.cli;
    if (cli && !out.includes(cli)) out.push(cli);
  }
  return out;
}
