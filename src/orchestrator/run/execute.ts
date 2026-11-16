import type { StepResult } from '../run.js';
import type { Plan } from '../plan.js';
import { assignCli } from '../assign.js';
import { builderPrompt, recordApplications, runAgent } from './agents.js';
import { reproduceChecks } from './checks.js';
import { saveTaskState, supportContext, type RunState } from './state.js';

type Step = Plan['steps'][number];

/**
 * Execute: H3 reproduction first, then the plan's steps in dependency order. Independent read-only steps on
 * CLIs that enforce read-only run in parallel batches; the first failure cancels its batch and stops the run.
 * Returns each completed step's summary by id.
 */
export async function executePhase(run: RunState, plan: Plan): Promise<Map<string, string>> {
  const { deps, budget } = run;
  if (run.harnessLevel === 'H3') run.workflowEvidence = await reproduceChecks(run, run.effectiveChecks);
  const completed = new Map<string, string>();
  const pending = new Map(plan.steps.map(step => [step.id, step]));
  const enforcedReader = (step: Step) => run.config.roles.find(role => role.id === step.role)?.autonomy === 'readonly' && deps.engines(assignCli(step.role, run.config, deps.available)).capabilities?.readonly === 'enforced';
  while (pending.size) {
    if (deps.signal?.aborted) throw new Error('Run cancelled.');
    const ready = [...pending.values()].filter(step => step.dependsOn.every(id => completed.has(id)));
    if (!ready.length) throw new Error('Plan contains a dependency cycle or an unsatisfied dependency.');
    const first = ready[0]!;
    const firstReadonly = run.config.roles.find(role => role.id === first.role)?.autonomy === 'readonly' && enforcedReader(first);
    const batch = first.parallelSafe && firstReadonly
      ? ready.filter(step => step.parallelSafe && enforcedReader(step)).slice(0, budget.limits.maxConcurrency)
      : [first];
    const batchController = new AbortController();
    const batchSignal = deps.signal ? AbortSignal.any([deps.signal, batchController.signal]) : batchController.signal;
    const settled = await Promise.allSettled(batch.map(step => executeStep(run, step, batchSignal).catch(error => {
      batchController.abort();
      throw error;
    })));
    const failed = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed) throw failed.reason;
    for (const result of settled) {
      if (result.status !== 'fulfilled') continue;
      const outcome = result.value;
      pending.delete(outcome.id);
      run.steps.push(outcome);
      if (!outcome.ok) throw new Error(`Step '${outcome.id}' failed: ${outcome.summary}`);
      completed.set(outcome.id, outcome.summary);
      if (run.taskStatePath) await saveTaskState(run, `${run.taskState}\n## Progress\n- ${outcome.id}: ${outcome.ok ? 'completed' : 'failed'} — ${outcome.summary}\n`);
    }
  }
  return completed;
}

async function executeStep(run: RunState, step: Step, signal?: AbortSignal): Promise<StepResult> {
  const { runId, goal, deps } = run;
  const role = run.config.roles.find(candidate => candidate.id === step.role);
  const cli = assignCli(step.role, run.config, deps.available);
  const dependencyContext = step.dependsOn.map(id => `${id}: ${run.steps.find(item => item.id === id)?.summary ?? ''}`).join('\n');
  const prompt = step.role === 'builder'
    ? `${builderPrompt(step.task, goal, run.workflowEvidence, run.harnessLevel)}\n\nDependencies:\n${dependencyContext}`
    : `${step.task}\n\nGoal: ${goal}\n\nDependencies:\n${dependencyContext}`;
  const response = await runAgent(run, { cli, agentId: `${runId}-${step.id}`, role: step.role, prompt, autonomy: role?.autonomy ?? 'readonly', context: supportContext(run), method: run.methodSummary, signal });
  if (step.role === 'builder') await recordApplications(run, response.text);
  return { id: step.id, ok: true, summary: response.summary || response.text };
}
