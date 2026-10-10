import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Autonomy, BrainLocation, CliId, CrewJob, CrewJobMode, Engine, HarnessLevel, OrchestrationMode } from '../core/contracts.js';
import { detectEngines, createEngine } from '../engine/index.js';
import { truncateToTokens } from '../context/index.js';
import { dispatchHeadless, runWorker } from './headless.js';
import { dispatchPane, herdrAvailable, refreshPane, type HerdrOptions } from './herdr.js';
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
}
export interface DispatchInput { cli: CliId; task: string; mode?: CrewJobMode; cwd?: string; autonomy?: Autonomy }
export interface OrchestrationInput { goal: string; cwd?: string; cli?: CliId; mode?: OrchestrationMode; playbook?: string; harnessLevel?: HarnessLevel; autoApprove?: boolean }
export interface ReviewInput { cli?: CliId; base?: string; callerCli?: CliId }

export function createCrew(options: CrewOptions = {}) {
  const root = options.brainRoot ?? options.locations?.[0]?.root ?? defaultRoot();
  const store = options.store ?? createCrewStore(root);
  const engineFactory = options.engineFactory ?? createEngine;
  const detect = options.detectClis ?? detectEngines;
  const sleep = options.sleep ?? (ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms)));
  const clock = options.clock ?? Date.now;
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
      const requestedMode = input.mode ?? 'headless';
      const availablePane = requestedMode === 'pane' && await herdrAvailable(options.herdr);
      const job = await store.create({ cli: input.cli, task: input.task.trim(), mode: availablePane ? 'pane' : 'headless', cwd, autonomy: input.autonomy ?? 'ask' });
      if (requestedMode === 'pane' && !availablePane) await store.update(job.id, { note: 'Herdr unavailable; dispatched as headless.' });
      if (availablePane) return dispatchPane(job, { ...options.herdr, store, brainRoot: root });
      return (options.startHeadless ?? dispatchHeadless)(job, { brainRoot: root });
    },
    async status(jobId?: string): Promise<CrewJob | CrewJob[]> {
      if (jobId) {
        const job = await store.get(jobId);
        if (!job) throw new Error(`Crew job not found: ${jobId}`);
        return job.mode === 'pane' ? refreshPane(job, { ...options.herdr, store, brainRoot: root }) : job;
      }
      const jobs = await store.list();
      return Promise.all(jobs.map(job => job.mode === 'pane' ? refreshPane(job, { ...options.herdr, store, brainRoot: root }) : job));
    },
    async result(jobId: string, waitSeconds = 0): Promise<CrewJob> {
      if (!Number.isFinite(waitSeconds) || waitSeconds < 0) throw new Error('waitSeconds must be a non-negative number');
      const deadline = clock() + Math.floor(waitSeconds * 1000);
      while (true) {
        const current = await this.status(jobId) as CrewJob;
        if (['done', 'failed', 'cancelled'].includes(current.status) || clock() >= deadline) return current;
        await sleep(Math.min(250, Math.max(1, deadline - clock())));
      }
    },
    async review(input: ReviewInput = {}): Promise<{ cli: CliId; summary: string }> {
      const available = await detect();
      const callerEnv = options.callerEnv ?? process.env;
      const caller = input.callerCli ?? (callerEnv.ANTIGRAVITY || callerEnv.ANTIGRAVITY_AGENT || callerEnv.GEMINI_CLI ? 'agy' : undefined);
      const reviewer = input.cli ?? available.find(cli => cli !== caller);
      if (!reviewer || !available.includes(reviewer)) throw new Error('No available reviewer CLI different from the caller; specify an installed --cli');
      const base = input.base ?? 'HEAD';
      const rawDiff = await (options.diff ?? defaultDiff)(base, process.cwd());
      const prompt = `Review the following changes. Do not modify files. Return concrete findings first, then residual risks.\n\n\`\`\`diff\n${truncateToTokens(rawDiff, 6000)}\n\`\`\``;
      let summary = '';
      for await (const event of engineFactory(reviewer).run({ cli: reviewer, prompt, cwd: process.cwd(), autonomy: 'readonly', systemPrompt: 'You are an independent, read-only code reviewer. Never request write access.' }, `review-${Date.now()}`)) {
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
  const result = await execFile('git', ['diff', base, '--'], { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  return result.stdout;
}

const defaultCrew = createCrew();
export const dispatch = (input: DispatchInput) => defaultCrew.dispatch(input);
export const status = (jobId?: string) => defaultCrew.status(jobId);
export const result = (jobId: string, waitSeconds?: number) => defaultCrew.result(jobId, waitSeconds);
export const review = (input?: ReviewInput) => defaultCrew.review(input);
export { runWorker } from './headless.js';
export { createCrewStore } from './store.js';
