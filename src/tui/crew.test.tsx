import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EduEvent } from '../core/contracts.js';
import { UNICODE_GLYPHS, createTheme } from '../identity/index.js';
import { App } from './App.js';
import { fsCrewSource, watchCrew, type CrewJobInfo } from './crew.js';

const JOB_A = '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const JOB_B = '22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const at = (s: number) => new Date(Date.UTC(2026, 9, 9, 12, 0, s)).toISOString();

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'edu-watch-'));
  await mkdir(join(root, 'crew'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeJob(job: CrewJobInfo & Record<string, unknown>, events: EduEvent[] = []) {
  await writeFile(join(root, 'crew', `${job.id}.json`), JSON.stringify(job));
  await writeFile(join(root, 'crew', `${job.id}.jsonl`), events.map((e) => `${JSON.stringify(e)}\n`).join(''));
}

async function collect(stream: AsyncIterable<EduEvent>): Promise<EduEvent[]> {
  const out: EduEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

describe('fsCrewSource', () => {
  it('lists valid jobs and skips malformed or temp files', async () => {
    await writeJob({ id: JOB_A, cli: 'codex', task: 'write tests', status: 'running', createdAt: at(0) });
    await writeFile(join(root, 'crew', 'broken.json'), '{nope');
    await writeFile(join(root, 'crew', `${JOB_B}.json.123.tmp`), '{}');
    const jobs = await fsCrewSource(root).list();
    expect(jobs.map((j) => j.id)).toEqual([JOB_A]);
  });

  it('tails complete lines only and resumes from the returned offset', async () => {
    await writeJob({ id: JOB_A, cli: 'codex', task: 't', status: 'running' });
    const file = join(root, 'crew', `${JOB_A}.jsonl`);
    const source = fsCrewSource(root);
    await appendFile(file, `${JSON.stringify({ type: 'agent.text', agentId: 'x', text: 'one', at: at(1) })}\n{"type":"agent.te`);
    const first = await source.read(JOB_A, 0);
    expect(first.events).toHaveLength(1);
    await appendFile(file, `xt","agentId":"x","text":"two","at":"${at(2)}"}\nnot json\n`);
    const second = await source.read(JOB_A, first.offset);
    expect(second.events.map((e) => (e as { text?: string }).text)).toEqual(['two']);
  });

  it('returns nothing for a missing crew directory or unsafe ids', async () => {
    expect(await fsCrewSource(join(root, 'nowhere')).list()).toEqual([]);
    expect((await fsCrewSource(root).read('../etc/passwd', 0)).events).toEqual([]);
  });
});

describe('watchCrew', () => {
  it('turns each job into an agent and re-homes its events', async () => {
    await writeJob({ id: JOB_A, cli: 'codex', task: 'write tests', status: 'done', createdAt: at(0), summary: 'tests added' }, [
      { type: 'run.start', runId: 'inner', goal: 'x', mode: 'solo', at: at(0) },
      { type: 'agent.text', agentId: 'engine-1', text: 'working on it', at: at(1) },
      { type: 'approval.request', agentId: 'engine-1', approvalId: 'a', title: 't', detail: 'd', at: at(1) },
    ]);
    const events = await collect(watchCrew(fsCrewSource(root), { follow: false, now: () => new Date(at(9)) }));
    expect(events.map((e) => e.type)).toEqual(['run.start', 'agent.spawn', 'agent.status', 'agent.text', 'agent.end']);
    expect(events[1]).toMatchObject({ agentId: JOB_A, role: 'codex 111111', cli: 'codex', task: 'write tests' });
    expect(events[3]).toMatchObject({ agentId: JOB_A, text: 'working on it' });
    expect(events[4]).toMatchObject({ agentId: JOB_A, ok: true, summary: 'tests added' });
  });

  it('filters by job id prefix and reports an unknown id', async () => {
    await writeJob({ id: JOB_A, cli: 'codex', task: 'a', status: 'running', createdAt: at(0) });
    await writeJob({ id: JOB_B, cli: 'claude', task: 'b', status: 'running', createdAt: at(1) });
    const only = await collect(watchCrew(fsCrewSource(root), { jobId: '2222', follow: false }));
    expect(only.filter((e) => e.type === 'agent.spawn').map((e) => (e as { agentId: string }).agentId)).toEqual([JOB_B]);
    const none = await collect(watchCrew(fsCrewSource(root), { jobId: 'zzz', follow: false }));
    expect(none.at(-1)).toMatchObject({ type: 'error', message: 'no crew job matches zzz' });
  });

  it('follows new jobs and appended events until aborted', async () => {
    await writeJob({ id: JOB_A, cli: 'codex', task: 'a', status: 'running', createdAt: at(0) });
    const abort = new AbortController();
    const seen: EduEvent[] = [];
    const done = (async () => {
      for await (const e of watchCrew(fsCrewSource(root), { pollMs: 10, signal: abort.signal })) seen.push(e);
    })();
    await new Promise((r) => setTimeout(r, 40));
    await appendFile(join(root, 'crew', `${JOB_A}.jsonl`), `${JSON.stringify({ type: 'agent.text', agentId: 'e', text: 'late', at: at(3) })}\n`);
    await writeJob({ id: JOB_B, cli: 'pi', task: 'b', status: 'queued', createdAt: at(4) });
    const until = Date.now() + 5000;
    const ready = () => seen.some((e) => e.type === 'agent.text' && e.text === 'late') && seen.some((e) => e.type === 'agent.spawn' && e.agentId === JOB_B);
    while (Date.now() < until && !ready()) await new Promise((r) => setTimeout(r, 25));
    abort.abort();
    await done;
    expect(seen.some((e) => e.type === 'agent.text' && e.text === 'late')).toBe(true);
    expect(seen.some((e) => e.type === 'agent.spawn' && e.agentId === JOB_B)).toBe(true);
  });

  it('renders several jobs as several agents in the live view', async () => {
    await writeJob({ id: JOB_A, cli: 'codex', task: 'write tests', status: 'running', createdAt: at(0) }, [
      { type: 'agent.text', agentId: 'e', text: 'codex output', at: at(1) },
    ]);
    await writeJob({ id: JOB_B, cli: 'claude', task: 'review diff', status: 'done', createdAt: at(1), summary: 'lgtm' });
    const abort = new AbortController();
    const view = render(
      <App events={watchCrew(fsCrewSource(root), { pollMs: 10, signal: abort.signal })} crew theme={createTheme(0)} glyphs={UNICODE_GLYPHS} columns={100} rows={30} />,
    );
    // Poll instead of a fixed sleep: slower runners (Windows CI) need more than one poll cycle.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !view.lastFrame()?.includes('claude 222222')) await new Promise((r) => setTimeout(r, 25));
    const frame = view.lastFrame()!;
    expect(frame).toContain('codex 111111');
    expect(frame).toContain('claude 222222');
    expect(frame).toContain('crew · codex+claude');
    abort.abort();
    view.unmount();
  });
});
