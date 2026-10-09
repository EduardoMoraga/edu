import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EduEvent } from '../core/contracts.js';
import { eventProblem, isEduEvent, loadRun, parseRunJsonl, timedEvents } from './replay.js';

const ev = (sec: number, text = 'x'): EduEvent => ({
  type: 'agent.text',
  agentId: 'a',
  text,
  at: new Date(Date.UTC(2026, 9, 8, 12, 0, sec)).toISOString(),
});

describe('parseRunJsonl', () => {
  it('parses valid lines and reports bad ones with line numbers', () => {
    const text = [
      JSON.stringify(ev(0)),
      '',
      '{not json',
      JSON.stringify({ type: 'nope', at: ev(0).at }),
      JSON.stringify({ type: 'tool.result', agentId: 'a', callId: 'c', ok: 'yes', output: '', at: ev(0).at }),
      JSON.stringify({ ...ev(1), at: 'yesterday' }),
      JSON.stringify(ev(2)),
    ].join('\r\n');
    const { events, issues } = parseRunJsonl(text);
    expect(events).toHaveLength(2);
    expect(issues).toEqual([
      { line: 3, message: 'invalid JSON' },
      { line: 4, message: 'unknown event type "nope"' },
      { line: 5, message: 'tool.result: field "ok" must be boolean' },
      { line: 6, message: 'agent.text: missing or invalid "at"' },
    ]);
  });
  it('accepts every contract event variant', () => {
    const at = ev(0).at;
    const all: EduEvent[] = [
      { type: 'run.start', runId: 'r', goal: 'g', mode: 'solo', at },
      { type: 'run.end', runId: 'r', ok: true, summary: 's', at },
      { type: 'agent.spawn', agentId: 'a', role: 'lead', cli: 'claude', task: 't', at },
      { type: 'agent.status', agentId: 'a', status: 'running', at },
      { type: 'agent.text', agentId: 'a', text: 't', at },
      { type: 'agent.thinking', agentId: 'a', text: 't', at },
      { type: 'tool.call', agentId: 'a', callId: 'c', tool: 'Read', input: 'f', at },
      { type: 'tool.result', agentId: 'a', callId: 'c', ok: true, output: 'o', at },
      { type: 'usage', agentId: 'a', usage: { inputTokens: 1, outputTokens: 1 }, at },
      { type: 'approval.request', agentId: 'a', approvalId: 'p', title: 't', detail: 'd', at },
      { type: 'approval.resolve', approvalId: 'p', approved: true, by: 'user', at },
      { type: 'brain.recall', noteIds: [], at },
      { type: 'brain.learn', noteId: 'L-x', kind: 'lesson', title: 't', at },
      { type: 'agent.end', agentId: 'a', ok: true, summary: 's', at },
      { type: 'error', message: 'm', at },
    ];
    expect(all.filter((e) => !isEduEvent(e))).toEqual([]);
    expect(eventProblem(null)).toBe('not an object');
  });
});

describe('loadRun', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });
  it('reads a run file from disk', async () => {
    dir = await mkdtemp(join(tmpdir(), 'edu-replay-'));
    const file = join(dir, 'r1.jsonl');
    await writeFile(file, `${JSON.stringify(ev(0))}\n${JSON.stringify(ev(1))}\n`);
    const run = await loadRun(file);
    expect(run.events).toHaveLength(2);
    expect(run.issues).toEqual([]);
  });
});

describe('timedEvents', () => {
  const collect = async (events: EduEvent[], opts: Parameters<typeof timedEvents>[1] = {}) => {
    const waits: number[] = [];
    const out: EduEvent[] = [];
    for await (const e of timedEvents(events, { ...opts, sleep: async (ms) => void waits.push(ms) })) out.push(e);
    return { waits, out };
  };
  it('reproduces original gaps divided by speed', async () => {
    const { waits, out } = await collect([ev(0), ev(2), ev(2), ev(5)], { speed: 2 });
    expect(out).toHaveLength(4);
    expect(waits).toEqual([1000, 1500]);
  });
  it('caps long idle gaps and ignores out-of-order timestamps', async () => {
    const { waits } = await collect([ev(0), ev(30), ev(10)], { maxDelayMs: 500 });
    expect(waits).toEqual([500]);
  });
  it('stops when aborted', async () => {
    const ctrl = new AbortController();
    const out: EduEvent[] = [];
    for await (const e of timedEvents([ev(0), ev(1), ev(2)], { signal: ctrl.signal, sleep: async () => undefined })) {
      out.push(e);
      ctrl.abort();
    }
    expect(out).toHaveLength(1);
  });
  it('waits for real with the default sleep', async () => {
    const start = Date.now();
    const out: EduEvent[] = [];
    for await (const e of timedEvents([ev(0), ev(1)], { speed: 50 })) out.push(e);
    expect(out).toHaveLength(2);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });
});
