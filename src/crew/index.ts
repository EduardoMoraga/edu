import { measuredEngine } from '../engine/measurement.js';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Autonomy, BrainLocation, CliId, CrewJob, CrewJobMode, Engine, HarnessLevel, OrchestrationMode } from '../core/contracts.js';
import { detectEngines, createEngine } from '../engine/index.js';
import { enforcesReadonly } from '../engine/autonomy.js';
import { truncateToTokens } from '../context/index.js';
import { processAlive, describeProcess, killTree } from '../platform/process-tree.js';
import { DEFAULT_CREW_TIMEOUT_MINUTES, dispatchHeadless, runWorker } from './headless.js';
import { closePane, dispatchPane, herdrTarget, refreshPane, type HerdrOptions } from './herdr.js';
import { isTerminalCrewJobStatus } from './status.js';
import { createCrewStore, type CrewStore } from './store.js';

const execFile = promisify(execFileCallback);
const defaultRoot = () => resolve(process.env.EDU_HOME || join(homedir(), '.edu'));
export interface CrewOptions {
  brainRoot?: string;
  workspaceRoot?: string;
  callerEnv?: NodeJS.ProcessEnv;
  locations?: BrainLocation[];
  store?: CrewStore;
  engineFactory?: (cli: CliId) => Engine;
  detectClis?: () => Promise<CliId[]>;
  herdr?: HerdrOptions;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
  diff?: (base: string, cwd: string) => Promise<string>;
  startHeadless?: (job: CrewJob, options: { brainRoot: string }) => Promise<CrewJob>;
  /** Default minutes before a headless task job is stopped; else `crew.timeoutMinutes` in config.json, else 60. */
  timeoutMinutes?: number;
  /** Process probes (tests inject fakes). */
  isAlive?: (pid: number) => boolean;
  describeProcess?: (pid: number) => Promise<string | undefined>;
  stopProcess?: (pid: number, signal: NodeJS.Signals) => Promise<void>;
  /** How long a cancelled worker gets to stop its CLI before it is force-killed. */
  cancelGraceMs?: number;
}
export interface DispatchInput { cli: CliId; task: string; mode?: CrewJobMode; cwd?: string; autonomy?: Autonomy; timeoutMinutes?: number }
export interface OrchestrationInput { goal: string; cwd?: string; cli?: CliId; mode?: OrchestrationMode; playbook?: string; harnessLevel?: HarnessLevel; autoApprove?: boolean }
export interface ReviewInput { cli?: CliId; base?: string; callerCli?: CliId }

/** A worker past its timeout by this much has stopped reporting: its job is marked failed. */
const OVERDUE_GRACE_MS = 5 * 60_000;

async function configuredTimeout(root: string): Promise<number | undefined> {
  try {
    const { loadConfig } = await import('../orchestrator/config.js');
    return (await loadConfig(join(root, 'config.json'))).crew?.timeoutMinutes;
  } catch { return undefined; } // no or unreadable config: the built-in default applies
}

function validTimeout(minutes: number | undefined): number | undefined {
  if (minutes === undefined) return undefined;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error('Crew timeout must be a whole number of minutes from 1 to 1440');
  return minutes;
}

/** True when the process at `pid` is the Edu worker for `jobId`, so a reused pid is never signalled. */
export function isWorkerOf(description: string | undefined, jobId: string, platform: NodeJS.Platform = process.platform): boolean {
  if (!description) return false;
  // Windows only reports the image name; the worker runs under Node.
  return platform === 'win32' ? /^node(?:\.exe)?$/i.test(description.trim()) : description.includes('crew') && description.includes(jobId);
}

export function createCrew(options: CrewOptions = {}) {
  const root = options.brainRoot ?? options.locations?.[0]?.root ?? defaultRoot();
  const store = options.store ?? createCrewStore(root);
  const engineFactory = options.engineFactory ?? createEngine;
  const detect = options.detectClis ?? detectEngines;
  const sleep = options.sleep ?? (ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms)));
  const clock = options.clock ?? Date.now;
  const isAlive = options.isAlive ?? processAlive;
  const describe = options.describeProcess ?? describeProcess;
  const stop = options.stopProcess ?? ((pid: number, signal: NodeJS.Signals) => killTree({ pid }, signal));
  const readonlyEnforced = (cli: CliId) => measuredEngine(engineFactory(cli)).capabilities?.readonly === 'enforced';

  /** Marks a headless job whose worker died, or stopped reporting past its timeout, as failed. */
  async function sweep(job: CrewJob): Promise<CrewJob> {
    if (isTerminalCrewJobStatus(job.status) || job.pid === undefined) return job;
    const dead = !isAlive(job.pid);
    const limit = (job.timeoutMinutes ?? DEFAULT_CREW_TIMEOUT_MINUTES) * 60_000;
    const overdue = job.kind !== 'orchestration' && job.status === 'running' && clock() > Date.parse(job.createdAt) + limit + OVERDUE_GRACE_MS;
    if (!dead && !overdue) return job;
    return store.mutate(job.id, current => isTerminalCrewJobStatus(current.status) || current.pid !== job.pid ? undefined : {
      status: 'failed', endedAt: new Date(clock()).toISOString(),
      summary: dead ? `Worker process ${job.pid} stopped without finishing the job.` : `Worker exceeded its ${limit / 60_000}-minute timeout and stopped reporting.`,
    });
  }
  const refresh = (job: CrewJob) => job.mode === 'pane' ? refreshPane(job, { ...options.herdr, store, brainRoot: root }) : sweep(job);

  /** Stops a headless worker: SIGTERM lets it end its CLI's tree; whatever is left after the grace is force-killed. */
  async function stopWorker(job: CrewJob): Promise<string | undefined> {
    const pid = job.pid;
    if (pid === undefined || !isAlive(pid)) return undefined;
    if (!isWorkerOf(await describe(pid), job.id)) return `Process ${pid} is no longer this job's worker; nothing was signalled.`;
    await stop(pid, 'SIGTERM');
    const deadline = clock() + (options.cancelGraceMs ?? 3000);
    while (isAlive(pid) && clock() < deadline) await sleep(50);
    if (isAlive(pid)) await stop(pid, 'SIGKILL');
    return undefined;
  }
  const workspaceRoot = options.workspaceRoot ?? (options.locations?.find(loc => loc.scope === 'project')?.root
    ? dirname(options.locations.find(loc => loc.scope === 'project')!.root)
    : options.brainRoot ? (basename(options.brainRoot) === '.edu' ? dirname(options.brainRoot) : options.brainRoot) : process.cwd());

  return {
    async orchestrate(input: OrchestrationInput): Promise<CrewJob> {
      if (!input.goal.trim()) throw new Error('Orchestration goal must not be empty');
      const boundary = await realpath(workspaceRoot);
      const cwd = await realpath(resolve(input.cwd ?? workspaceRoot));
      const fromBoundary = relative(boundary, cwd);
      if (fromBoundary === '..' || fromBoundary.startsWith(`..${sep}`) || isAbsolute(fromBoundary)) throw new Error(`Crew orchestration cwd is outside the workspace: ${cwd}`);
      const available = await detect();
      const cli = input.cli ?? available[0];
      if (!cli || !available.includes(cli)) throw new Error('No available CLI for orchestration');
      const job = await store.create({ cli, task: input.goal.trim(), goal: input.goal.trim(), kind: 'orchestration', mode: 'headless', cwd, autonomy: 'auto', orchestrationMode: input.mode, playbook: input.playbook, harnessLevel: input.harnessLevel, autoApprove: input.autoApprove });
      await store.update(job.id, { status: 'running' });
      try { return await (options.startHeadless ?? dispatchHeadless)(job, { brainRoot: root }); }
      catch (error) {
        await store.update(job.id, { status: 'failed', endedAt: new Date().toISOString(), summary: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },
    async approve(jobId: string, approved: boolean): Promise<CrewJob> {
      await store.decide(jobId, approved);
      return (await store.get(jobId))!;
    },
    async dispatch(input: DispatchInput): Promise<CrewJob> {
      if (!input.task.trim()) throw new Error('Crew task must not be empty');
      const boundary = await realpath(workspaceRoot);
      const cwd = await realpath(resolve(input.cwd ?? workspaceRoot));
      const fromBoundary = relative(boundary, cwd);
      if (fromBoundary === '..' || fromBoundary.startsWith(`..${sep}`) || isAbsolute(fromBoundary)) {
        throw new Error(`Crew dispatch cwd is outside the workspace: ${input.cwd ?? cwd}`);
      }
      const autonomy = input.autonomy ?? 'ask';
      if (autonomy === 'readonly' && !enforcesReadonly(input.cli)) {
        throw new Error(`${input.cli} cannot enforce read-only work; dispatch it to claude, codex or pi, or choose another autonomy level`);
      }
      const timeoutMinutes = validTimeout(input.timeoutMinutes) ?? validTimeout(options.timeoutMinutes) ?? await configuredTimeout(root) ?? DEFAULT_CREW_TIMEOUT_MINUTES;
      const requestedMode = input.mode ?? 'headless';
      // Inside herdr: a pane beside the caller. Outside (Hermes, launchd) with a reachable server: a tab
      // in the "Edu" herdr workspace. Otherwise headless, and the job says why.
      const target = requestedMode === 'pane' ? await herdrTarget(options.herdr) : undefined;
      const pane = target !== undefined && target.kind !== 'none';
      const job = await store.create({ cli: input.cli, task: input.task.trim(), mode: pane ? 'pane' : 'headless', cwd, autonomy, timeoutMinutes });
      if (target?.kind === 'none') await store.update(job.id, { note: `Herdr unavailable (${target.reason}); dispatched as headless.` });
      if (pane) return dispatchPane(job, { ...options.herdr, store, brainRoot: root, target });
      return (options.startHeadless ?? dispatchHeadless)(job, { brainRoot: root });
    },
    async status(jobId?: string): Promise<CrewJob | CrewJob[]> {
      if (jobId) {
        const job = await store.get(jobId);
        if (!job) throw new Error(`Crew job not found: ${jobId}`);
        return refresh(job);
      }
      const jobs = await store.list();
      return Promise.all(jobs.map(refresh));
    },
    async result(jobId: string, waitSeconds = 0): Promise<CrewJob> {
      if (!Number.isFinite(waitSeconds) || waitSeconds < 0) throw new Error('waitSeconds must be a non-negative number');
      const deadline = clock() + Math.floor(waitSeconds * 1000);
      while (true) {
        const current = await this.status(jobId) as CrewJob;
        if (isTerminalCrewJobStatus(current.status) || clock() >= deadline) return current;
        await sleep(Math.min(250, Math.max(1, deadline - clock())));
      }
    },
    /**
     * Cancels a job: marks it `cancelled` first (so the dying worker's own write cannot win), then stops
     * its worker process tree, or closes its herdr pane. A finished job is returned unchanged.
     */
    async cancel(jobId: string): Promise<CrewJob> {
      const job = await store.get(jobId);
      if (!job) throw new Error(`Crew job not found: ${jobId}`);
      const cancelled = await store.mutate(job.id, current => isTerminalCrewJobStatus(current.status) ? undefined : {
        status: 'cancelled', endedAt: new Date(clock()).toISOString(), summary: 'Cancelled on request.',
      });
      if (cancelled.status !== 'cancelled' || isTerminalCrewJobStatus(job.status)) return cancelled;
      let note: string | undefined;
      try {
        if (cancelled.mode === 'pane') await closePane(cancelled, { ...options.herdr, store, brainRoot: root });
        else note = await stopWorker(cancelled);
      } catch (error) {
        note = `Could not stop the job's process: ${error instanceof Error ? error.message : String(error)}`;
      }
      return note ? store.update(job.id, { note }) : cancelled;
    },
    async review(input: ReviewInput = {}): Promise<{ cli: CliId; summary: string }> {
      const available = await detect();
      const callerEnv = options.callerEnv ?? process.env;
      const caller = input.callerCli ?? (callerEnv.ANTIGRAVITY || callerEnv.ANTIGRAVITY_AGENT || callerEnv.GEMINI_CLI ? 'agy' : undefined);
      // The diff under review is untrusted input: only a CLI that enforces read-only may see it.
      const reviewer = input.cli ?? available.find(cli => cli !== caller && readonlyEnforced(cli));
      if (!reviewer || !available.includes(reviewer)) throw new Error('No available read-only reviewer CLI different from the caller (claude, codex or pi); specify an installed --cli');
      if (!readonlyEnforced(reviewer)) throw new Error(`${reviewer} cannot enforce a read-only review; use claude, codex or pi`);
      const base = input.base ?? 'HEAD';
      const rawDiff = await (options.diff ?? defaultDiff)(base, workspaceRoot);
      const prompt = `Review the following changes. Do not modify files. Return concrete findings first, then residual risks.\n\n\`\`\`diff\n${truncateToTokens(rawDiff, 6000)}\n\`\`\``;
      let summary = '';
      for await (const event of measuredEngine(engineFactory(reviewer)).run({ invocation: { id: crypto.randomUUID(), purpose: 'review' }, cli: reviewer, prompt, cwd: workspaceRoot, autonomy: 'readonly', requireReadonly: true, systemPrompt: 'You are an independent, read-only code reviewer. Never request write access.' }, `review-${Date.now()}`)) {
        if (event.type === 'agent.text') summary += event.text;
        else if (event.type === 'agent.end' || event.type === 'run.end') {
          if (!event.ok) throw new Error('reviewer ended unsuccessfully');
          if (event.summary) summary = event.summary;
        }
        else if (event.type === 'error') throw new Error(`Crew review failed: ${event.message}`);
      }
      return { cli: reviewer, summary: summary.trim() || 'Reviewer returned no findings.' };
    },
    runWorker: (jobId: string) => runWorker(jobId, { brainRoot: root, locations: options.locations, store, engineFactory, detectClis: detect, sleep }),
    store,
  };
}

async function defaultDiff(base: string, cwd: string): Promise<string> {
  let inside: string;
  try { inside = (await execFile('git', ['rev-parse', '--is-inside-work-tree'], { cwd, encoding: 'utf8' })).stdout.trim(); }
  catch { throw new Error('cross-vendor review needs a git repository to diff; run it inside a repo or pass files'); }
  if (inside !== 'true') throw new Error('cross-vendor review needs a git repository to diff; run it inside a repo or pass files');
  if (base.startsWith('-') || base.includes('\0')) throw new Error(`Unknown git base ref: ${base}`);
  try { await execFile('git', ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`], { cwd, encoding: 'utf8' }); }
  catch { throw new Error(`Unknown git base ref: ${base}`); }
  const result = await execFile('git', ['diff', '--no-ext-diff', '--no-textconv', base, '--'], { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  return result.stdout;
}

const defaultCrew = createCrew();
export const dispatch = (input: DispatchInput) => defaultCrew.dispatch(input);
export const status = (jobId?: string) => defaultCrew.status(jobId);
export const result = (jobId: string, waitSeconds?: number) => defaultCrew.result(jobId, waitSeconds);
export const review = (input?: ReviewInput) => defaultCrew.review(input);
export const cancel = (jobId: string) => defaultCrew.cancel(jobId);
export { DEFAULT_CREW_TIMEOUT_MINUTES, runWorker } from './headless.js';
export { createCrewStore } from './store.js';
export { CREW_JOB_STATUSES, TERMINAL_CREW_JOB_STATUSES, isCrewJobStatus, isTerminalCrewJobStatus } from './status.js';
