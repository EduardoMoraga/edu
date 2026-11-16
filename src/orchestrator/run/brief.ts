import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { loadChecks, loadTools } from '../../evidence/registry.js';
import type { EduConfig } from '../../core/contracts.js';
import { assignCli } from '../assign.js';
import { capRoleAutonomy } from '../config.js';
import { applyPlaybookRoles, loadPlaybook, workerMethod, type Playbook } from '../playbook.js';
import { at, emitEvidence, saveTaskState, taskStateMarkdown, writeStatus, type RunState } from './state.js';

/**
 * Brief: loads the playbook and gathers what every agent is briefed with (brain context pack, tool and check
 * registry, task state), and opens the run's brain session.
 */
export async function briefPhase(run: RunState): Promise<Playbook> {
  const { deps, budget, goal } = run;
  if (deps.signal?.aborted) throw new Error('Run cancelled before start.');
  if (deps.config.routing?.advisor && budget.limits.maxAdvisorCalls > 0 && !deps.autoApprove && deps.config.approvals !== 'auto') {
    const cli = assignCli('advisor', deps.config, deps.available);
    if (deps.engines(cli).capabilities?.readonly !== 'enforced') throw new Error('Advisor requires enforced read-only execution.');
  }
  const playbook = await loadPlaybook(deps.playbookName ?? deps.config.playbook ?? 'default', dirname(deps.runsDir));
  run.harnessLevel = deps.harnessLevel ?? playbook.harness;
  run.methodSummary = workerMethod(playbook);
  run.config = withinCeiling(run, applyPlaybookRoles(deps.config, playbook));
  const contextual = run.harnessLevel === 'H2' || run.harnessLevel === 'H3';
  if (contextual) {
    run.pack = await deps.context.build({ query: goal, budgetTokens: deps.config.context.budgetTokens });
    for (const section of run.pack.sections) for (const noteId of section.noteIds) {
      // Only IDs actually visible in the delivered pack can receive credit.
      if (run.pack.text.includes(`[[${noteId}]]`)) run.suppliedNotes.add(noteId);
      await emitEvidence(run, { type: 'context.trace', noteId, contribution: section.title, influenced: false, at: at(run) });
    }
  }
  const session = await deps.brain.openSession(`Run: ${goal}`, 'edu:orchestrator');
  run.sessionId = session.meta.id;
  await writeStatus(run, 'running', 'Run started; inspect event log before resuming interrupted work.');
  if (run.harnessLevel !== 'H0') {
    const [tools, checks] = await Promise.all([loadTools(deps.cwd), loadChecks(deps.cwd)]);
    run.registeredChecks = checks;
    run.registryInfo = JSON.stringify({ tools, checks }, null, 2);
  }
  if (contextual) {
    run.taskStatePath = join(deps.runsDir, run.runId, 'task-state.md');
    await mkdir(dirname(run.taskStatePath), { recursive: true });
    await saveTaskState(run, taskStateMarkdown(goal, '- Planner is preparing the task plan.'));
  }
  return playbook;
}

/** Lowers roles above the caller's autonomy ceiling to it, and records each one as a limitation of the run. */
function withinCeiling(run: RunState, config: EduConfig): EduConfig {
  const ceiling = run.deps.maxAutonomy;
  if (!ceiling) return config;
  const capped = capRoleAutonomy(config, ceiling);
  for (const role of capped.lowered) run.limitations.push(`Role ${role.id} asked for ${role.requested} autonomy, above the crew ceiling "${ceiling}", so it ran with "${ceiling}". A person can raise crew.maxAutonomy in the global Edu config.`);
  return capped.config;
}
