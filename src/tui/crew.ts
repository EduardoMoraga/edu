/**
 * Crew jobs as a live EduEvent stream for `edu watch`.
 *
 * `CrewSource` is the read-only seam the watcher needs; `fsCrewSource` reads
 * the job store directly from disk. Assumed format (written by `src/crew/`):
 *
 *   <brainRoot>/crew/<jobId>.json   job meta: { id, cli, task, status, createdAt,
 *                                    endedAt?, summary?, mode?, ... } where status is
 *                                    queued | running | done | failed | cancelled
 *   <jobId>.jsonl                   EduEvents, one JSON object per line, append-only
 *
 * Each job becomes one agent in the tree (id = jobId, role = "<cli> <id6>").
 * Agent events inside a job's stream are re-homed onto that agent, or onto a
 * namespaced child (`<jobId>/<agentId>`) when the stream spawned it. Job-level
 * run events and approvals are dropped: the watcher has its own run and
 * cannot answer a worker's approvals.
 */
import { open, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentStatus, CliId, EduEvent } from '../core/contracts.js';

export type CrewJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

/** The job fields the watcher reads (a structural subset of the store's CrewJob). */
export interface CrewJobInfo {
  id: string;
  cli: CliId;
  task: string;
  status: CrewJobStatus;
  createdAt?: string;
  endedAt?: string;
  summary?: string;
  mode?: 'pane' | 'headless';
}

export interface CrewChunk {
  events: EduEvent[];
  /** Pass back on the next read to receive only newer events. */
  offset: number;
}

export interface CrewSource {
  /** Every known job, any order. */
  list(): Promise<CrewJobInfo[]>;
  /** Events appended to a job's log after `offset` (0 = from the start). */
  read(jobId: string, offset: number): Promise<CrewChunk>;
}

const STATUSES: ReadonlySet<string> = new Set(['queued', 'running', 'done', 'failed', 'cancelled']);
const TERMINAL: ReadonlySet<CrewJobStatus> = new Set(['done', 'failed', 'cancelled']);

/** Reads `<brainRoot>/crew/*.json` and tails `<jobId>.jsonl` by byte offset. */
export function fsCrewSource(brainRoot: string, refresh?: (jobId: string) => Promise<unknown>): CrewSource {
  const dir = join(brainRoot, 'crew');
  return {
    async list() {
      let files: string[];
      try {
        files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
      } catch {
        return [];
      }
      const jobs = await Promise.all(files.map(async f => {
        const path = join(dir, f);
        const job = await readJob(path);
        if (job?.mode !== 'pane' || job.status !== 'running' || !refresh) return job;
        await refresh(job.id).catch(() => undefined);
        return (await readJob(path)) ?? job;
      }));
      return jobs.filter((j): j is CrewJobInfo => j !== undefined);
    },
    async read(jobId, offset) {
      if (!/^[\w.-]+$/.test(jobId)) return { events: [], offset };
      return tail(join(dir, `${jobId}.jsonl`), offset);
    },
  };
}

async function readJob(path: string): Promise<CrewJobInfo | undefined> {
  try {
    const raw: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!raw || typeof raw !== 'object') return undefined;
    const job = raw as Record<string, unknown>;
    if (typeof job.id !== 'string' || typeof job.status !== 'string' || !STATUSES.has(job.status)) return undefined;
    return {
      id: job.id,
      cli: String(job.cli ?? 'claude') as CliId,
      task: typeof job.task === 'string' ? job.task : '',
      status: job.status as CrewJobStatus,
      createdAt: typeof job.createdAt === 'string' ? job.createdAt : undefined,
      endedAt: typeof job.endedAt === 'string' ? job.endedAt : undefined,
      summary: typeof job.summary === 'string' ? job.summary : undefined,
      mode: job.mode === 'pane' ? 'pane' : 'headless',
    };
  } catch {
    return undefined; // missing, mid-write or malformed: picked up on a later poll
  }
}

/** Complete lines after `offset`; a trailing partial line waits for the next read. */
async function tail(path: string, offset: number): Promise<CrewChunk> {
  let handle;
  try {
    handle = await open(path, 'r');
  } catch {
    return { events: [], offset };
  }
  try {
    const { size } = await handle.stat();
    if (size <= offset) return { events: [], offset: Math.min(offset, size) };
    const buffer = Buffer.alloc(size - offset);
    await handle.read(buffer, 0, buffer.length, offset);
    const end = buffer.lastIndexOf(0x0a);
    if (end < 0) return { events: [], offset };
    const events: EduEvent[] = [];
    for (const line of buffer.subarray(0, end).toString('utf8').split('\n')) {
      const event = parseEvent(line);
      if (event) events.push(event);
    }
    return { events, offset: offset + end + 1 };
  } finally {
    await handle.close();
  }
}

function parseEvent(line: string): EduEvent | undefined {
  if (!line.trim()) return undefined;
  try {
    const value: unknown = JSON.parse(line);
    return value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string' ? (value as EduEvent) : undefined;
  } catch {
    return undefined;
  }
}

export interface WatchOptions {
  /** Only this job (an id or a unique id prefix). */
  jobId?: string;
  /** Keep polling for new jobs and events. False = one pass, then end (non-TTY). */
  follow?: boolean;
  pollMs?: number;
  signal?: AbortSignal;
  /** Clock for synthetic events (tests). */
  now?: () => Date;
}

interface Tracked {
  job: CrewJobInfo;
  offset: number;
  spawned: Set<string>;
  ended: boolean;
}

/** Merges every matching job into one live stream for the App. */
export async function* watchCrew(source: CrewSource, opts: WatchOptions = {}): AsyncGenerator<EduEvent> {
  const now = () => (opts.now ?? (() => new Date()))().toISOString();
  const tracked = new Map<string, Tracked>();
  yield { type: 'run.start', runId: 'crew-watch', goal: opts.jobId ? `crew job ${opts.jobId}` : 'crew jobs', mode: 'crew', at: now() };
  let warned = false;
  while (!opts.signal?.aborted) {
    const jobs = (await source.list())
      .filter((j) => !opts.jobId || j.id === opts.jobId || j.id.startsWith(opts.jobId))
      .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
    if (opts.jobId && jobs.length === 0 && !warned) {
      warned = true;
      yield { type: 'error', message: `no crew job matches ${opts.jobId}`, at: now() };
    }
    for (const job of jobs) {
      let t = tracked.get(job.id);
      if (!t) {
        t = { job, offset: 0, spawned: new Set(), ended: false };
        tracked.set(job.id, t);
        const at = job.createdAt ?? now();
        yield { type: 'agent.spawn', agentId: job.id, role: `${job.cli} ${job.id.slice(0, 6)}`, cli: job.cli, task: job.task, at };
        if (job.status !== 'queued') yield { type: 'agent.status', agentId: job.id, status: 'running', at };
      } else if (t.job.status === 'queued' && job.status !== 'queued') {
        yield { type: 'agent.status', agentId: job.id, status: 'running', at: now() };
      }
      t.job = job;
      const chunk = await source.read(job.id, t.offset);
      t.offset = chunk.offset;
      for (const event of chunk.events) {
        const mapped = rehome(t, event);
        if (mapped) yield mapped;
      }
      if (TERMINAL.has(job.status) && !t.ended) {
        t.ended = true;
        const at = job.endedAt ?? now();
        if (job.status === 'cancelled') yield { type: 'agent.status', agentId: job.id, status: 'cancelled' satisfies AgentStatus, at };
        else yield { type: 'agent.end', agentId: job.id, ok: job.status === 'done', summary: job.summary ?? '', at };
      }
    }
    if (opts.follow === false) return;
    await sleep(opts.pollMs ?? 500, opts.signal);
  }
}

/** Maps one event from a job's own stream onto the watcher's agent tree. */
function rehome(t: Tracked, event: EduEvent): EduEvent | undefined {
  const jobId = t.job.id;
  const id = (agentId: string | undefined) => (agentId && t.spawned.has(agentId) ? `${jobId}/${agentId}` : jobId);
  switch (event.type) {
    case 'run.start':
    case 'run.end':
    case 'outcome':
    case 'task.define':
    case 'approval.request':
    case 'approval.resolve':
      return undefined;
    case 'agent.spawn':
      t.spawned.add(event.agentId);
      return { ...event, agentId: id(event.agentId), parentId: event.parentId && t.spawned.has(event.parentId) ? id(event.parentId) : jobId };
    case 'agent.end':
      if (id(event.agentId) === jobId) t.ended = true;
      return { ...event, agentId: id(event.agentId) };
    case 'agent.status':
    case 'agent.text':
    case 'agent.thinking':
    case 'tool.call':
    case 'tool.result':
    case 'usage':
      return { ...event, agentId: id(event.agentId) };
    case 'error':
    case 'context.usage':
    case 'brain.recall':
      return { ...event, agentId: id(event.agentId) };
    default:
      return event;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}
