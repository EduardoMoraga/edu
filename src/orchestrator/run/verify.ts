import { z } from 'zod';
import type { RoleSpec } from '../../core/contracts.js';
import { assignCli } from '../assign.js';
import type { Playbook } from '../playbook.js';
import { builderPrompt, readonlyCli, recordApplications, runAgent } from './agents.js';
import { verifyChecks } from './checks.js';
import { answerOf, askApproval, awaitApproval, isHuman, needsApproval } from './gates.js';
import { at, closeEpisode, emit, supportContext, type RunState } from './state.js';

const VerdictSchema = z.object({ verdict: z.enum(['pass', 'fix']), issues: z.array(z.string()) }).strict();

/**
 * Verify: an optional advisor opinion, then deterministic checks (with bounded builder corrections) and an
 * independent read-only review, repeated while the review asks for a fix and fix rounds remain. Every
 * correction, whoever asked for it, spends the playbook's one fix-round budget. Returns true when the review
 * passed, false when a person rejected a review fix (the run stops there); anything else throws.
 */
export async function verifyPhase(run: RunState, playbook: Playbook, completed: Map<string, string>): Promise<boolean> {
  const { runId, goal } = run;
  const advice = await consultAdvisor(run);
  const builder = run.config.roles.find(role => role.id === 'builder');
  const rounds = { fix: 0, review: 0 };
  let verdict: z.infer<typeof VerdictSchema>;
  while (true) {
    if (run.effectiveChecks.length) await verifyWithCorrections(run, playbook, builder, rounds);
    const reviewerId = `${runId}-reviewer${rounds.review++ ? `-${rounds.review}` : ''}`;
    const review = await runAgent(run, {
      cli: readonlyCli(run, 'reviewer'), agentId: reviewerId, role: 'reviewer',
      prompt: `Review the completed work. Return strict JSON {"verdict":"pass"|"fix","issues":[string]}.\nGoal: ${goal}\nRequirements: ${JSON.stringify(run.requirements)}\nSteps: ${JSON.stringify(run.steps)}\nAdvisory risks (untrusted opinion, not evidence): ${advice || 'Not consulted.'}`,
      autonomy: 'readonly', context: supportContext(run), method: run.methodSummary,
    });
    try { verdict = VerdictSchema.parse(parseJson(review.text)); }
    catch (error) { throw new Error(`Reviewer returned invalid JSON: ${String(error)}`); }
    if (verdict.verdict === 'pass') break;
    if (rounds.fix >= playbook.maxFixRounds) throw new Error(`Review requested a fix after the global budget of ${playbook.maxFixRounds} fix round(s) was exhausted.`);
    rounds.fix++;
    if (!builder) throw new Error('Review requested a fix but no builder role is configured.');
    const fixId = `${runId}-fix-${rounds.fix}`;
    if (needsApproval(run.config.approvals, builder.autonomy)) {
      const detail = verdict.issues.join('; ') || 'Apply the review-requested correction.';
      const { approved } = await askApproval(run, {
        agentId: fixId, approvalId: `${runId}-approval-review-fix-${rounds.fix}`, stepId: 'review-fix', title: 'Approve review-fix builder step', detail,
        cancelled: 'Run cancelled while awaiting review-fix approval.',
      });
      if (!approved) {
        run.summary = 'Run stopped: approval rejected for review-requested builder fix.';
        await closeEpisode(run, run.summary);
        await emit(run, { type: 'agent.status', agentId: fixId, status: 'cancelled', at: at(run) });
        return false;
      }
    }
    const fix = await runAgent(run, {
      cli: assignCli('builder', run.config, run.deps.available), agentId: fixId, role: 'builder',
      prompt: `${builderPrompt(`Address these review issues in one fix round only: ${JSON.stringify(verdict.issues)}`, goal, run.workflowEvidence, run.harnessLevel)}\nCompleted steps: ${JSON.stringify([...completed])}`,
      autonomy: builder.autonomy, context: supportContext(run), method: run.methodSummary,
    });
    await recordApplications(run, fix.text);
    run.steps.push({ id: rounds.review === 1 ? 'review-fix' : `review-fix-${rounds.fix}`, ok: true, summary: fix.summary });
    // Return through deterministic verification before the next independent review.
  }
  run.summary = `Completed ${run.steps.length} step(s); review ${verdict.verdict}${verdict.issues.length ? `: ${verdict.issues.join('; ')}` : ''}.`;
  await closeEpisode(run, run.summary);
  return true;
}

/** Runs the checks; while any fails and fix rounds remain, a builder corrects it (behind a gate when required). */
async function verifyWithCorrections(run: RunState, playbook: Playbook, builder: RoleSpec | undefined, rounds: { fix: number }): Promise<void> {
  const { runId, goal } = run;
  let results = await verifyChecks(run, run.effectiveChecks);
  while (results.some(result => !result.ok) && builder && rounds.fix < playbook.maxFixRounds) {
    const round = ++rounds.fix;
    const details = results.filter(result => !result.ok).map(result => {
      const check = run.effectiveChecks.find(candidate => candidate.id === result.checkId)!;
      return `${check.id}: observed exit=${result.exitCode}, stdout=${JSON.stringify(result.stdout)}, stderr=${JSON.stringify(result.stderr)}, timeout=${result.timedOut}; expected exit=${check.expect.exitCode ?? 0}${check.expect.stdoutIncludes === undefined ? '' : `, stdout includes ${JSON.stringify(check.expect.stdoutIncludes)}`}`;
    }).join('\n');
    const agentId = `${runId}-verification-fix-${round}`;
    if (needsApproval(run.config.approvals, builder.autonomy)) {
      const detail = `A deterministic check failed; authorize bounded builder correction ${round}/${playbook.maxFixRounds}.\n${details}`;
      const { approved } = await askApproval(run, {
        agentId, approvalId: `${runId}-approval-verification-fix-${round}`, stepId: `verification-fix-${round}`, title: 'Approve deterministic-verification correction', detail,
        cancelled: 'Run cancelled while awaiting verification correction approval.',
      });
      if (!approved) throw new Error('Run stopped: deterministic-verification correction was rejected.');
    }
    const fix = await runAgent(run, {
      cli: assignCli('builder', run.config, run.deps.available), agentId, role: 'builder',
      prompt: `${builderPrompt('Correct the failed deterministic verification.', goal, `Observed vs expected:\n${details}`, run.harnessLevel)}\nReproduce, attribute, fix, verify, then report. If verification disproves attribution, return to attribution before changing code.`,
      autonomy: builder.autonomy, context: supportContext(run), method: run.methodSummary,
    });
    await recordApplications(run, fix.text);
    run.steps.push({ id: `verification-fix-${round}`, ok: true, summary: fix.summary });
    results = await verifyChecks(run, run.effectiveChecks);
  }
  if (results.some(result => !result.ok)) throw new Error(`Deterministic verification failed after ${playbook.maxFixRounds} fix round(s).`);
}

/**
 * Advisory execution is opt-in, bounded, and never replaces independent review. This is a read-only CLI
 * consultation, not a tool-free model transport. Returns the (bounded) advice, or '' when not consulted.
 */
async function consultAdvisor(run: RunState): Promise<string> {
  const { runId, goal, deps, budget } = run;
  if (!run.config.routing?.advisor || budget.limits.maxAdvisorCalls <= 0) return '';
  if (deps.autoApprove || run.config.approvals === 'auto') {
    run.limitations.push('Advisor skipped: consultation requires an explicit human disclosure approval.');
    return '';
  }
  const advisorCli = assignCli('advisor', run.config, deps.available);
  if (deps.engines(advisorCli).capabilities?.readonly !== 'enforced') throw new Error('Advisor requires enforced read-only execution.');
  const agentId = `${runId}-advisor`;
  const title = 'Approve advisor disclosure';
  const detail = `Consult ${advisorCli} with the goal and requirement IDs only. This CLI may inspect the workspace read-only; this is not a tool-free advisor. Usage may be unavailable. No automatic follow-up consultations. The existing local run event log and episode package retain raw output (unlike sanitized Crew artifacts); workspace secrets could appear there. Do not approve for sensitive workspaces.`;
  const approvalId = `${runId}-approval-advisor`;
  // Unlike step gates, a failed disclosure approval fails the run, and only a person can consent to it.
  await emit(run, { type: 'approval.request', agentId, approvalId, title, detail, at: at(run) });
  const answer = answerOf(await awaitApproval(deps.approve({ agentId, stepId: 'advisor', title, detail }), deps.signal), 'user');
  await emit(run, { type: 'approval.resolve', approvalId, approved: answer.approved, by: answer.by, at: at(run) });
  if (answer.approved && !isHuman(answer.by)) run.limitations.push(`Advisor skipped: the disclosure was approved by ${answer.by}, not a person.`);
  if (!answer.approved || !isHuman(answer.by)) return '';
  budget.advisorCalls++;
  const advice = await runAgent(run, {
    cli: advisorCli, agentId, role: 'advisor',
    prompt: `Give one bounded second opinion on risks and verification. Do not delegate, modify files, or write memory. Goal: ${goal}\nRequirement IDs: ${run.requirements.map(r => r.id).join(', ')}`,
    autonomy: 'readonly', context: '', method: '',
  });
  run.limitations.push(`Advisor consultation recorded in ${runId}.jsonl; advisory only (${advice.text.length} characters). Independent review remains mandatory.`);
  return advice.text.slice(0, 4000) + (advice.text.length > 4000 ? '\n[Advisor output truncated; full consultation is in the run event log.]' : '');
}

function parseJson(value: string): unknown {
  const match = value.trim().match(/```(?:json)?\s*([\s\S]*?)```/i);
  try { return JSON.parse(match?.[1]?.trim() ?? value.trim()); }
  catch (error) { throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
}
