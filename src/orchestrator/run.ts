import type { Brain } from '../brain/index.js';
import type { ApprovalBy, Autonomy, CliId, EduConfig, EduEvent, Engine, HarnessLevel } from '../core/contracts.js';
import { BudgetExhausted } from './budget.js';
import type { ContextProvider } from './types.js';
import { approvePhase } from './run/approve.js';
import { briefPhase } from './run/brief.js';
import { executePhase } from './run/execute.js';
import { learnPhase } from './run/learn.js';
import { planPhase } from './run/plan.js';
import { at, closeEpisode, emit, startRun, type RunState } from './run/state.js';
import { verifyPhase } from './run/verify.js';

export interface ApprovalRequest { agentId: string; stepId: string; title: string; detail: string }
/** An approval callback answers with a boolean (a person at the in-process prompt, or `policy` under --yes) or names its channel. */
export interface ApprovalAnswer { approved: boolean; by: ApprovalBy }
export interface OrchestrateDeps {
  config: EduConfig; brain: Brain; context: ContextProvider; engines: (cli: CliId) => Engine;
  available: CliId[]; cwd: string; onEvent(event: EduEvent): void | Promise<void>;
  approve(request: ApprovalRequest): Promise<boolean | ApprovalAnswer>; signal?: AbortSignal; runsDir: string; now?: () => Date;
  harnessLevel?: HarnessLevel;
  playbookName?: string;
  /** True when an upstream --yes policy, rather than a human, answers approval prompts. */
  autoApprove?: boolean;
  /**
   * Run planner-proposed checks that are not in `.edu/harness/checks.json` without a human gate (CLI
   * `--allow-unregistered-checks`). Otherwise they run only after a person approved the spec listing them.
   */
  allowUnregisteredChecks?: boolean;
  composerMessages?: AsyncIterable<string>;
  /**
   * The highest autonomy any role may run with (the global `crew.maxAutonomy`). Roles above it, from the config
   * or the playbook, run with the ceiling instead and the run records it. Default: no ceiling.
   */
  maxAutonomy?: Autonomy;
}
export interface StepResult { id: string; ok: boolean; summary: string; skipped?: boolean }
export interface RunResult { runId: string; ok: boolean; summary: string; events: EduEvent[]; steps: StepResult[]; episodeDir?: string }

/**
 * Runs a plan with explicit approvals, dependency ordering, cancellation, and JSONL replay. The phases share one
 * explicit RunState: brief → plan → approve → execute → verify → learn. A rejected gate stops the run early;
 * any error ends it as blocked, cancelled or budget-exhausted. Every path ends in `learn`, which emits `run.end`.
 */
export async function orchestrate(goal: string, deps: OrchestrateDeps): Promise<RunResult> {
  const run = await startRun(goal, deps);
  try {
    const playbook = await briefPhase(run);
    const planned = await planPhase(run, playbook);
    if (!await approvePhase(run, playbook, planned)) return await learnPhase(run, false);
    const completed = await executePhase(run, planned.plan);
    return await learnPhase(run, await verifyPhase(run, playbook, completed));
  } catch (error) {
    return await fail(run, error);
  }
}

async function fail(run: RunState, error: unknown): Promise<RunResult> {
  run.terminalStatus = error instanceof BudgetExhausted || run.deadline.aborted ? 'budget_exhausted' : run.deps.signal?.aborted ? 'cancelled' : 'blocked';
  run.summary = run.deadline.aborted ? 'Execution budget exhausted: timeoutMs.' : error instanceof Error ? error.message : String(error);
  if (run.sessionId) await closeEpisode(run, run.summary).catch(() => {});
  await emit(run, { type: 'error', message: run.summary, at: at(run) });
  return learnPhase(run, false);
}
