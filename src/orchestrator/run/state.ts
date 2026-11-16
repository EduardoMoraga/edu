import { appendFile, mkdir, open, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { atomicWrite } from '../../brain/store.js';
import type { CliId, ContextPack, DeterministicCheck, EduConfig, EduEvent, Engine, HarnessLevel, Requirement } from '../../core/contracts.js';
import { measuredEngine } from '../../engine/measurement.js';
import { BudgetExhausted, RunBudget } from '../budget.js';
import type { OrchestrateDeps, StepResult } from '../run.js';
import { isAvoidableComposerMessage } from './gates.js';

const exec = promisify(execFile);

export type TerminalStatus = 'completed' | 'blocked' | 'cancelled' | 'budget_exhausted';

/** Everything one orchestration run reads and writes. Each phase receives it and changes only what it owns. */
export interface RunState {
  readonly runId: string;
  readonly goal: string;
  /** The caller's dependencies with the run's signal (caller + budget deadline) and budgeted, measured engines. */
  readonly deps: OrchestrateDeps;
  /** The caller's config with the playbook's role overrides (the caller's config until the playbook loads). */
  config: EduConfig;
  readonly budget: RunBudget;
  /** Aborts when the execution budget's `timeoutMs` of work elapses. */
  readonly deadline: AbortSignal;
  /** The execution budget's clock: it stops while a gate waits for a person (see `waitForAnswer`). */
  readonly clock: BudgetClock;
  readonly composer: ComposerObserver;
  /** HEAD when the run started; the entropy audit diffs against it. */
  readonly startCommit?: string;
  harnessLevel: HarnessLevel;
  /** The playbook method given to every worker but the lead. */
  methodSummary: string;
  /** The status a run that did not complete is persisted with. */
  terminalStatus: TerminalStatus;
  /** The brain session holding this run's episode. */
  sessionId?: string;
  episodeClosed: boolean;
  pack: ContextPack;
  requirements: Requirement[];
  registeredChecks: DeterministicCheck[];
  /** The checks this run verifies with: the plan's, resolved against the registry. */
  effectiveChecks: DeterministicCheck[];
  registryInfo: string;
  taskState: string;
  taskStatePath?: string;
  /** H3 reproduction evidence handed to builders. */
  workflowEvidence: string;
  summary: string;
  /** Every event this run emitted, in order. */
  readonly events: EduEvent[];
  /** The evidence subset of `events` (context traces, checks, interventions, outcome). */
  readonly evidenceEvents: EduEvent[];
  readonly steps: StepResult[];
  readonly limitations: string[];
  /** Brain notes a builder cited as applied, by note id. */
  readonly applications: Map<string, { requirementIds: string[]; application: string }>;
  /** Note ids visible in the delivered context pack: only these can receive credit. */
  readonly suppliedNotes: Set<string>;
}

export interface BudgetClock { pause(): void; resume(): void; clear(): void }

/**
 * Calls `expire` once `ms` of running time has passed. Paused time does not count (pauses may nest), so a run that
 * waits hours for a person is not "out of budget" when they answer; `clear` stops it for good.
 */
export function budgetClock(ms: number, expire: () => void): BudgetClock {
  let remaining = ms;
  let since = Date.now();
  let paused = 0;
  let done = false;
  const arm = () => { const timer = setTimeout(() => { done = true; expire(); }, Math.max(0, remaining)); timer.unref(); return timer; };
  let timer: NodeJS.Timeout | undefined = arm();
  return {
    pause() {
      if (done || paused++ > 0) return;
      clearTimeout(timer);
      remaining -= Date.now() - since;
    },
    resume() {
      if (done || paused === 0 || --paused > 0) return;
      since = Date.now();
      timer = arm();
    },
    clear() { done = true; clearTimeout(timer); timer = undefined; },
  };
}

/** Sets up a run (budget deadline, engines, event log) and emits `run.start`. */
export async function startRun(goal: string, input: OrchestrateDeps): Promise<RunState> {
  const runId = randomUUID();
  const budget = new RunBudget(input.config);
  const deadline = new AbortController();
  const clock = budgetClock(budget.limits.timeoutMs, () => deadline.abort(new BudgetExhausted('Execution budget exhausted: timeoutMs.')));
  const signal = input.signal ? AbortSignal.any([input.signal, deadline.signal]) : deadline.signal;
  const startCommit = await exec('git', ['rev-parse', 'HEAD'], { cwd: input.cwd }).then(result => result.stdout.trim()).catch(() => undefined);
  const engines = new Map<CliId, Engine>();
  const engineFor = (cli: CliId) => {
    let engine = engines.get(cli);
    if (!engine) { engine = budget.wrap(measuredEngine(input.engines(cli))); engines.set(cli, engine); }
    return engine;
  };
  const deps: OrchestrateDeps = { ...input, signal, engines: engineFor };
  await mkdir(deps.runsDir, { recursive: true });
  const run: RunState = {
    runId, goal, deps, config: deps.config, budget, deadline: deadline.signal, clock, startCommit,
    composer: composerObserver(deps.composerMessages),
    harnessLevel: deps.harnessLevel ?? 'H3', methodSummary: '', terminalStatus: 'blocked', episodeClosed: false,
    pack: { text: '', tokens: 0, budgetTokens: deps.config.context.budgetTokens, sections: [], deferred: [] },
    requirements: [], registeredChecks: [], effectiveChecks: [], registryInfo: '', taskState: '', workflowEvidence: '', summary: 'Run failed.',
    events: [], evidenceEvents: [], steps: [], limitations: [], applications: new Map(), suppliedNotes: new Set(),
  };
  await emit(run, { type: 'run.start', runId, goal, mode: deps.config.mode, at: at(run) });
  run.composer.start(message => {
    const avoidable = isAvoidableComposerMessage(message);
    return emitEvidence(run, { type: 'intervention', by: 'user', action: 'composer-message', detail: message, avoidable, harnessGap: avoidable ? 'context' : 'unknown', at: at(run) });
  });
  return run;
}

export const at = (run: RunState) => (run.deps.now?.() ?? new Date()).toISOString();

/** Appends an event to the run log (synced to disk) and forwards it. */
export async function emit(run: RunState, event: EduEvent): Promise<void> {
  run.events.push(event);
  const file = await open(join(run.deps.runsDir, `${run.runId}.jsonl`), 'a');
  try {
    await file.write(`${JSON.stringify(event)}\n`, undefined, 'utf8');
    await file.sync();
  } finally { await file.close(); }
  await run.deps.onEvent(event);
}

/** Like `emit`, and also records the event as evidence for the outcome classification. */
export async function emitEvidence(run: RunState, event: EduEvent): Promise<void> {
  run.evidenceEvents.push(event);
  run.events.push(event);
  await appendFile(join(run.deps.runsDir, `${run.runId}.jsonl`), `${JSON.stringify(event)}\n`, 'utf8');
  await run.deps.onEvent(event);
}

/** Writes `runs/<runId>.status.json`, which resume and `edu runs` read. */
export async function writeStatus(run: RunState, status: TerminalStatus | 'running', summary: string): Promise<void> {
  const { runId, goal, sessionId, steps, budget, deps } = run;
  await atomicWrite(join(deps.runsDir, `${runId}.status.json`), `${JSON.stringify({ runId, cwd: deps.cwd, goal, sessionId, status, owner: { pid: process.pid, host: hostname() }, summary, steps, budget: { ...budget.limits, spawns: budget.spawns, advisorCalls: budget.advisorCalls }, updatedAt: at(run) }, null, 2)}\n`);
}

export function persistStatus(run: RunState, success: boolean, detail: string): Promise<void> {
  return writeStatus(run, success ? 'completed' : run.terminalStatus, detail);
}

/** Closes the run's brain session once and queues it for reflection. */
export async function closeEpisode(run: RunState, text: string): Promise<void> {
  const id = run.sessionId;
  if (!id || run.episodeClosed) return;
  await run.deps.brain.closeSession(id, text);
  run.episodeClosed = true;
  await emit(run, { type: 'brain.learn', noteId: id, kind: 'episode', title: `Run: ${run.goal}`, at: at(run) });
  await atomicWrite(join(dirname(run.deps.runsDir), 'reflect-queue', `${run.runId}.json`), `${JSON.stringify({ runId: run.runId, sessionId: id, queuedAt: at(run) }, null, 2)}\n`);
}

/** The H2/H3 task-state note, rewritten with the next steps. */
export function taskStateMarkdown(goal: string, nextSteps: string): string {
  return `# Task state\n\n## Goal\n${goal}\n\n## Hypotheses\n- None recorded yet.\n\n## Inspected files\n- None recorded yet.\n\n## Open questions\n- None recorded yet.\n\n## Next steps\n${nextSteps}\n`;
}

/** Replaces the task state; only H2/H3 runs keep one on disk. */
export async function saveTaskState(run: RunState, text: string): Promise<void> {
  if (!run.taskStatePath) return;
  run.taskState = text;
  await writeFile(run.taskStatePath, text, 'utf8');
}

/** The registry, brain pack and task state every worker sees, by harness level. */
export function supportContext(run: RunState): string {
  const sections: string[] = [];
  if (run.harnessLevel !== 'H0') sections.push(`Tool and check registry:\n${run.registryInfo || 'No registered tools or checks.'}`);
  if (run.harnessLevel === 'H2' || run.harnessLevel === 'H3') {
    if (run.pack.text) sections.push(`Brain context pack:\n${run.pack.text}`);
    if (run.taskState) sections.push(`Task state:\n${run.taskState}`);
  }
  return sections.join('\n\n');
}

export interface ComposerObserver {
  /** Starts recording each composer message; does nothing without a composer stream. */
  start(record: (message: string) => Promise<void>): void;
  /** Stops reading and waits for the message being recorded. */
  close(): Promise<void>;
}

function composerObserver(messages: AsyncIterable<string> | undefined): ComposerObserver {
  const iterator = messages?.[Symbol.asyncIterator]();
  let closed = false;
  let emission: Promise<void> | undefined;
  return {
    start(record) {
      if (!iterator) return;
      void (async () => {
        try {
          while (!closed) {
            const next = await iterator.next();
            if (closed || next.done) break;
            emission = record(next.value);
            await emission;
          }
        } catch { /* A closing composer stream must not invalidate the run. */ }
      })();
    },
    async close() {
      closed = true;
      try { void Promise.resolve(iterator?.return?.()).catch(() => {}); } catch { /* Iterator cleanup is best-effort and must not block the run. */ }
      await emission?.catch(() => {});
    },
  };
}
