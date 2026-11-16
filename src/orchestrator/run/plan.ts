import { dirname } from 'node:path';
import { assignCli } from '../assign.js';
import { extractPlan, planningPrompt, repairPrompt, type Plan } from '../plan.js';
import type { Playbook } from '../playbook.js';
import { writeSpec } from '../spec.js';
import { readonlyCli, runAgent } from './agents.js';
import { resolveChecks } from './checks.js';
import { at, emit, emitEvidence, saveTaskState, supportContext, taskStateMarkdown, type RunState } from './state.js';

export interface PlannedRun { plan: Plan; spec: Awaited<ReturnType<typeof writeSpec>> }

/** Plan: the read-only lead turns the goal into requirements, checks and steps (one repair), written as the spec. */
export async function planPhase(run: RunState, playbook: Playbook): Promise<PlannedRun> {
  const { runId, goal, deps } = run;
  const leadId = `${runId}-lead`;
  for (const role of run.config.roles) {
    const cli = assignCli(role.id, run.config, deps.available);
    const capabilities = deps.engines(cli).capabilities!;
    if (role.autonomy === 'readonly' && capabilities.readonly !== 'enforced') run.limitations.push(`${role.id}/${cli}: readonly enforcement unsupported; steps run serially. ${capabilities.limitations.join(' ')}`);
  }
  const leadCli = readonlyCli(run, 'lead');
  const planningMethod = `Playbook: ${playbook.name}\n${playbook.description}\n\n${playbook.body}`;
  const lead = (agentId: string, prompt: string) => runAgent(run, { cli: leadCli, agentId, role: 'lead', prompt, autonomy: 'readonly', context: supportContext(run), method: run.methodSummary });
  const planText = await lead(leadId, planningPrompt(goal, '', { harnessLevel: run.harnessLevel, playbook: planningMethod }));
  let plan: Plan;
  try { plan = extractPlan(planText.text); }
  catch (first) {
    const repaired = await lead(`${leadId}-repair`, `${repairPrompt(planText.text, String(first))}\n\nFollow this playbook method when planning:\n${planningMethod}`);
    try { plan = extractPlan(repaired.text); }
    catch (second) { throw new Error(`Unable to produce a valid plan after one repair: ${String(second)}`); }
  }
  await emit(run, { type: 'agent.end', agentId: leadId, ok: true, summary: `Planned ${plan.steps.length} step(s).`, ...(planText.sessionId ? { sessionId: planText.sessionId } : {}), at: at(run) });
  run.requirements = plan.requirements;
  await emitEvidence(run, { type: 'task.define', requirements: run.requirements, successCriteria: run.requirements.map((requirement) => requirement.text), at: at(run) });
  run.effectiveChecks = resolveChecks(plan.checks, run.registeredChecks);
  if (run.harnessLevel === 'H3') await reportBypassedChecks(run);
  await saveTaskState(run, taskStateMarkdown(goal, plan.steps.map((step) => `- ${step.id}: ${step.task}`).join('\n') || '- Report the task outcome.'));
  for (const step of plan.steps) {
    if (step.role !== 'explorer' && step.role !== 'builder' && step.role !== 'reviewer') throw new Error(`Unsupported plan role '${step.role}' in step '${step.id}'.`);
  }
  const spec = await writeSpec(dirname(deps.runsDir), goal, playbook.name, run.harnessLevel, plan, run.config, deps.available, deps.now?.() ?? new Date(), runId);
  await emit(run, { type: 'spec.ready', path: spec.path, requirements: run.requirements, checks: plan.checks, steps: plan.steps.map(step => ({ id: step.id, role: step.role, cli: assignCli(step.role, run.config, deps.available), task: step.task })), at: at(run) });
  return { plan, spec };
}

/** H3: a registered check that covers a planned requirement but was left out of the plan is an entropy finding. */
async function reportBypassedChecks(run: RunState): Promise<void> {
  const requirementIds = new Set(run.requirements.map(requirement => requirement.id));
  const selectedIds = new Set(run.effectiveChecks.map(check => check.id));
  for (const check of run.registeredChecks) {
    if (!check.requirementIds.some(requirementId => requirementIds.has(requirementId)) || selectedIds.has(check.id)) continue;
    await emitEvidence(run, { type: 'entropy.finding', category: 'checks-bypassed', severity: 3, path: '.edu/harness/checks.json', detail: `Applicable registered check '${check.id}' was omitted from the H3 plan.`, at: at(run) });
  }
}
