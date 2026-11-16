import { sumUsage } from '../core/usage.js';
import { measuredEngine } from '../engine/measurement.js';
import { open, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import type { BrainLocation, CliId, CrewJob, EduEvent, Engine, Usage } from '../core/contracts.js';
import { openBrain } from '../brain/index.js';
import { brief } from '../context/index.js';
import { redactWorkerOutput } from '../context/artifacts.js';
import { createEngine } from '../engine/index.js';
import { CLI_IDS } from '../adapters/types.js';
import { childEnv } from '../platform/child-env.js';
import { createCrewStore, type CrewStore } from './store.js';
import { runOrchestration } from './orchestration.js';

/** A crew task job stops after this many minutes unless the job or the workspace config says otherwise. */
export const DEFAULT_CREW_TIMEOUT_MINUTES = 60;

export interface WorkerOptions {
  brainRoot?: string;
  locations?: BrainLocation[];
  store?: CrewStore;
  engineFactory?: (cli: CliId) => Engine;
  now?: () => Date;
  detectClis?: () => Promise<CliId[]>;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The detached worker's environment. Agents can read their parent's environment (`/proc/<ppid>/environ` on Linux,
 * `ps eww` on macOS), so filtering only the agent CLIs is not enough: the worker gets the allowlist of the CLIs it
 * may start (the job's CLI; every CLI for an orchestration) plus what it needs itself: Node's settings (NODE_*),
 * EDU_HOME pinned to the job's brain, and the crew-worker marker when a worker dispatched it. Registered checks of
 * a detached orchestration run with this environment too; `crew.env.passthrough` in the global config adds more.
 */
export function workerEnv(job: Pick<CrewJob, 'kind' | 'cli'>, root: string, options: { source?: NodeJS.ProcessEnv; platform?: NodeJS.Platform } = {}): NodeJS.ProcessEnv {
  const platform = options.platform ?? process.platform;
  const source = { ...(options.source ?? process.env), EDU_HOME: root };
  const env: NodeJS.ProcessEnv = {};
  for (const cli of job.kind === 'orchestration' ? CLI_IDS : [job.cli]) Object.assign(env, childEnv(cli, {}, { source, platform }));
  const ownNeed = (name: string) => {
    const key = platform === 'win32' ? name.toUpperCase() : name;
    return key.startsWith('NODE_') || key === 'EDU_CREW_JOB' || key === 'ALBERT_CREW_JOB';
  };
  for (const [name, value] of Object.entries(source)) if (value !== undefined && ownNeed(name)) env[name] = value;
  return env;
}

function defaultBrainRoot(): string { return resolve(process.env.EDU_HOME || join(homedir(), '.edu')); }
function locationsFor(root: string): BrainLocation[] { return [{ scope: 'global', root }]; }
const iso = (now: () => Date) => now().toISOString();

export async function dispatchHeadless(job: CrewJob, options: { brainRoot?: string; entry?: string } = {}): Promise<CrewJob> {
  const root = options.brainRoot ?? defaultBrainRoot();
  const store = createCrewStore(root);
  const entry = options.entry ?? process.argv[1];
  if (!entry) throw new Error('Could not determine the Edu CLI entry point for the detached worker');
  const logDir = join(root, 'crew');
  await mkdir(logDir, { recursive: true });
  const log = await open(join(logDir, `${job.id}.log`), 'a');
  try {
    const child = spawn(process.execPath, [entry, 'crew', 'worker', job.id], {
      cwd: job.cwd,
      detached: true,
      stdio: ['ignore', log.fd, log.fd],
      env: workerEnv(job, root),
      windowsHide: true,
    });
    child.once('error', error => { void store.update(job.id, { status: 'failed', endedAt: new Date().toISOString(), summary: error.message }); });
    child.unref();
    return store.update(job.id, { pid: child.pid });
  } finally {
    await log.close();
  }
}

export async function runWorker(jobId: string, options: WorkerOptions = {}): Promise<CrewJob> {
  const root = options.brainRoot ?? defaultBrainRoot();
  const locations = options.locations ?? locationsFor(root);
  const store = options.store ?? createCrewStore(root);
  const now = options.now ?? (() => new Date());
  const job = await store.get(jobId);
  if (!job) throw new Error(`Crew job not found: ${jobId}`);
  if (job.kind === 'orchestration') return runOrchestration(job, { brainRoot: root, store, engineFactory: options.engineFactory, detectClis: options.detectClis, now: options.now, sleep: options.sleep });
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
    return store.update(job.id, { status: 'failed', endedAt: iso(now), summary: message, usage });
  } finally {
    clearTimeout(timer);
  }
}
