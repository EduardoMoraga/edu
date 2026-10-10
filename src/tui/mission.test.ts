import { describe, expect, it } from 'vitest';
import type { EduEvent } from '../core/contracts.js';
import { fixtureAt } from './fixtures.js';
import { MAX_PULSES, estimateProgress } from './mission.js';
import { reduceAll } from './state.js';

const at = fixtureAt;
const crew = (): EduEvent[] => [
  { type: 'run.start', runId: 'r', goal: 'g', mode: 'crew', at: at(0) },
  { type: 'agent.spawn', agentId: 'lead', role: 'lead', cli: 'claude', task: 'plan', at: at(0) },
  { type: 'agent.status', agentId: 'lead', status: 'running', at: at(0) },
  { type: 'agent.spawn', agentId: 'b1', parentId: 'lead', role: 'builder', cli: 'codex', task: 'build', at: at(1) },
];

describe('mission reducer: message bus', () => {
  it('logs spawns, tool calls and named results in order', () => {
    const s = reduceAll([
      ...crew(),
      { type: 'tool.call', agentId: 'b1', callId: 'c1', tool: 'Edit', input: 'src/a.ts\nline two', at: at(2) },
      { type: 'tool.result', agentId: 'b1', callId: 'c1', ok: false, output: 'stale hash', at: at(3) },
    ]);
    const rows = s.mission.bus.map((e) => [e.from, e.to, e.kind, e.text]);
    expect(rows).toEqual([
      ['edu', 'crew', 'run', 'run started · g'],
      ['edu', 'lead', 'spawn', 'plan'],
      ['lead', 'b1', 'spawn', 'build'],
      ['b1', 'Edit', 'tool', 'src/a.ts line two'],
      ['Edit', 'b1', 'error', 'stale hash'],
    ]);
    expect(s.mission.bus.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
  });
  it('merges streamed text from the same agent into one message', () => {
    const s = reduceAll([
      ...crew(),
      { type: 'agent.text', agentId: 'b1', text: 'Hello', at: at(2) },
      { type: 'agent.text', agentId: 'b1', text: ' world', at: at(2) },
    ]);
    const last = s.mission.bus.at(-1)!;
    expect(last).toMatchObject({ from: 'b1', to: 'lead', kind: 'message', text: 'Hello world' });
    expect(s.mission.activity.b1?.turns).toBe(1);
  });
  it('colors learning, approvals, verification and errors by kind', () => {
    const s = reduceAll([
      ...crew(),
      { type: 'brain.recall', agentId: 'b1', noteIds: ['D-a', 'L-b'], at: at(2) },
      { type: 'brain.learn', noteId: 'L-new', kind: 'lesson', title: 'A lesson', at: at(3) },
      { type: 'approval.request', agentId: 'b1', approvalId: 'a1', title: 'write?', detail: '', at: at(4) },
      { type: 'approval.resolve', approvalId: 'a1', approved: false, by: 'user', at: at(5) },
      { type: 'verify.result', checkId: 'unit', requirementIds: ['R1'], ok: true, output: '3 passed', kind: 'deterministic', at: at(6) },
      { type: 'error', message: 'engine missing', at: at(7) },
    ]);
    const tail = s.mission.bus.slice(-6).map((e) => [e.from, e.to, e.kind, e.ok]);
    expect(tail).toEqual([
      ['brain', 'b1', 'learning', undefined],
      ['lead', 'brain', 'learning', undefined],
      ['b1', 'you', 'approval', undefined],
      ['you', 'b1', 'approval', false],
      ['verify', 'lead', 'verify', true],
      ['edu', 'you', 'error', false],
    ]);
  });
});

describe('mission reducer: progress', () => {
  it('follows the documented heuristic', () => {
    expect(estimateProgress('queued', { calls: 9, turns: 9, progress: 0.5 })).toBe(0);
    expect(estimateProgress('running', { calls: 0, turns: 0, progress: 0 })).toBeCloseTo(0.08);
    expect(estimateProgress('running', { calls: 2, turns: 1, progress: 0 })).toBeCloseTo(0.08 + 0.84 * (1 - 0.72 ** 3));
    expect(estimateProgress('running', { calls: 500, turns: 0, progress: 0 })).toBeCloseTo(0.92);
    expect(estimateProgress('done', { calls: 0, turns: 0, progress: 0.1 })).toBe(1);
    expect(estimateProgress('failed', { calls: 4, turns: 0, progress: 0.4 })).toBe(0.4);
  });
  it('is 0 queued, rises with tool calls while running, and 100% when done', () => {
    const events = crew();
    expect(reduceAll(events).mission.activity.b1?.progress).toBe(0);
    const running = [...events, { type: 'agent.status', agentId: 'b1', status: 'running', at: at(2) } as EduEvent];
    const p0 = reduceAll(running).mission.activity.b1!.progress;
    const calls = [
      ...running,
      { type: 'tool.call', agentId: 'b1', callId: 'c1', tool: 'Read', input: 'a', at: at(3) },
      { type: 'tool.call', agentId: 'b1', callId: 'c2', tool: 'Read', input: 'b', at: at(4) },
    ] as EduEvent[];
    const p2 = reduceAll(calls).mission.activity.b1!.progress;
    expect(p2).toBeGreaterThan(p0);
    expect(p2).toBeLessThan(1);
    const done = reduceAll([...calls, { type: 'agent.end', agentId: 'b1', ok: true, summary: 'ok', at: at(5) }]);
    expect(done.mission.activity.b1?.progress).toBe(1);
    const failed = reduceAll([...calls, { type: 'agent.end', agentId: 'b1', ok: false, summary: 'no', at: at(5) }]);
    expect(failed.mission.activity.b1?.progress).toBeCloseTo(p2);
  });
});

describe('mission reducer: pulses', () => {
  it('pulses agent → lead for agent output and lead → agent for spawns and verdicts', () => {
    const s = reduceAll([
      ...crew(),
      { type: 'tool.call', agentId: 'b1', callId: 'c1', tool: 'Read', input: 'a', at: at(2) },
      { type: 'approval.request', agentId: 'b1', approvalId: 'a1', title: 't', detail: '', at: at(3) },
      { type: 'approval.resolve', approvalId: 'a1', approved: true, by: 'user', at: at(4) },
    ]);
    expect(s.mission.pulses.map((p) => [p.agentId, p.dir, p.kind, p.at])).toEqual([
      ['b1', 'out', 'spawn', Date.parse(at(1))],
      ['b1', 'in', 'tool', Date.parse(at(2))],
      ['b1', 'in', 'approval', Date.parse(at(3))],
      ['b1', 'out', 'approval', Date.parse(at(4))],
    ]);
  });
  it('never pulses the lead itself and merges bursts on one connector', () => {
    const t = Date.parse(at(2));
    const burst = Array.from({ length: 5 }, (_, i): EduEvent => ({
      type: 'tool.call', agentId: 'b1', callId: `c${i}`, tool: 'Read', input: 'a', at: new Date(t + i * 10).toISOString(),
    }));
    const s = reduceAll([...crew(), { type: 'tool.call', agentId: 'lead', callId: 'l1', tool: 'Read', input: 'x', at: at(2) }, ...burst]);
    expect(s.mission.pulses.filter((p) => p.agentId === 'lead')).toHaveLength(0);
    expect(s.mission.pulses.filter((p) => p.dir === 'in')).toHaveLength(1);
  });
  it('keeps a bounded pulse history', () => {
    const many = Array.from({ length: 60 }, (_, i): EduEvent => ({
      type: 'tool.call', agentId: 'b1', callId: `c${i}`, tool: 'Read', input: 'a', at: at(10 + i),
    }));
    expect(reduceAll([...crew(), ...many]).mission.pulses).toHaveLength(MAX_PULSES);
  });
});

describe('mission reducer: gate and checks', () => {
  it('counts allowed and denied approvals', () => {
    const s = reduceAll([
      ...crew(),
      { type: 'approval.request', agentId: 'b1', approvalId: 'a1', title: 't1', detail: '', at: at(2) },
      { type: 'approval.request', agentId: 'b1', approvalId: 'a2', title: 't2', detail: '', at: at(3) },
      { type: 'approval.resolve', approvalId: 'a1', approved: true, by: 'policy', at: at(4) },
    ]);
    expect(s.mission.gate).toEqual({ requested: 2, allowed: 1, denied: 0 });
    expect(s.approvals.map((a) => a.approvalId)).toEqual(['a2']);
    const denied = reduceAll([...crew(), { type: 'approval.request', agentId: 'b1', approvalId: 'a1', title: 't', detail: '', at: at(2) }, { type: 'approval.resolve', approvalId: 'a1', approved: false, by: 'user', at: at(3) }]);
    expect(denied.mission.gate.denied).toBe(1);
  });
  it('tracks spec checks as pending until a newest-wins verify result arrives', () => {
    const s = reduceAll([
      ...crew(),
      {
        type: 'spec.ready', path: 'spec.md', requirements: [{ id: 'R1', text: 'x' }], steps: [],
        checks: [{ id: 'unit', requirementIds: ['R1'], command: 'npm test', expect: {}, timeoutMs: 1 }, { id: 'lint', requirementIds: ['R1'], command: 'npm run lint', expect: {}, timeoutMs: 1 }],
        at: at(2),
      },
      { type: 'verify.result', checkId: 'unit', requirementIds: ['R1'], ok: false, output: '1 failed', kind: 'deterministic', at: at(3) },
      { type: 'verify.result', checkId: 'unit', requirementIds: ['R1'], ok: true, output: 'ok', kind: 'deterministic', at: at(4) },
    ]);
    expect(s.mission.specChecks).toEqual(['unit', 'lint']);
    expect(s.mission.checks.map((c) => [c.id, c.ok])).toEqual([['unit', true]]);
  });
});
