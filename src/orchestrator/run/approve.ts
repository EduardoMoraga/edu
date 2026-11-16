import type { Playbook } from '../playbook.js';
import { sameCheck } from './checks.js';
import { askApproval, needsApproval } from './gates.js';
import type { PlannedRun } from './plan.js';
import { at, closeEpisode, emit, type RunState } from './state.js';

/**
 * Approve: the spec gate (required by the playbook, by a detached run, or by checks the planner invented) and one gate per step
 * the approval policy covers. Returns false when a gate was rejected: the run stops there.
 */
export async function approvePhase(run: RunState, playbook: Playbook, { plan, spec }: PlannedRun): Promise<boolean> {
  const { runId, deps } = run;
  const unregistered = run.effectiveChecks.filter(check => !run.registeredChecks.some(registered => sameCheck(registered, check)));
  let unregisteredApproved = Boolean(deps.allowUnregisteredChecks);
  if (playbook.requireSpecApproval || deps.requireSpecApproval || unregistered.length) {
    // The exact commands come first: approving this gate is what lets them run through the shell.
    const detail = unregistered.length && !deps.allowUnregisteredChecks
      ? `Unregistered checks: approving runs these exact commands through the shell in ${deps.cwd}:\n${unregistered.map(check => `- ${check.id}: ${check.command}`).join('\n')}\n\n${spec.markdown}`
      : spec.markdown;
    const policyApproval = deps.autoApprove || run.config.approvals === 'auto';
    const answer = await askApproval(run, {
      agentId: `${runId}-lead`, approvalId: `${runId}-approval-spec`, stepId: 'spec', title: 'Approve spec', detail,
      unregisteredChecks: unregistered.map(check => check.command), interventionDetail: 'spec approval',
      cancelled: 'Run cancelled while awaiting spec approval.', fallback: policyApproval ? 'policy' : 'user',
    });
    // A person who saw the commands may authorize them; --yes, a policy or the host LLM may not.
    unregisteredApproved ||= answer.approved && !deps.autoApprove && answer.by !== 'host-llm';
    if (!answer.approved) {
      run.summary = 'spec rejected';
      for (const step of plan.steps) run.steps.push({ id: step.id, ok: false, summary: 'Not run because the spec was rejected.', skipped: true });
      await closeEpisode(run, run.summary);
      return false;
    }
  }
  if (unregistered.length && !unregisteredApproved) {
    run.effectiveChecks = run.effectiveChecks.filter(check => !unregistered.includes(check));
    run.limitations.push(`Unregistered check(s) not run: ${unregistered.map(check => check.id).join(', ')}. They need a person to approve the spec that lists them, or --allow-unregistered-checks; register them in .edu/harness/checks.json to run them every time.`);
  }
  const gated = plan.steps.filter(step => needsApproval(run.config.approvals, run.config.roles.find(role => role.id === step.role)?.autonomy ?? 'readonly'));
  for (const step of gated) {
    const agentId = `${runId}-${step.id}`;
    const { approved } = await askApproval(run, {
      agentId, approvalId: `${runId}-approval-${step.id}`, stepId: step.id, title: `Approve ${step.role} step`, detail: step.task,
      cancelled: 'Run cancelled while awaiting approval.',
    });
    if (!approved) {
      for (const candidate of plan.steps) run.steps.push({ id: candidate.id, ok: false, summary: candidate.id === step.id ? 'Approval rejected.' : 'Not run because approval was rejected.', skipped: true });
      run.summary = `Run stopped: approval rejected for step '${step.id}'.`;
      await closeEpisode(run, run.summary);
      await emit(run, { type: 'agent.status', agentId, status: 'cancelled', at: at(run) });
      return false;
    }
  }
  return true;
}
