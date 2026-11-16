import { sumUsage } from '../core/usage.js';
import { measuredEngine } from '../engine/measurement.js';
import { createHash } from 'node:crypto';
import { open, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { CLI_IDS, type BrainLocation, type CliId, type CrewJob, type EduEvent, type Engine, type Usage } from '../core/contracts.js';
import { openBrain } from '../brain/index.js';
import { brief } from '../context/index.js';
import { redactWorkerOutput } from '../context/artifacts.js';
import { createEngine } from '../engine/index.js';
import { childEnv } from '../platform/child-env.js';
import { CREW_POLICY_ENV, DEFAULT_CREW_POLICY, encodeWorkerPolicy, loadCrewPolicy, withinAutonomy, type CrewPolicy, type WorkerPolicy } from '../workspace/config.js';
import { isTerminalCrewJobStatus } from './status.js';
import { createCrewStore, type CrewStore } from './store.js';
import { runOrchestration } from './orchestration.js';

/** A crew task job stops after this many minutes unless the job or the workspace config says otherwise. */
export const DEFAULT_CREW_TIMEOUT_MINUTES = 60;

export interface WorkerOptions {
  brainRoot?: string;
  /** The person's global home; default from the environment (EDU_HOME, else `~/.edu`). */
  globalRoot?: string;
  /**
   * The policy the dispatcher handed down (`edu crew worker` decodes EDU_CREW_POLICY). Default (an in-process
   * worker): the global config's policy, for the job as it is now.
   */
  policy?: WorkerPolicy;
  locations?: BrainLocation[];
  store?: CrewStore;
  engineFactory?: (cli: CliId) => Engine;
  now?: () => Date;
  detectClis?: () => Promise<CliId[]>;
  sleep?: (ms: number) => Promise<void>;
}

/** The variable that names a detached worker's job brain. EDU_HOME stays the person's real global home. */
export const CREW_BRAIN_ENV = 'EDU_CREW_BRAIN';

/**
 * The detached worker's environment. Agents can read their parent's environment (`/proc/<ppid>/environ` on Linux,
 * `ps eww` on macOS), so filtering only the agent CLIs is not enough: the worker gets the allowlist of the CLIs it
 * may start (the job's CLI; every CLI for an orchestration) plus what it needs itself: Node's settings (NODE_*),
 * the job's brain (EDU_CREW_BRAIN), the safety policy its parent resolved from the global config (EDU_CREW_POLICY),
 * and the crew-worker marker when a worker dispatched it. EDU_HOME is the person's global home (`globalRoot` when
 * given, else as the parent had it), never the job's brain, so a project `.edu` is never taken for the global config.
 * Registered checks of a detached orchestration run with this environment too.
 */
export function workerEnv(job: Pick<CrewJob, 'kind' | 'cli'>, root: string, options: { source?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; policy?: WorkerPolicy; globalRoot?: string } = {}): NodeJS.ProcessEnv {
  const platform = options.platform ?? process.platform;
  const policy = encodeWorkerPolicy(options.policy ?? { ...DEFAULT_CREW_POLICY, passthrough: [] });
  const source = { ...(options.source ?? process.env), [CREW_POLICY_ENV]: policy };
  const env: NodeJS.ProcessEnv = {};
  for (const cli of job.kind === 'orchestration' ? CLI_IDS : [job.cli]) Object.assign(env, childEnv(cli, {}, { source, platform }));
  const ownNeed = (name: string) => {
    const key = platform === 'win32' ? name.toUpperCase() : name;
    return key.startsWith('NODE_') || key === 'EDU_CREW_JOB' || key === 'ALBERT_CREW_JOB';
  };
  for (const [name, value] of Object.entries(source)) if (value !== undefined && ownNeed(name)) env[name] = value;
  // Drop any inherited spelling first (Windows names are case-insensitive), then pin the worker variables.
  const pinned: Record<string, string> = { [CREW_BRAIN_ENV]: root, [CREW_POLICY_ENV]: policy, ...(options.globalRoot ? { EDU_HOME: options.globalRoot } : {}) };
  for (const name of Object.keys(env)) if ((platform === 'win32' ? name.toUpperCase() : name) in pinned) delete env[name];
  return Object.assign(env, pinned);
}

/** The person's global Edu home, from the environment (EDU_HOME, else `~/.edu`). */
export function envGlobalRoot(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.EDU_HOME || join(env.HOME || env.USERPROFILE || homedir(), '.edu'));
}
const samePath = (a: string, b: string) => process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);
/** The job brain as a location: global only when it is the person's global home. */
function locationsFor(root: string, globalRoot: string): BrainLocation[] { return [{ scope: samePath(root, globalRoot) ? 'global' : 'project', root }]; }
const iso = (now: () => Date) => now().toISOString();

/**
 * A digest of what a job asks for (who, what, where, how much autonomy, the human-only flags). The parent hands it
 * to the worker with the policy, so a job record an agent edits between dispatch and start is refused, not run.
 */
export function jobDigest(job: CrewJob): string {
  const fields = [job.id, job.kind ?? 'task', job.cli, job.task, job.goal ?? null, job.cwd, job.mode, job.autonomy, job.playbook ?? null,
    job.orchestrationMode ?? null, job.harnessLevel ?? null, job.autoApprove === true, job.allowUnregisteredChecks === true, job.timeoutMinutes ?? null];
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

export interface DispatchHeadlessOptions {
  brainRoot?: string;
  /** The person's global home; default from the environment. */
  globalRoot?: string;
  entry?: string;
  /** The policy the dispatcher resolved from the global config; the worker gets it (with the job digest) in its environment. */
  policy?: CrewPolicy;
}

export async function dispatchHeadless(job: CrewJob, options: DispatchHeadlessOptions = {}): Promise<CrewJob> {
  const globalRoot = options.globalRoot ?? envGlobalRoot();
  const root = options.brainRoot ?? globalRoot;
  const store = createCrewStore(root, { globalRoot });
  const entry = options.entry ?? process.argv[1];
  if (!entry) throw new Error('Could not determine the Edu CLI entry point for the detached worker');
  const policy = { ...(options.policy ?? await loadCrewPolicy(globalRoot)), job: jobDigest(job) };
  const logDir = join(root, 'crew');
  await mkdir(logDir, { recursive: true });
  const log = await open(join(logDir, `${job.id}.log`), 'a');
  try {
    const child = spawn(process.execPath, [entry, 'crew', 'worker', job.id], {
      cwd: job.cwd,
      detached: true,
      stdio: ['ignore', log.fd, log.fd],
      env: workerEnv(job, root, { policy, globalRoot }),
      windowsHide: true,
    });
    child.once('error', error => { void store.update(job.id, { status: 'failed', endedAt: new Date().toISOString(), summary: error.message }); });
    child.unref();
    return await store.update(job.id, { pid: child.pid });
  } finally {
    await log.close();
  }
}

export async function runWorker(jobId: string, options: WorkerOptions = {}): Promise<CrewJob> {
  const globalRoot = options.globalRoot ?? envGlobalRoot();
  const root = options.brainRoot ?? globalRoot;
  const locations = options.locations ?? locationsFor(root, globalRoot);
  const store = options.store ?? createCrewStore(root, { globalRoot });
  const now = options.now ?? (() => new Date());
  const job = await store.get(jobId);
  if (!job) throw new Error(`Crew job not found: ${jobId}`);
  const policy = options.policy ?? { ...await loadCrewPolicy(globalRoot), job: jobDigest(job) };
  // What the job asks for must be what the dispatcher started: an edited record is refused before anything runs.
  const refusal = policy.job !== undefined && policy.job !== jobDigest(job) ? 'The job record changed after dispatch; the worker refused to run it.'
    : job.kind !== 'orchestration' && !withinAutonomy(job.autonomy, policy.maxAutonomy) ? `Autonomy "${job.autonomy}" is above the crew ceiling "${policy.maxAutonomy}"; the worker refused to run it.`
      : undefined;
  if (refusal) return store.mutate(job.id, current => isTerminalCrewJobStatus(current.status) ? undefined : { status: 'failed', endedAt: iso(now), summary: refusal });
  if (job.kind === 'orchestration') return runOrchestration(job, { brainRoot: root, globalRoot, policy, store, engineFactory: options.engineFactory, detectClis: options.detectClis, now: options.now, sleep: options.sleep });
  let summary = '';
  let usage: Usage = sumUsage([]);
  let failed = false;
  const timeoutMinutes = job.timeoutMinutes ?? DEFAULT_CREW_TIMEOUT_MINUTES;
  const deadline = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  try {
    const started = await store.update(job.id, { status: 'running', pid: process.pid, note: undefined });
    // Cancelled before this worker got going: do not start the CLI at all.
    if (started.status !== 'running') return started;
    const brain = openBrain(locations);
    const context = await brief(brain, 1200, { eduMdPath: join(locations[0]!.root, 'EDU.md') });
    const engine = (options.engineFactory ?? createEngine)(job.cli);
    const systemPrompt = [
      'You are an Edu crew worker. Complete the user mission directly; no built-in role identity applies.',
      'Respect the requested autonomy and report a concise result, including blockers and verification.',
      context ? `\n## Brain brief\n${context}` : '',
    ].filter(Boolean).join('\n');
    const request = {
      invocation: { id: crypto.randomUUID(), purpose: 'task' as const }, cli: job.cli, prompt: job.task, cwd: job.cwd, autonomy: job.autonomy, systemPrompt,
      signal: deadline.signal, ...(job.autonomy === 'readonly' ? { requireReadonly: true } : {}),
    };
    // The timeout bounds the CLI's run; it starts with the CLI.
    timer = setTimeout(() => deadline.abort(), timeoutMinutes * 60_000);
    for await (const event of measuredEngine(engine).run(request, job.id)) {
      const stamped = { ...event, at: event.at || iso(now) } as EduEvent;
      await store.appendEvent(job.id, stamped);
      if (event.type === 'agent.end' || event.type === 'run.end') {
        summary = event.summary || summary;
        failed ||= !event.ok;
      } else if (event.type === 'error') {
        summary = summary ? `${summary}\n${event.message}` : event.message;
        failed = true;
      } else if (event.type === 'usage') {
        usage = sumUsage([usage, event.usage]);
      }
    }
    // Flush the incomplete line before reading a bounded preview. Only text
    // already released by WorkerOutputFilter may enter the summary or brain.
    await store.flushOutput(job.id);
    const output = await store.artifact(job.id, 'output', 0, 900);
    if (deadline.signal.aborted) {
      failed = true;
      summary = `Timed out after ${timeoutMinutes} minute(s); the CLI was stopped.${summary ? `\n${summary}` : ''}`;
    }
    if (!summary) summary = output.text;
    const status = failed ? 'failed' : 'done';
    const finalSummary = `${summary.trim() || (failed ? 'Worker failed without a summary.' : 'Worker completed without a summary.')}${output.truncated ? `\n[stream preview truncated; full sanitized output: edu_crew_artifact jobId=${job.id} kind=output]` : ''}`;
    const endedAt = iso(now);
    const updated = await store.update(job.id, { status, endedAt, summary: finalSummary, usage });
    const episode = await brain.write({
      tier: 'episodic', kind: 'session', status: 'closed', title: `Crew ${job.cli} ${updated.status}: ${job.task.slice(0, 48)}`,
      body: `Task: ${job.task}\n\nResult: ${redactWorkerOutput(updated.summary)}\n\nFull sanitized output: crew artifact ${job.id} output`, source: 'edu:crew', tags: ['crew', job.cli],
    });
    await store.appendEvent(job.id, { type: 'brain.learn', noteId: episode.meta.id, kind: 'episode', title: episode.meta.title, at: endedAt });
    return updated;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.appendEvent(job.id, { type: 'error', message, at: iso(now) }).catch(() => undefined);
    return await store.update(job.id, { status: 'failed', endedAt: iso(now), summary: message, usage });
  } finally {
    clearTimeout(timer);
  }
}
