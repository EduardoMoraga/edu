import { sumUsage } from '../core/usage.js';
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { ensureLocalIgnored, folderKey, LOCAL_DIR } from '../brain/local-dir.js';
import { atomicWrite, exclusiveWrite, isAlreadyExists } from '../brain/store.js';
import { retryFs } from '../platform/fs-retry.js';
import { WorkerOutputFilter, boundedWorkerPreview, createCrewArtifacts, redactWorkerOutput } from '../context/artifacts.js';
import type { Autonomy, CliId, CrewApproval, CrewDecisionBy, CrewJob, CrewJobMode, CrewJobStatus, EduEvent } from '../core/contracts.js';
import { processAlive } from '../platform/process-tree.js';
import { isCrewJobStatus, isTerminalCrewJobStatus } from './status.js';

export interface NewCrewJob extends Pick<CrewJob, 'cli' | 'task' | 'mode' | 'cwd' | 'autonomy'> {
  kind?: CrewJob['kind']; goal?: string; playbook?: string; orchestrationMode?: CrewJob['orchestrationMode'];
  harnessLevel?: CrewJob['harnessLevel']; autoApprove?: boolean; allowUnregisteredChecks?: boolean; timeoutMinutes?: number;
}
export type CrewJobPatch = Partial<Pick<CrewJob, 'status' | 'approval' | 'pid' | 'paneId' | 'agentName' | 'endedAt' | 'pendingPrompt' | 'observedWorking' | 'promptSeq' | 'promptPaneHash' | 'promptedAt' | 'summary' | 'usage' | 'note' | 'outcome' | 'specPath' | 'verificationSummary'>>;

/** A decision for one approval gate: it must name that gate's `requestId`. */
export interface CrewDecisionInput { requestId: string; by: CrewDecisionBy; env?: NodeJS.ProcessEnv }
export interface CrewDecision { approve: boolean; by: CrewDecisionBy }
export interface OpenApprovalInput { title: string; unregisteredChecks?: string[] }

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
  /**
   * Opens an approval gate: a fresh `requestId`, status `awaiting-approval`, and no earlier decision left. The gate
   * is recorded in the global home (see `approvalDir`); `get` shows that copy, not what the job record says.
   */
  openApproval(id: string, gate: OpenApprovalInput, patch?: CrewJobPatch): Promise<CrewJob>;
  /** Records a human or host decision for the open gate, in the global home. Refused inside a crew worker. */
  decide(id: string, approve: boolean, input: CrewDecisionInput): Promise<void>;
  /** The decision for the open gate, once; stale, early or misplaced (workspace) decision files never count. */
  takeDecision(id: string): Promise<CrewDecision | undefined>;
  artifact(id: string, kind: 'output' | 'summary', offset?: number, maxBytes?: number): ReturnType<ReturnType<typeof createCrewArtifacts>['read']>;
}

/** A crew worker (or any agent it starts) carries EDU_CREW_JOB; it may never approve anything. */
export function isCrewWorker(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.EDU_CREW_JOB?.trim() || env.ALBERT_CREW_JOB?.trim());
}

/**
 * Where a workspace's open approval gates and their decisions live: in the person's global home
 * (`<global>/.edu-local/approvals/<key>`), one folder per job brain, never inside the workspace. A sandboxed agent
 * (Codex workspace-write, the Claude or Pi sandboxes) can write its workspace, including the job record, but not
 * this folder, so it can neither forge a decision nor change the gate a person is asked about. An unsandboxed
 * process of the same user can still write here: it can act as the user anyway.
 */
export function approvalDir(globalRoot: string, brainRoot: string, platform: NodeJS.Platform = process.platform): string {
  return join(resolve(globalRoot), LOCAL_DIR, 'approvals', folderKey(brainRoot, platform));
}

const envGlobalRoot = () => resolve(process.env.EDU_HOME || join(process.env.HOME || process.env.USERPROFILE || homedir(), '.edu'));

const DECISION_BY = new Set<CrewDecisionBy>(['cli', 'deck', 'host-llm']);
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

export interface CrewStoreOptions {
  /** The person's global Edu home (outside every workspace). Default: EDU_HOME, else `~/.edu`. */
  globalRoot?: string;
}

export function createCrewStore(brainRoot: string, options: CrewStoreOptions = {}): CrewStore {
  const root = join(brainRoot, 'crew');
  // Resolved on first use, so a store that never opens a gate never looks at the global home.
  let gates: string | undefined;
  const gateDir = () => (gates ??= approvalDir(options.globalRoot ?? envGlobalRoot(), brainRoot));
  const globalHome = () => resolve(options.globalRoot ?? envGlobalRoot());
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
  const decisionPath = (id: string) => join(gateDir(), `${safeId(id)}.decision`);
  const gatePath = (id: string) => join(gateDir(), `${safeId(id)}.gate.json`);
  /** Where 6.0.0 kept decisions, inside the workspace: never read, only removed. */
  const workspaceDecision = (id: string) => join(root, `${safeId(id)}.decision`);
  const lockPath = (id: string) => join(root, `${safeId(id)}.lock`);
  const ensure = () => mkdir(root, { recursive: true });
  const removeFile = (path: string) => unlink(path).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
  // The brain's atomic write retries the rename while Windows reports the target as held open (a status
  // poller reading the job), instead of failing the job with EPERM.
  async function atomicJson(path: string, value: unknown): Promise<void> {
    await ensure();
    await atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
  }
  /** The open gate as the worker recorded it in the global home; the job record only shows a copy. */
  async function readGate(id: string): Promise<CrewApproval | undefined> {
    let value: unknown;
    try { value = JSON.parse(await readFile(gatePath(id), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return undefined; throw error; }
    const gate = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    if (typeof gate.requestId !== 'string' || typeof gate.openedAt !== 'string' || typeof gate.title !== 'string') return undefined;
    const checks = Array.isArray(gate.unregisteredChecks) ? gate.unregisteredChecks.filter((check): check is string => typeof check === 'string') : [];
    return { requestId: gate.requestId, openedAt: gate.openedAt, title: gate.title, ...(checks.length ? { unregisteredChecks: checks } : {}) };
  }
  async function closeGate(id: string): Promise<void> {
    await removeFile(gatePath(id));
    await removeFile(decisionPath(id));
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
      let job: unknown;
      try {
        job = JSON.parse(await readFile(metaPath(id), 'utf8'));
        if (!job || typeof job !== 'object' || !('id' in job) || !('status' in job) || !isCrewJobStatus((job as CrewJob).status)) throw new Error(`Invalid crew job record: ${id}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
      const record = job as CrewJob;
      if (record.status !== 'awaiting-approval') return record;
      // The gate a person is asked about is the one in the global home: a record edited in the workspace cannot
      // change its requestId or the commands it lists, and a gate that is not there shows as none.
      const gate = await readGate(safeId(record.id));
      return { ...record, approval: gate };
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
          if (!isTerminalCrewJobStatus(current.status)) {
            safePatch.status = 'failed';
            safePatch.endedAt ??= new Date().toISOString();
          }
        }
        if (typeof patch.note === 'string') safePatch.note = redactWorkerOutput(patch.note);
        const updated: CrewJob = { ...current, ...safePatch };
        // A finished job has no open gate, whatever was on display when it ended.
        if (isTerminalCrewJobStatus(updated.status)) delete updated.approval;
        await atomicJson(metaPath(current.id), updated);
        // A job that ends while a gate is open (cancelled, failed, expired) leaves no gate a decision could still name.
        if (current.status === 'awaiting-approval' && isTerminalCrewJobStatus(updated.status)) await closeGate(current.id).catch(() => undefined);
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
    async openApproval(id, gate, patch = {}) {
      const job = await this.get(id);
      if (!job) throw new Error(`Crew job not found: ${id}`);
      // Anything written before this gate opened can never apply to it; a decision left in the workspace never could.
      await closeGate(job.id);
      await removeFile(workspaceDecision(job.id));
      const approval: CrewApproval = { requestId: randomUUID(), openedAt: new Date().toISOString(), title: gate.title, ...(gate.unregisteredChecks?.length ? { unregisteredChecks: gate.unregisteredChecks } : {}) };
      // The authoritative gate goes to the global home first; the job record gets a copy for display.
      await mkdir(gateDir(), { recursive: true });
      await ensureLocalIgnored(globalHome());
      await atomicWrite(gatePath(job.id), `${JSON.stringify(approval)}\n`);
      return this.update(job.id, { ...patch, status: 'awaiting-approval', approval });
    },
    async decide(id, approve, input) {
      if (isCrewWorker(input.env ?? process.env)) throw new Error('A crew worker cannot approve or reject crew jobs');
      if (!DECISION_BY.has(input.by)) throw new Error(`Invalid approval channel: ${String(input.by)}`);
      const job = await this.get(id);
      if (!job || job.kind !== 'orchestration') throw new Error(`Orchestration job not found: ${id}`);
      if (job.status !== 'awaiting-approval' || !job.approval) throw new Error(`Crew job is not awaiting approval: ${id}`);
      if (input.requestId !== job.approval.requestId) throw new Error(`Approval request ${input.requestId} is not the one job ${job.id.slice(0, 8)} is waiting on; read the current requestId with edu crew status`);
      // `by` is who the deciding process says it is: attribution, not proof (see approvalDir for who can write here).
      const decision = { requestId: input.requestId, approve, by: input.by, at: new Date().toISOString() };
      // Complete and exclusive in one step (temp file hard-linked into place): the polling worker can never read a
      // half-written decision, judge it invalid and discard the person's answer.
      try { await exclusiveWrite(decisionPath(job.id), `${JSON.stringify(decision)}\n`); }
      catch (error) {
        if (isAlreadyExists(error)) throw new Error(`A decision for this gate is already pending (job ${job.id.slice(0, 8)}); the worker applies it in a moment.`);
        throw error;
      }
    },
    async takeDecision(id) {
      const job = await this.get(id);
      if (!job) throw new Error(`Crew job not found: ${id}`);
      // Only the gate in the global home counts, and only a decision file there: one in the workspace is never read.
      const gate = await readGate(job.id);
      const path = decisionPath(job.id);
      // Claim the one-shot file by renaming it first: only one taker wins, so a decision is never applied twice
      // and a concurrent taker never fails on a file the other one already removed.
      const claimed = `${path}.${randomUUID()}.taking`;
      try { await retryFs.rename(path, claimed); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
      let text: string;
      try { text = await readFile(claimed, 'utf8'); }
      finally { await unlink(claimed).catch(() => undefined); }
      let value: unknown;
      try { value = JSON.parse(text); } catch { value = undefined; }
      const decision = value && typeof value === 'object' ? value as Record<string, unknown> : {};
      const valid = gate !== undefined && decision.requestId === gate.requestId && typeof decision.approve === 'boolean'
        && DECISION_BY.has(decision.by as CrewDecisionBy) && typeof decision.at === 'string' && Date.parse(decision.at) >= Date.parse(gate.openedAt);
      // Not for this gate (a bare legacy "approve", another gate, written before it opened): already discarded.
      if (!valid) return undefined;
      // Close the decision window, so a second command cannot authorize the next approval by accident.
      await closeGate(job.id);
      await this.update(job.id, { status: 'running', approval: undefined });
      return { approve: decision.approve as boolean, by: decision.by as CrewDecisionBy };
    },
    async artifact(id, kind, offset, maxBytes) {
      const job = await this.get(id);
      if (!job) throw new Error(`Crew job not found: ${id}`);
      return artifacts.read(job.id, kind, offset, maxBytes);
    },
  };
}
