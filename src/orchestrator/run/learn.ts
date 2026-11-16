import { dirname } from 'node:path';
import { autoMaintain } from '../../reflect/auto-maintain.js';
import type { EduEvent, FeedbackContext, OutcomeLabel } from '../../core/contracts.js';
import { diagnosePackage } from '../../evidence/classify.js';
import { auditGitDiff } from '../../evidence/entropy.js';
import { buildEpisodePackage } from '../../evidence/package.js';
import type { RunResult } from '../run.js';
import { isHuman } from './gates.js';
import { at, emit, emitEvidence, persistStatus, type RunState } from './state.js';

type VerifyResult = Extract<EduEvent, { type: 'verify.result' }>;
const UNSAFE = ['weakened-tests', 'checks-bypassed', 'unsafe-invalid'];

/**
 * Learn: the terminal phase of every run, successful or not. Audits the diff, classifies the outcome from the
 * episode package, credits applied notes only on verified success, emits `run.end` and persists the status.
 */
export async function learnPhase(run: RunState, success: boolean): Promise<RunResult> {
  const { runId, deps, requirements, limitations } = run;
  run.clock.clear();
  await persistStatus(run, false, 'Finalization pending; consult the event log if interrupted.');
  await run.composer.close();
  const entropyUnsafe = await auditEntropy(run);
  const latestChecks = new Map<string, VerifyResult>();
  for (const event of run.evidenceEvents) if (event.type === 'verify.result' && event.kind === 'deterministic' && event.checkId) latestChecks.set(event.checkId, event);
  const passed = (checkId: string) => Boolean(latestChecks.get(checkId)?.ok && !latestChecks.get(checkId)?.timedOut);
  const verifiedRequirements = requirements.filter(requirement => {
    const checks = run.effectiveChecks.filter(check => check.requirementIds.includes(requirement.id));
    return checks.length > 0 && checks.every(check => passed(check.id));
  }).map(requirement => requirement.id);
  const verified = requirements.length > 0 && verifiedRequirements.length === requirements.length;
  // A later review or a different check on the same requirement cannot erase a failure.
  success &&= [...latestChecks.values()].every(result => result.ok && !result.timedOut);
  const hasIntervention = run.evidenceEvents.some(event => event.type === 'intervention' || (event.type === 'approval.resolve' && isHuman(event.by)));
  let label: OutcomeLabel = entropyUnsafe ? 'unsafe_invalid' : !success ? 'failed' : !verified ? 'unverified_success' : hasIntervention ? 'assisted_verified_success' : 'autonomous_verified_success';
  const outcome: Extract<EduEvent, { type: 'outcome' }> = { type: 'outcome', label, metrics: { harnessLevel: run.harnessLevel, cli: run.config.defaultCli, role: 'builder', verifiedRequirements, entropySeverity: run.evidenceEvents.filter(event => event.type === 'entropy.finding').reduce((severity, event) => Math.max(severity, event.severity), 0), elapsedMs: Date.parse(at(run)) - Date.parse(run.events[0]?.at ?? at(run)) }, at: at(run) };
  const end: Extract<EduEvent, { type: 'run.end' }> = { type: 'run.end', runId, ok: success, summary: run.summary, at: at(run) };
  // API8 reads complete packages. Validate a terminal candidate before emitting
  // the single terminal pair or awarding credit; publish the final snapshot below.
  const episodeDir = await buildEpisodePackage(dirname(deps.runsDir), runId, [...run.events, outcome, end], { limitations: [...limitations, ...(success ? [] : [run.summary])] });
  const classification = await diagnosePackage(episodeDir);
  outcome.label = label = classification.label;
  if (label === 'failed' && success) {
    success = false;
    end.ok = false;
    end.summary = run.summary = `Episode verification failed: ${classification.reasons.join('; ')}`;
  }
  await emitEvidence(run, outcome);
  // Exposure and model self-report alone are insufficient: require final, relevant
  // external checks and a successful, non-unsafe run. Never infer causal benefit.
  if (success && label !== 'unsafe_invalid' && !deps.signal?.aborted) await creditApplications(run, label, passed);
  await emit(run, end);
  await buildEpisodePackage(dirname(deps.runsDir), runId, run.events, { limitations: [...limitations, ...(success ? [] : [run.summary])] });
  await persistStatus(run, success, run.summary);
  // Best-effort, throttled brain upkeep after the episode is learned; never affects the run outcome.
  await autoMaintain(deps.brain, dirname(deps.runsDir), { now: deps.now?.() ?? new Date() }).catch(() => undefined);
  return { runId, ok: success, summary: run.summary, events: run.events, steps: run.steps, episodeDir };
}

/** Emits the git-diff entropy findings since the run started; true when any of this run's findings is unsafe. */
async function auditEntropy(run: RunState): Promise<boolean> {
  let unsafe = false;
  if (run.startCommit) {
    try {
      const audit = await auditGitDiff(run.deps.cwd, run.startCommit, run.requirements.map(requirement => requirement.id));
      unsafe = audit.findings.some(finding => UNSAFE.includes(finding.category));
      for (const finding of audit.findings) await emitEvidence(run, { type: 'entropy.finding', ...finding, at: at(run) });
    } catch (error) {
      run.limitations.push(`Git diff entropy audit unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    run.limitations.push('Git start commit unavailable; entropy audit was not run.');
  }
  return unsafe || run.events.some(event => event.type === 'entropy.finding' && UNSAFE.includes(event.category));
}

/** Credits each applied note whose requirements are all covered by relevant checks that passed. */
async function creditApplications(run: RunState, label: OutcomeLabel, passed: (checkId: string) => boolean): Promise<void> {
  for (const [noteId, application] of run.applications) {
    const relevant = run.effectiveChecks.filter(check => check.requirementIds.some(id => application.requirementIds.includes(id)));
    const covered = application.requirementIds.every(id => relevant.some(check => check.requirementIds.includes(id)));
    if (!covered || !relevant.length || !relevant.every(check => passed(check.id))) continue;
    const feedback: FeedbackContext = {
      // The persistent ledger is per note; keep its event key bounded regardless of note ID length.
      eventId: `${run.runId}:${label}`, verified: true,
      evidence: [`application:${application.application}`, ...relevant.map(check => `deterministic-check:${check.id}`)],
    };
    try { await run.deps.brain.feedback(noteId, true, feedback); }
    catch (error) { run.limitations.push(`Feedback for ${noteId} unavailable: ${error instanceof Error ? error.message : String(error)}`); }
  }
}
