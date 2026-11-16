import { sumUsage } from '../core/usage.js';
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { atomicWrite } from '../brain/store.js';
import { WorkerOutputFilter, boundedWorkerPreview, createCrewArtifacts, redactWorkerOutput } from '../context/artifacts.js';
import type { CrewJob, EduEvent } from '../core/contracts.js';
import { processAlive } from '../platform/process-tree.js';
import { isCrewJobStatus, isTerminalCrewJobStatus } from './status.js';

export interface NewCrewJob extends Pick<CrewJob, 'cli' | 'task' | 'mode' | 'cwd' | 'autonomy'> {
  kind?: CrewJob['kind']; goal?: string; playbook?: string; orchestrationMode?: CrewJob['orchestrationMode'];
  harnessLevel?: CrewJob['harnessLevel']; autoApprove?: boolean; timeoutMinutes?: number;
}
export type CrewJobPatch = Partial<Pick<CrewJob, 'status' | 'pid' | 'paneId' | 'agentName' | 'endedAt' | 'pendingPrompt' | 'observedWorking' | 'promptSeq' | 'promptPaneHash' | 'promptedAt' | 'summary' | 'usage' | 'note' | 'outcome' | 'specPath' | 'verificationSummary'>>;

export interface CrewStore {
  create(input: NewCrewJob): Promise<CrewJob>;
  get(id: string): Promise<CrewJob | undefined>;
  list(): Promise<CrewJob[]>;
  update(id: string, patch: CrewJobPatch): Promise<CrewJob>;
  /**
   * Locked read-modify-write: `change` sees the current record and returns a patch, or undefined to leave
   * it alone. Use it whenever the patch depends on what the job says now (claiming a prompt, a sweep).
   */
  mutate(id: string, change: (current: CrewJob) => CrewJobPatch | undefined): Promise<CrewJob>;
  appendEvent(id: string, event: EduEvent): Promise<void>;
  flushOutput(id: string): Promise<void>;
  events(id: string): Promise<EduEvent[]>;
  decide(id: string, approve: boolean): Promise<void>;
  takeDecision(id: string): Promise<boolean | undefined>;
  artifact(id: string, kind: 'output' | 'summary', offset?: number, maxBytes?: number): ReturnType<ReturnType<typeof createCrewArtifacts>['read']>;
}

const LOCK_WAIT_MS = 10_000;
const LOCK_STALE_MS = 30_000;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Cross-process exclusion per job: `mkdir` is atomic on every platform. A lock is stale when its owner
 * process is gone or it is far older than any update takes, so a killed worker never wedges its job.
 */
async function withJobLock<T>(dir: string, body: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      await mkdir(dir);
      await writeFile(join(dir, 'owner'), String(process.pid));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    if (await staleLock(dir)) {
      // Claim by rename, so two waiters cannot both remove a lock a third one just took.
      const claimed = `${dir}.stale-${process.pid}-${randomUUID()}`;
      try { await rename(dir, claimed); await rm(claimed, { recursive: true, force: true }); } catch { /* another waiter won */ }
      continue;
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for the crew job lock: ${dir}`);
    await pause(10);
  }
  try { return await body(); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

async function staleLock(dir: string): Promise<boolean> {
  try {
    const age = Date.now() - (await stat(dir)).mtimeMs;
    const owner = Number((await readFile(join(dir, 'owner'), 'utf8').catch(() => '')).trim());
    if (Number.isInteger(owner) && owner > 0) return !processAlive(owner) || age > LOCK_STALE_MS;
    return age > 2000; // created but its owner never wrote: the creator died in between
  } catch {
    return false; // gone or unreadable: retry mkdir
  }
}

const safeId = (id: string) => {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error(`Invalid crew job id: ${id}`);
  return id;
};

export function createCrewStore(brainRoot: string): CrewStore {
  const root = join(brainRoot, 'crew');
  const artifacts = createCrewArtifacts(brainRoot);
  const outputFilters = new Map<string, WorkerOutputFilter>();
  const filterFor = (id: string) => {
    let filter = outputFilters.get(id);
    if (!filter) { filter = new WorkerOutputFilter(); outputFilters.set(id, filter); }
    return filter;
  };
  const flushOutput = async (id: string) => {
    const filter = outputFilters.get(id);
    if (!filter) return;
    const safe = filter.flush();
    if (safe) await artifacts.append(id, 'output', safe);
    outputFilters.delete(id);
  };
  const metaPath = (id: string) => join(root, `${safeId(id)}.json`);
  const eventPath = (id: string) => join(root, `${safeId(id)}.jsonl`);
  const decisionPath = (id: string) => join(root, `${safeId(id)}.decision`);
  const lockPath = (id: string) => join(root, `${safeId(id)}.lock`);
  const ensure = () => mkdir(root, { recursive: true });
  // The brain's atomic write retries the rename while Windows reports the target as held open (a status
  // poller reading the job), instead of failing the job with EPERM.
  async function atomicJson(path: string, value: unknown): Promise<void> {
    await ensure();
    await atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
  }
  return {
    async create(input) {
      const now = new Date().toISOString();
      const job: CrewJob = { ...input, task: redactWorkerOutput(input.task), goal: input.goal ? redactWorkerOutput(input.goal) : undefined, id: randomUUID(), status: 'queued', createdAt: now, summary: '', usage: sumUsage([]) };
      await artifacts.replace(job.id, 'output', '');
      await atomicJson(metaPath(job.id), job);
      await writeFile(eventPath(job.id), '', { flag: 'wx' });
      return job;
    },
    async get(input) {
      // Accept a unique id prefix (as printed by `edu crew status`) as well as the full id.
      let id = input;
      if (/^[a-f0-9-]{4,35}$/i.test(input)) {
        const { readdir } = await import('node:fs/promises');
        const matches = (await readdir(root).catch(() => [] as string[])).filter(f => f.endsWith('.json') && f.startsWith(input.toLowerCase()));
        if (matches.length > 1) throw new Error(`Ambiguous crew job id prefix: ${input}`);
        if (matches.length === 0) return undefined;
        id = matches[0]!.slice(0, -'.json'.length);
      }
      try {
        const job: unknown = JSON.parse(await readFile(metaPath(id), 'utf8'));
        if (!job || typeof job !== 'object' || !('id' in job) || !('status' in job) || !isCrewJobStatus((job as CrewJob).status)) throw new Error(`Invalid crew job record: ${id}`);
        return job as CrewJob;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    async list() {
      await ensure();
      const files = (await readdir(root)).filter(file => /^[a-f0-9-]{36}\.json$/i.test(file));
      const jobs = await Promise.all(files.map(file => this.get(file.slice(0, -5))));
      return jobs.filter((job): job is CrewJob => Boolean(job)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async update(id, patch) {
      return this.mutate(id, () => patch);
    },
    async mutate(id, change) {
      const found = await this.get(id);
      if (!found) throw new Error(`Crew job not found: ${id}`);
      await ensure();
      return withJobLock(lockPath(found.id), async () => {
      const current = await this.get(found.id);
      if (!current) throw new Error(`Crew job not found: ${id}`);
      const patch = change(current);
      if (!patch) return current;
      if (patch.status && !isCrewJobStatus(patch.status)) throw new Error(`Invalid crew job status: ${patch.status}`);
      // A finished job keeps its outcome: a late worker write cannot turn `cancelled` back into `failed`.
      if (patch.status !== undefined && patch.status !== current.status && isTerminalCrewJobStatus(current.status)) return current;
      const safePatch = { ...patch };
      try {
        if (isTerminalCrewJobStatus(patch.status)) await flushOutput(current.id);
        if (typeof patch.summary === 'string') {
          await artifacts.replace(current.id, 'summary', patch.summary);
          safePatch.summary = boundedWorkerPreview(redactWorkerOutput(patch.summary), current.id);
        }
      } catch {
        // Preserve terminal state even when the artifact directory is unavailable.
        // Never put the raw summary into metadata as a fallback.
        safePatch.summary = '[summary unavailable: artifact persistence failed]';
        safePatch.status = 'failed';
        safePatch.endedAt ??= new Date().toISOString();
      }
      if (typeof patch.note === 'string') safePatch.note = redactWorkerOutput(patch.note);
      const updated = { ...current, ...safePatch };
      await atomicJson(metaPath(current.id), updated);
      return updated;
      });
    },
    async appendEvent(id, event) {
      const job = await this.get(id);
      if (!job) throw new Error(`Crew job not found: ${id}`);
      if (event.type === 'agent.text') {
        const safe = filterFor(job.id).push(event.text);
        if (safe) await artifacts.append(job.id, 'output', safe);
      } else if (event.type === 'agent.end' || event.type === 'run.end' || event.type === 'error') {
        await flushOutput(job.id);
      }
      const structural = new Set(['type', 'at', 'agentId', 'runId', 'approvalId', 'noteId', 'callId', 'sessionId', 'id']);
      const safeEvent = JSON.parse(JSON.stringify(event, (key, value: unknown) =>
        event.type === 'agent.text' && key === 'text' ? '[full stream in crew output artifact]'
          : value !== null && typeof value !== 'number' && typeof value !== 'boolean' && /(?:password|secret|token|api[_-]?key|credential)/i.test(key) ? '[REDACTED]'
            : typeof value === 'string' && !structural.has(key) ? redactWorkerOutput(value) : value)) as EduEvent;
      await appendFile(eventPath(job.id), `${JSON.stringify(safeEvent)}\n`, 'utf8');
    },
    async flushOutput(id) {
      const job = await this.get(id);
      if (!job) throw new Error(`Crew job not found: ${id}`);
      await flushOutput(job.id);
    },
    async events(id) {
      const job = await this.get(id);
      if (!job) throw new Error(`Crew job not found: ${id}`);
      const text = await readFile(eventPath(job.id), 'utf8');
      return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as EduEvent);
    },
    async decide(id, approve) {
      const job = await this.get(id);
      if (!job || job.kind !== 'orchestration') throw new Error(`Orchestration job not found: ${id}`);
      if (job.status !== 'awaiting-approval') throw new Error(`Crew job is not awaiting approval: ${id}`);
      await writeFile(decisionPath(job.id), approve ? 'approve' : 'reject', { flag: 'wx' });
    },
    async takeDecision(id) {
      const path = decisionPath(id);
      let value: string;
      try { value = await readFile(path, 'utf8'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
      if (value !== 'approve' && value !== 'reject') throw new Error(`Invalid approval decision for crew job: ${id}`);
      // Close the decision window before removing the one-shot file, so a
      // second command cannot authorize the next approval by accident.
      await this.update(id, { status: 'running' });
      await unlink(path);
      return value === 'approve';
    },
    async artifact(id, kind, offset, maxBytes) {
      const job = await this.get(id);
      if (!job) throw new Error(`Crew job not found: ${id}`);
      return artifacts.read(job.id, kind, offset, maxBytes);
    },
  };
}
