import { open, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import type { BrainLocation, CliId, CrewJob, EduEvent, Engine, Usage } from '../core/contracts.js';
import { openBrain } from '../brain/index.js';
import { brief } from '../context/index.js';
import { createEngine } from '../engine/index.js';
import { createCrewStore, type CrewStore } from './store.js';
import { runOrchestration } from './orchestration.js';

export interface WorkerOptions {
  brainRoot?: string;
  locations?: BrainLocation[];
  store?: CrewStore;
  engineFactory?: (cli: CliId) => Engine;
  now?: () => Date;
  detectClis?: () => Promise<CliId[]>;
  sleep?: (ms: number) => Promise<void>;
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
      env: { ...process.env, EDU_HOME: root },
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
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let failed = false;
  try {
    await store.update(job.id, { status: 'running', pid: process.pid, note: undefined });
    const brain = openBrain(locations);
    const context = await brief(brain, 1200, { eduMdPath: join(locations[0]!.root, 'EDU.md') });
    const engine = (options.engineFactory ?? createEngine)(job.cli);
    const systemPrompt = [
      'You are an Edu crew worker. Complete the user mission directly; no built-in role identity applies.',
      'Respect the requested autonomy and report a concise result, including blockers and verification.',
      context ? `\n## Brain brief\n${context}` : '',
    ].filter(Boolean).join('\n');
    for await (const event of engine.run({ cli: job.cli, prompt: job.task, cwd: job.cwd, autonomy: job.autonomy, systemPrompt }, job.id)) {
      const stamped = { ...event, at: event.at || iso(now) } as EduEvent;
      await store.appendEvent(job.id, stamped);
      if (event.type === 'agent.text') summary += event.text;
      else if (event.type === 'agent.end' || event.type === 'run.end') {
        summary = event.summary || summary;
        failed ||= !event.ok;
      } else if (event.type === 'error') {
        summary = summary ? `${summary}\n${event.message}` : event.message;
        failed = true;
      } else if (event.type === 'usage') {
        usage.inputTokens += event.usage.inputTokens;
        usage.outputTokens += event.usage.outputTokens;
        usage.cacheReadTokens = (usage.cacheReadTokens ?? 0) + (event.usage.cacheReadTokens ?? 0);
        usage.cacheWriteTokens = (usage.cacheWriteTokens ?? 0) + (event.usage.cacheWriteTokens ?? 0);
        if (event.usage.costUsd !== undefined) usage.costUsd = (usage.costUsd ?? 0) + event.usage.costUsd;
      }
    }
    const status = failed ? 'failed' : 'done';
    const finalSummary = summary.trim() || (failed ? 'Worker failed without a summary.' : 'Worker completed without a summary.');
    const endedAt = iso(now);
    const updated = await store.update(job.id, { status, endedAt, summary: finalSummary, usage });
    const episode = await brain.write({
      tier: 'episodic', kind: 'session', status: 'closed', title: `Crew ${job.cli} ${status}: ${job.task.slice(0, 48)}`,
      body: `Task: ${job.task}\n\nResult: ${finalSummary}`, source: 'edu:crew', tags: ['crew', job.cli],
    });
    await store.appendEvent(job.id, { type: 'brain.learn', noteId: episode.meta.id, kind: 'episode', title: episode.meta.title, at: endedAt });
    return updated;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.appendEvent(job.id, { type: 'error', message, at: iso(now) }).catch(() => undefined);
    return store.update(job.id, { status: 'failed', endedAt: iso(now), summary: message, usage });
  }
}
