import { describe, expect, it } from 'vitest';
import type { EduEvent } from '../core/contracts.js';
import {
  agentElapsed,
  agentTokens,
  agentTree,
  focusedAgent,
  moveFocus,
  runClis,
  runTotals,
  selectAgent,
} from './selectors.js';
import { MAX_LOG_ENTRIES, initialState, reduce, reduceAll } from './state.js';

const T0 = Date.parse('2026-10-08T12:00:00.000Z');
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();

const spawn = (agentId: string, role: string, sec: number, parentId?: string): EduEvent => ({
  type: 'agent.spawn',
  agentId,
  parentId,
  role,
  cli: 'claude',
  task: `${role} task`,
  at: at(sec),
});

const crew: EduEvent[] = [
  { type: 'run.start', runId: 'r1', goal: 'add oauth', mode: 'solo', at: at(0) },
  spawn('lead', 'lead', 0),
  spawn('exp', 'explorer', 1, 'lead'),
  spawn('bld', 'builder', 2, 'lead'),
  spawn('sub', 'explorer', 3, 'exp'),
];

describe('reduce: run lifecycle', () => {
  it('records run.start and run.end', () => {
    const s = reduceAll([
      crew[0]!,
      { type: 'run.end', runId: 'r1', ok: true, summary: 'shipped', at: at(90) },
    ]);
    expect(s.run).toMatchObject({ runId: 'r1', goal: 'add oauth', mode: 'solo', ok: true, summary: 'shipped' });
    expect(s.run.endedAt! - s.run.startedAt!).toBe(90_000);
    expect(s.now).toBe(T0 + 90_000);
  });
  it('does not move the clock backwards on out-of-order events', () => {
    const s = reduceAll([crew[0]!, spawn('lead', 'lead', 30), spawn('late', 'builder', 10)]);
    expect(s.now).toBe(T0 + 30_000);
  });
  it('retains the final evidence label and routes evidence into the focus log', () => {
    const state = reduceAll([
      spawn('builder', 'builder', 0),
      { type: 'verify.result', checkId: 'C1', requirementIds: ['R1'], ok: false, output: 'assertion failed', kind: 'deterministic', at: at(1) },
      { type: 'failure.attribution', observed: 'assertion failed', expected: 'success', failureType: 'verify', evidence: ['test'], alternatives: ['fixture'], next: 'inspect test', at: at(2) },
      { type: 'intervention', by: 'user', action: 'corrected task', detail: 'clarified', avoidable: true, harnessGap: 'context', at: at(3) },
      { type: 'outcome', label: 'assisted_verified_success', metrics: {}, at: at(4) },
      { type: 'run.end', runId: 'r', ok: true, summary: 'done', at: at(5) },
    ]);
    expect(state.run.outcomeLabel).toBe('assisted_verified_success');
    expect(state.agents.builder?.log.map(entry => entry.kind)).toEqual(['verify', 'attribution', 'intervention']);
  });
});

describe('reduce: agents', () => {
  it('builds a parent/child tree in spawn order', () => {
    const s = reduceAll(crew);
    expect(s.order).toEqual(['lead', 'exp', 'bld', 'sub']);
    const rows = agentTree(s).map((r) => [r.agent.id, r.depth, r.last, r.rails]);
    expect(rows).toEqual([
      ['lead', 0, true, []],
      ['exp', 1, false, []],
      ['sub', 2, true, [true]],
      ['bld', 1, true, []],
    ]);
  });
  it('treats unknown parents as roots and never loops', () => {
    const s = reduceAll([spawn('a', 'builder', 0, 'ghost'), spawn('b', 'reviewer', 1, 'b')]);
    expect(agentTree(s).map((r) => [r.agent.id, r.depth])).toEqual([
      ['a', 0],
      ['b', 0],
    ]);
  });
  it('tracks status transitions with start/end times', () => {
    const s = reduceAll([
      ...crew,
      { type: 'agent.status', agentId: 'bld', status: 'running', at: at(10) },
      { type: 'agent.status', agentId: 'bld', status: 'awaiting-approval', at: at(40) },
      { type: 'agent.status', agentId: 'bld', status: 'running', at: at(50) },
      { type: 'agent.status', agentId: 'bld', status: 'done', at: at(144) },
    ]);
    const bld = s.agents.bld!;
    expect(bld.status).toBe('done');
    expect(agentElapsed(bld, s.now + 999_999)).toBe(134_000);
  });
  it('measures running agents against the reducer clock', () => {
    const s = reduceAll([
      ...crew,
      { type: 'agent.status', agentId: 'exp', status: 'running', at: at(5) },
      { type: 'agent.text', agentId: 'lead', text: 'tick', at: at(65) },
    ]);
    expect(agentElapsed(s.agents.exp!, s.now)).toBe(60_000);
  });
  it('maps agent.end to done/failed and keeps cancelled', () => {
    const s = reduceAll([
      ...crew,
      { type: 'agent.end', agentId: 'exp', ok: true, summary: 'mapped', sessionId: 'sess-1', at: at(20) },
      { type: 'agent.end', agentId: 'bld', ok: false, summary: 'tests red', at: at(21) },
      { type: 'agent.status', agentId: 'sub', status: 'cancelled', at: at(22) },
      { type: 'agent.end', agentId: 'sub', ok: false, summary: 'stopped', at: at(23) },
    ]);
    expect(s.agents.exp).toMatchObject({ status: 'done', summary: 'mapped', sessionId: 'sess-1' });
    expect(s.agents.bld!.status).toBe('failed');
    expect(s.agents.sub!.status).toBe('cancelled');
    expect(s.agents.exp!.log.at(-1)).toEqual({ kind: 'end', ok: true, summary: 'mapped' });
  });
  it('creates a placeholder for events that precede the spawn, then fills it in', () => {
    const s = reduceAll([
      { type: 'agent.text', agentId: 'x', text: 'early', at: at(0) },
      spawn('x', 'reviewer', 1),
    ]);
    expect(s.order).toEqual(['x']);
    expect(s.agents.x).toMatchObject({ role: 'reviewer', task: 'reviewer task' });
    expect(s.agents.x!.log).toEqual([{ kind: 'text', text: 'early' }]);
  });
});

describe('reduce: focus log', () => {
  it('merges streamed text and thinking deltas', () => {
    const s = reduceAll([
      spawn('a', 'builder', 0),
      { type: 'agent.thinking', agentId: 'a', text: 'hmm ', at: at(1) },
      { type: 'agent.thinking', agentId: 'a', text: 'ok', at: at(1) },
      { type: 'agent.text', agentId: 'a', text: 'I added ', at: at(2) },
      { type: 'agent.text', agentId: 'a', text: 'the route.', at: at(2) },
    ]);
    expect(s.agents.a!.log).toEqual([
      { kind: 'thinking', text: 'hmm ok' },
      { kind: 'text', text: 'I added the route.' },
    ]);
  });
  it('pairs tool calls with their results by callId', () => {
    const s = reduceAll([
      spawn('a', 'builder', 0),
      { type: 'tool.call', agentId: 'a', callId: 'c1', tool: 'Edit', input: 'src/auth.ts', at: at(1) },
      { type: 'tool.call', agentId: 'a', callId: 'c2', tool: 'Bash', input: 'npm test', at: at(2) },
      { type: 'tool.result', agentId: 'a', callId: 'c1', ok: true, output: '12 lines', at: at(3) },
      { type: 'tool.result', agentId: 'a', callId: 'c2', ok: false, output: '1 failing', at: at(4) },
      { type: 'tool.result', agentId: 'a', callId: 'zz', ok: true, output: 'orphan', at: at(5) },
    ]);
    expect(s.agents.a!.log).toEqual([
      { kind: 'tool', callId: 'c1', tool: 'Edit', input: 'src/auth.ts', state: 'ok', output: '12 lines' },
      { kind: 'tool', callId: 'c2', tool: 'Bash', input: 'npm test', state: 'failed', output: '1 failing' },
      { kind: 'tool', callId: 'zz', tool: 'tool', input: '', state: 'ok', output: 'orphan' },
    ]);
  });
  it('caps the log length', () => {
    let s = reduce(initialState, spawn('a', 'builder', 0));
    for (let i = 0; i < MAX_LOG_ENTRIES + 20; i++) {
      s = reduce(s, { type: 'tool.call', agentId: 'a', callId: `c${i}`, tool: 'Read', input: String(i), at: at(1) });
    }
    expect(s.agents.a!.log).toHaveLength(MAX_LOG_ENTRIES);
    expect(s.agents.a!.log[0]).toMatchObject({ callId: 'c20' });
  });
  it('records errors globally and in the agent log', () => {
    const s = reduceAll([
      spawn('a', 'builder', 0),
      { type: 'error', agentId: 'a', message: 'boom', at: at(1) },
      { type: 'error', message: 'engine missing', at: at(2) },
    ]);
    expect(s.errors.map((e) => e.message)).toEqual(['boom', 'engine missing']);
    expect(s.agents.a!.log).toEqual([{ kind: 'error', message: 'boom' }]);
  });
});

describe('reduce: usage aggregation', () => {
  it('sums usage deltas per agent and across the run', () => {
    const s = reduceAll([
      ...crew,
      { type: 'usage', agentId: 'lead', usage: { inputTokens: 1000, outputTokens: 200, costUsd: 0.1 }, at: at(5) },
      {
        type: 'usage',
        agentId: 'lead',
        usage: { inputTokens: 500, outputTokens: 100, cacheReadTokens: 4000, cacheWriteTokens: 300, costUsd: 0.05 },
        at: at(6),
      },
      { type: 'usage', agentId: 'bld', usage: { inputTokens: 30_000, outputTokens: 2_000, costUsd: 0.27 }, at: at(7) },
    ]);
    expect(agentTokens(s.agents.lead!)).toBe(6100);
    expect(s.agents.lead!.usage.costUsd).toBeCloseTo(0.15);
    const totals = runTotals(s);
    expect(totals.tokens).toBe(38_100);
    expect(totals.costUsd).toBeCloseTo(0.42);
    expect(totals.costPartial).toBe(false);
    expect(totals.agents).toBe(4);
  });
  it('never guesses cost: unknown stays undefined, mixed is flagged partial', () => {
    const unknown = reduceAll([
      spawn('a', 'builder', 0),
      { type: 'usage', agentId: 'a', usage: { inputTokens: 10, outputTokens: 5 }, at: at(1) },
    ]);
    expect(runTotals(unknown).costUsd).toBeUndefined();
    const mixed = reduce(unknown, {
      type: 'usage',
      agentId: 'a',
      usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.02 },
      at: at(2),
    });
    expect(runTotals(mixed)).toMatchObject({ costUsd: 0.02, costPartial: true });
  });
  it('ignores negative or non-finite values', () => {
    const s = reduceAll([
      spawn('a', 'builder', 0),
      { type: 'usage', agentId: 'a', usage: { inputTokens: -5, outputTokens: Number.NaN }, at: at(1) },
    ]);
    expect(agentTokens(s.agents.a!)).toBe(0);
  });
  it('counts running agents and distinct CLIs', () => {
    const s = reduceAll([
      spawn('a', 'builder', 0),
      { ...spawn('b', 'reviewer', 1), cli: 'codex' } as EduEvent,
      { type: 'agent.status', agentId: 'a', status: 'running', at: at(2) },
    ]);
    expect(runTotals(s).running).toBe(1);
    expect(runClis(s)).toEqual(['claude', 'codex']);
  });
});

describe('reduce: approvals', () => {
  const request: EduEvent = {
    type: 'approval.request',
    agentId: 'bld',
    approvalId: 'ap1',
    title: 'builder wants to write 3 files',
    detail: 'src/a.ts\nsrc/b.ts\nsrc/c.ts',
    at: at(30),
  };
  it('queues a pending approval and logs it on the agent', () => {
    const s = reduceAll([...crew, request]);
    expect(s.approvals).toEqual([
      { approvalId: 'ap1', agentId: 'bld', title: request.title, detail: (request as { detail: string }).detail, at: T0 + 30_000 },
    ]);
    expect(s.agents.bld!.log.at(-1)).toEqual({ kind: 'approval', title: request.title });
  });
  it('deduplicates repeated requests with the same id', () => {
    expect(reduceAll([...crew, request, request]).approvals).toHaveLength(1);
  });
  it('resolves an approval and records the outcome', () => {
    const s = reduceAll([
      ...crew,
      request,
      { type: 'approval.resolve', approvalId: 'ap1', approved: true, by: 'user', at: at(35) },
    ]);
    expect(s.approvals).toEqual([]);
    expect(s.agents.bld!.log.at(-1)).toEqual({ kind: 'approval', title: request.title, approved: true, by: 'user' });
  });
  it('drops pending approvals when their agent or the run ends', () => {
    const other: EduEvent = { ...request, approvalId: 'ap2', agentId: 'exp' } as EduEvent;
    const afterAgent = reduceAll([...crew, request, other, { type: 'agent.end', agentId: 'bld', ok: true, summary: 'ok', at: at(40) }]);
    expect(afterAgent.approvals.map((p) => p.approvalId)).toEqual(['ap2']);
    const afterRun = reduce(afterAgent, { type: 'run.end', runId: 'r1', ok: true, summary: 'done', at: at(41) });
    expect(afterRun.approvals).toEqual([]);
  });
  it('ignores resolutions for unknown approvals', () => {
    const s = reduceAll([...crew, { type: 'approval.resolve', approvalId: 'nope', approved: false, by: 'policy', at: at(1) }]);
    expect(s.approvals).toEqual([]);
  });
});

describe('reduce: brain', () => {
  it('counts recalls and keeps distinct ids', () => {
    const s = reduceAll([
      { type: 'brain.recall', noteIds: ['L-a', 'D-b'], at: at(1) },
      { type: 'brain.recall', agentId: 'lead', noteIds: ['L-a', 'C-c'], at: at(2) },
    ]);
    expect(s.brain.recalls).toBe(4);
    expect(s.brain.recalledIds).toEqual(['L-a', 'D-b', 'C-c']);
  });
  it('appends learnings in order', () => {
    const s = reduceAll([
      { type: 'brain.learn', noteId: 'L-small-prs', kind: 'lesson', title: 'Prefer small PRs', at: at(1) },
      { type: 'brain.learn', noteId: 'E-1', kind: 'episode', title: 'Session closed', at: at(2) },
    ]);
    expect(s.brain.learnings.map((l) => l.kind)).toEqual(['lesson', 'episode']);
  });
});

describe('focus', () => {
  const running: EduEvent[] = [
    ...crew,
    { type: 'agent.status', agentId: 'bld', status: 'running', at: at(5) },
  ];
  it('follows the most recently active agent until the user pins one', () => {
    const s = reduceAll(running);
    expect(focusedAgent(s)?.id).toBe('bld');
    const pinned = selectAgent(s, 'exp');
    const after = reduce(pinned, { type: 'agent.status', agentId: 'sub', status: 'running', at: at(6) });
    expect(focusedAgent(after)?.id).toBe('exp');
  });
  it('moves through tree order and wraps', () => {
    const s = selectAgent(reduceAll(running), 'lead');
    expect(focusedAgent(moveFocus(s, 1))?.id).toBe('exp');
    expect(focusedAgent(moveFocus(s, 2))?.id).toBe('sub');
    expect(focusedAgent(moveFocus(s, -1))?.id).toBe('bld');
  });
  it('ignores selection of unknown agents and empty trees', () => {
    expect(selectAgent(initialState, 'x')).toBe(initialState);
    expect(moveFocus(initialState, 1)).toBe(initialState);
    expect(focusedAgent(initialState)).toBeUndefined();
  });
});
