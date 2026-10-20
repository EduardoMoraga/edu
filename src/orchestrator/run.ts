import { appendFile, mkdir, open, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWrite } from '../brain/store.js';
import { autoMaintain } from '../brain/auto-maintain.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { Brain } from '../brain/index.js';
import type { ApprovalPolicy, CliId, ContextPack, EduConfig, EduEvent, Engine, EngineRunRequest, FeedbackContext, HarnessLevel, OutcomeLabel, RoleId } from '../core/contracts.js';
import { buildEpisodePackage } from '../evidence/package.js';
import { diagnosePackage } from '../evidence/classify.js';
import { loadChecks, loadTools, runCheck } from '../evidence/registry.js';
import { auditGitDiff } from '../evidence/entropy.js';
import { assignCli } from './assign.js';
import type { ContextProvider } from './types.js';
import { extractPlan, planningPrompt, repairPrompt } from './plan.js';
import { applyPlaybookRoles, loadPlaybook, workerMethod } from './playbook.js';
import { writeSpec } from './spec.js';

export interface ApprovalRequest { agentId: string; stepId: string; title: string; detail: string }
export interface OrchestrateDeps {
  config: EduConfig; brain: Brain; context: ContextProvider; engines: (cli: CliId) => Engine;
  available: CliId[]; cwd: string; onEvent(event: EduEvent): void | Promise<void>;
  approve(request: ApprovalRequest): Promise<boolean>; signal?: AbortSignal; runsDir: string; now?: () => Date;
  harnessLevel?: HarnessLevel;
  playbookName?: string;
  /** True when an upstream --yes policy, rather than a human, answers approval prompts. */
  autoApprove?: boolean;
  composerMessages?: AsyncIterable<string>;
}
export interface StepResult { id: string; ok: boolean; summary: string; skipped?: boolean }
export interface RunResult { runId: string; ok: boolean; summary: string; events: EduEvent[]; steps: StepResult[]; episodeDir?: string }
const ApplicationSchema = z.object({ noteId: z.string().min(1), requirementIds: z.array(z.string().min(1)).min(1), application: z.string().min(1) }).strict();
const VerdictSchema = z.object({ verdict: z.enum(['pass', 'fix']), issues: z.array(z.string()) }).strict();
const exec = promisify(execFile);
const iso = (deps: OrchestrateDeps) => (deps.now?.() ?? new Date()).toISOString();

/** Runs a plan with explicit approvals, dependency ordering, cancellation, and JSONL replay. */
export async function orchestrate(goal: string, deps: OrchestrateDeps): Promise<RunResult> {
  const runId = randomUUID();
  const events: EduEvent[] = [];
  const evidenceEvents: EduEvent[] = [];
  const allEvents: EduEvent[] = [];
  let harnessLevel = deps.harnessLevel ?? 'H3';
  let activeDeps = deps;
  let methodSummary = '';
  const startCommit = await exec('git', ['rev-parse', 'HEAD'], { cwd: deps.cwd }).then(result => result.stdout.trim()).catch(() => undefined);
  const steps: StepResult[] = [];
  const at = () => iso(deps);
  await mkdir(deps.runsDir, { recursive: true });
  const emit = async (event: EduEvent) => {
    events.push(event);
    allEvents.push(event);
    const file = await open(join(deps.runsDir, `${runId}.jsonl`), 'a');
    try {
      await file.write(`${JSON.stringify(event)}\n`, undefined, 'utf8');
      await file.sync();
    } finally { await file.close(); }
    await deps.onEvent(event);
  };
  const emitEvidence = async (event: EduEvent) => {
    evidenceEvents.push(event);
    events.push(event);
    allEvents.push(event);
    await appendFile(join(deps.runsDir, `${runId}.jsonl`), `${JSON.stringify(event)}\n`, 'utf8');
    await deps.onEvent(event);
  };
  let composerClosed = false;
  const composerIterator = deps.composerMessages?.[Symbol.asyncIterator]();
  let composerEmission: Promise<void> | undefined;
  const observeComposer = () => composerIterator ? (async () => {
    try {
      while (!composerClosed) {
        const next = await composerIterator.next();
        if (composerClosed || next.done) break;
        const avoidable = isAvoidableComposerMessage(next.value);
        composerEmission = emitEvidence({ type: 'intervention', by: 'user', action: 'composer-message', detail: next.value, avoidable, harnessGap: avoidable ? 'context' : 'unknown', at: at() });
        await composerEmission;
      }
    } catch { /* A closing composer stream must not invalidate the run. */ }
  })() : undefined;
  const start: EduEvent = { type: 'run.start', runId, goal, mode: deps.config.mode, at: at() };
  await emit(start);
  void observeComposer();
  let sessionId: string | undefined;
  let episodeClosed = false;
  let pack: ContextPack = { text: '', tokens: 0, budgetTokens: deps.config.context.budgetTokens, sections: [], deferred: [] };
  let requirements: Array<{ id: string; text: string }> = [];
  let effectiveChecks: Awaited<ReturnType<typeof loadChecks>> = [];
  let registeredChecks: Awaited<ReturnType<typeof loadChecks>> = [];
  let registryInfo = '';
  let taskState = '';
  let taskStatePath: string | undefined;
  let workflowEvidence = '';
  let summary = 'Run failed.';
  const limitations: string[] = [];
  const applications = new Map<string, { requirementIds: string[]; application: string }>();
  const suppliedNotes = new Set<string>();
  try {
    if (deps.signal?.aborted) throw new Error('Run cancelled before start.');
    const playbook = await loadPlaybook(deps.playbookName ?? deps.config.playbook ?? 'default', dirname(deps.runsDir));
    harnessLevel = deps.harnessLevel ?? playbook.harness;
    methodSummary = workerMethod(playbook);
    activeDeps = { ...deps, config: applyPlaybookRoles(deps.config, playbook) };
    if (harnessLevel === 'H2' || harnessLevel === 'H3') {
      pack = await deps.context.build({ query: goal, budgetTokens: deps.config.context.budgetTokens });
      for (const section of pack.sections) for (const noteId of section.noteIds) {
        // Only IDs actually visible in the delivered pack can receive credit.
        if (pack.text.includes(`[[${noteId}]]`)) suppliedNotes.add(noteId);
        await emitEvidence({ type: 'context.trace', noteId, contribution: section.title, influenced: false, at: at() });
      }
    }
    const session = await deps.brain.openSession(`Run: ${goal}`, 'edu:orchestrator');
    sessionId = session.meta.id;
    if (harnessLevel !== 'H0') {
      const [tools, checks] = await Promise.all([loadTools(deps.cwd), loadChecks(deps.cwd)]);
      registeredChecks = checks;
      registryInfo = JSON.stringify({ tools, checks }, null, 2);
    }
    if (harnessLevel === 'H2' || harnessLevel === 'H3') {
      taskStatePath = join(deps.runsDir, runId, 'task-state.md');
      await mkdir(dirname(taskStatePath), { recursive: true });
      taskState = `# Task state\n\n## Goal\n${goal}\n\n## Hypotheses\n- None recorded yet.\n\n## Inspected files\n- None recorded yet.\n\n## Open questions\n- None recorded yet.\n\n## Next steps\n- Planner is preparing the task plan.\n`;
      await writeFile(taskStatePath, taskState, 'utf8');
    }
    const leadId = `${runId}-lead`;
    const leadCli = assignCli('lead', activeDeps.config, deps.available);
    const planningMethod = `Playbook: ${playbook.name}\n${playbook.description}\n\n${playbook.body}`;
    const prompt = planningPrompt(goal, '', { harnessLevel, playbook: planningMethod });
    const planText = await runText(activeDeps, emit, leadCli, leadId, 'lead', prompt, 'readonly', supportContext(), methodSummary);
    let plan;
    try { plan = extractPlan(planText.text); }
    catch (first) {
      const repaired = await runText(activeDeps, emit, leadCli, leadId, 'lead', `${repairPrompt(planText.text, String(first))}\n\nFollow this playbook method when planning:\n${planningMethod}`, 'readonly', supportContext(), methodSummary);
      try { plan = extractPlan(repaired.text); }
      catch (second) { throw new Error(`Unable to produce a valid plan after one repair: ${String(second)}`); }
    }
    await emit({ type: 'agent.end', agentId: leadId, ok: true, summary: `Planned ${plan.steps.length} step(s).`, ...(planText.sessionId ? { sessionId: planText.sessionId } : {}), at: at() });
    requirements = plan.requirements;
    await emitEvidence({ type: 'task.define', requirements, successCriteria: requirements.map((requirement) => requirement.text), at: at() });
    effectiveChecks = resolveChecks(plan.checks, registeredChecks);
    if (harnessLevel === 'H3') {
      const requirementIds = new Set(requirements.map(requirement => requirement.id));
      const selectedIds = new Set(effectiveChecks.map(check => check.id));
      for (const check of registeredChecks) {
        if (!check.requirementIds.some(requirementId => requirementIds.has(requirementId)) || selectedIds.has(check.id)) continue;
        await emitEvidence({ type: 'entropy.finding', category: 'checks-bypassed', severity: 3, path: '.edu/harness/checks.json', detail: `Applicable registered check '${check.id}' was omitted from the H3 plan.`, at: at() });
      }
    }
    if (taskStatePath) {
      taskState = `# Task state\n\n## Goal\n${goal}\n\n## Hypotheses\n- None recorded yet.\n\n## Inspected files\n- None recorded yet.\n\n## Open questions\n- None recorded yet.\n\n## Next steps\n${plan.steps.map((step) => `- ${step.id}: ${step.task}`).join('\n') || '- Report the task outcome.'}\n`;
      await writeFile(taskStatePath, taskState, 'utf8');
    }
    for (const step of plan.steps) {
      if (step.role !== 'explorer' && step.role !== 'builder' && step.role !== 'reviewer') throw new Error(`Unsupported plan role '${step.role}' in step '${step.id}'.`);
    }
    const spec = await writeSpec(dirname(deps.runsDir), goal, playbook.name, harnessLevel, plan, activeDeps.config, deps.available, deps.now?.() ?? new Date(), runId);
    await emit({ type: 'spec.ready', path: spec.path, requirements, checks: plan.checks, steps: plan.steps.map(step => ({ id: step.id, role: step.role, cli: assignCli(step.role, activeDeps.config, deps.available), task: step.task })), at: at() });
    const hasProposedChecks = plan.checks.some(check => !registeredChecks.some(registered => sameCheck(registered, check)));
    if (playbook.requireSpecApproval || hasProposedChecks) {
      const agentId = `${runId}-lead`;
      const approvalId = `${runId}-approval-spec`;
      await emit({ type: 'approval.request', agentId, approvalId, title: 'Approve spec', detail: spec.markdown, at: at() });
      let approved = false;
      try { approved = await awaitApproval(deps.approve({ agentId, stepId: 'spec', title: 'Approve spec', detail: spec.markdown }), deps.signal); }
      catch (error) { await emit({ type: 'error', agentId, message: `Approval failed: ${String(error)}`, at: at() }); }
      if (deps.signal?.aborted) throw new Error('Run cancelled while awaiting spec approval.');
      const policyApproval = deps.autoApprove || activeDeps.config.approvals === 'auto';
      await emit({ type: 'approval.resolve', approvalId, approved, by: policyApproval ? 'policy' : 'user', at: at() });
      if (!policyApproval) await recordApprovalIntervention(approved, 'spec approval');
      if (!approved) {
        summary = 'spec rejected';
        for (const step of plan.steps) steps.push({ id: step.id, ok: false, summary: 'Not run because the spec was rejected.', skipped: true });
        await closeEpisode(sessionId, summary);
        return await finish(false);
      }
    }
    const approvals = plan.steps.filter(step => needsApproval(activeDeps.config.approvals, activeDeps.config.roles.find(role => role.id === step.role)?.autonomy ?? 'readonly'));
    for (const step of approvals) {
      const agentId = `${runId}-${step.id}`;
      const approvalId = `${runId}-approval-${step.id}`;
      await emit({ type: 'approval.request', agentId, approvalId, title: `Approve ${step.role} step`, detail: step.task, at: at() });
      let approved = false;
      try { approved = await awaitApproval(deps.approve({ agentId, stepId: step.id, title: `Approve ${step.role} step`, detail: step.task }), deps.signal); }
      catch (error) { await emit({ type: 'error', agentId, message: `Approval failed: ${String(error)}`, at: at() }); }
      if (deps.signal?.aborted) throw new Error('Run cancelled while awaiting approval.');
      await emit({ type: 'approval.resolve', approvalId, approved, by: deps.autoApprove ? 'policy' : 'user', at: at() });
      if (!deps.autoApprove) await recordApprovalIntervention(approved, step.task);
      if (!approved) {
        for (const candidate of plan.steps) steps.push({ id: candidate.id, ok: false, summary: candidate.id === step.id ? 'Approval rejected.' : 'Not run because approval was rejected.', skipped: true });
        summary = `Run stopped: approval rejected for step '${step.id}'.`;
        await closeEpisode(sessionId, summary);
        await emit({ type: 'agent.status', agentId, status: 'cancelled', at: at() });
        return await finish(false);
      }
    }

    if (harnessLevel === 'H3') workflowEvidence = await reproduceChecks(effectiveChecks);

    const completed = new Map<string, string>();
    const pending = new Map(plan.steps.map(step => [step.id, step]));
    while (pending.size) {
      if (deps.signal?.aborted) throw new Error('Run cancelled.');
      const ready = [...pending.values()].filter(step => step.dependsOn.every(id => completed.has(id)));
      if (!ready.length) throw new Error('Plan contains a dependency cycle or an unsatisfied dependency.');
      const first = ready[0]!;
      const firstRole = activeDeps.config.roles.find(role => role.id === first.role);
      const firstReadonly = firstRole?.autonomy === 'readonly';
      const batch = first.parallelSafe && firstReadonly
        ? ready.filter(step => step.parallelSafe && activeDeps.config.roles.find(role => role.id === step.role)?.autonomy === 'readonly').slice(0, 3)
        : [first];
      const batchController = new AbortController();
      const batchSignal = deps.signal ? AbortSignal.any([deps.signal, batchController.signal]) : batchController.signal;
      const settled = await Promise.allSettled(batch.map(step => executeStep(step, batchSignal).catch(error => {
        batchController.abort();
        throw error;
      })));
      const failed = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failed) throw failed.reason;
      for (const result of settled) {
        if (result.status !== 'fulfilled') continue;
        const outcome = result.value;
        pending.delete(outcome.id);
        steps.push(outcome);
        if (!outcome.ok) throw new Error(`Step '${outcome.id}' failed: ${outcome.summary}`);
        completed.set(outcome.id, outcome.summary);
        if (taskStatePath) {
          taskState += `\n## Progress\n- ${outcome.id}: ${outcome.ok ? 'completed' : 'failed'} — ${outcome.summary}\n`;
          await writeFile(taskStatePath, taskState, 'utf8');
        }
      }
    }

    const builder = activeDeps.config.roles.find(role => role.id === 'builder');
    let fixRounds = 0;
    let reviewRounds = 0;
    let verdict: z.infer<typeof VerdictSchema>;
    // Each correction consumes the same budget, regardless of who requested it.
    while (true) {
      if (effectiveChecks.length) {
        let results = await verifyChecks(effectiveChecks);
        while (results.some(result => !result.ok) && builder && fixRounds < playbook.maxFixRounds) {
          const round = ++fixRounds;
          const details = results.filter(result => !result.ok).map(result => {
            const check = effectiveChecks.find(candidate => candidate.id === result.checkId)!;
            return `${check.id}: observed exit=${result.exitCode}, stdout=${JSON.stringify(result.stdout)}, stderr=${JSON.stringify(result.stderr)}, timeout=${result.timedOut}; expected exit=${check.expect.exitCode ?? 0}${check.expect.stdoutIncludes === undefined ? '' : `, stdout includes ${JSON.stringify(check.expect.stdoutIncludes)}`}`;
          }).join('\n');
          if (needsApproval(activeDeps.config.approvals, builder.autonomy)) {
            const agentId = `${runId}-verification-fix-${round}`;
            const approvalId = `${runId}-approval-verification-fix-${round}`;
            const title = 'Approve deterministic-verification correction';
            const detail = `A deterministic check failed; authorize bounded builder correction ${round}/${playbook.maxFixRounds}.\n${details}`;
            await emit({ type: 'approval.request', agentId, approvalId, title, detail, at: at() });
            let approved = false;
            try { approved = await awaitApproval(deps.approve({ agentId, stepId: `verification-fix-${round}`, title, detail }), deps.signal); }
            catch (error) { await emit({ type: 'error', agentId, message: `Approval failed: ${String(error)}`, at: at() }); }
            if (deps.signal?.aborted) throw new Error('Run cancelled while awaiting verification correction approval.');
            await emit({ type: 'approval.resolve', approvalId, approved, by: deps.autoApprove ? 'policy' : 'user', at: at() });
            if (!deps.autoApprove) await recordApprovalIntervention(approved, detail);
            if (!approved) throw new Error('Run stopped: deterministic-verification correction was rejected.');
          }
          const fix = await runText(activeDeps, emit, assignCli('builder', activeDeps.config, deps.available), `${runId}-verification-fix-${round}`, 'builder',
            `${builderPrompt('Correct the failed deterministic verification.', goal, `Observed vs expected:\n${details}`, harnessLevel)}\nReproduce, attribute, fix, verify, then report. If verification disproves attribution, return to attribution before changing code.`, builder.autonomy, supportContext(), methodSummary);
          await recordApplications(fix.text);
          steps.push({ id: `verification-fix-${round}`, ok: true, summary: fix.summary });
          results = await verifyChecks(effectiveChecks);
        }
        if (results.some(result => !result.ok)) throw new Error(`Deterministic verification failed after ${playbook.maxFixRounds} fix round(s).`);
      }
      const reviewerId = `${runId}-reviewer${reviewRounds++ ? `-${reviewRounds}` : ''}`;
      const reviewerCli = assignCli('reviewer', activeDeps.config, deps.available);
      const review = await runText(activeDeps, emit, reviewerCli, reviewerId, 'reviewer',
        `Review the completed work. Return strict JSON {"verdict":"pass"|"fix","issues":[string]}.\nGoal: ${goal}\nRequirements: ${JSON.stringify(requirements)}\nSteps: ${JSON.stringify(steps)}`,
        'readonly', supportContext(), methodSummary);
      try { verdict = VerdictSchema.parse(parseJson(review.text)); }
      catch (error) { throw new Error(`Reviewer returned invalid JSON: ${String(error)}`); }
      if (verdict.verdict === 'pass') break;
      if (fixRounds >= playbook.maxFixRounds) throw new Error(`Review requested a fix after the global budget of ${playbook.maxFixRounds} fix round(s) was exhausted.`);
      fixRounds++;
      if (!builder) throw new Error('Review requested a fix but no builder role is configured.');
      if (needsApproval(activeDeps.config.approvals, builder.autonomy)) {
        const approvalId = `${runId}-approval-review-fix-${fixRounds}`;
        const agentId = `${runId}-fix-${fixRounds}`;
        const title = 'Approve review-fix builder step';
        const detail = verdict.issues.join('; ') || 'Apply the review-requested correction.';
        await emit({ type: 'approval.request', agentId, approvalId, title, detail, at: at() });
        let approved = false;
        try { approved = await awaitApproval(deps.approve({ agentId, stepId: 'review-fix', title, detail }), deps.signal); }
        catch (error) { await emit({ type: 'error', agentId, message: `Approval failed: ${String(error)}`, at: at() }); }
        if (deps.signal?.aborted) throw new Error('Run cancelled while awaiting review-fix approval.');
        await emit({ type: 'approval.resolve', approvalId, approved, by: deps.autoApprove ? 'policy' : 'user', at: at() });
        if (!deps.autoApprove) await recordApprovalIntervention(approved, detail);
        if (!approved) {
          summary = 'Run stopped: approval rejected for review-requested builder fix.';
          await closeEpisode(sessionId, summary);
          await emit({ type: 'agent.status', agentId, status: 'cancelled', at: at() });
          return await finish(false);
        }
      }
      const fixId = `${runId}-fix-${fixRounds}`;
      const fix = await runText(activeDeps, emit, builder.cli && activeDeps.config.mode === 'crew' ? builder.cli : assignCli('builder', activeDeps.config, deps.available), fixId, 'builder',
        `${builderPrompt(`Address these review issues in one fix round only: ${JSON.stringify(verdict.issues)}`, goal, workflowEvidence, harnessLevel)}\nCompleted steps: ${JSON.stringify([...completed])}`, builder.autonomy, supportContext(), methodSummary);
      await recordApplications(fix.text);
      steps.push({ id: reviewRounds === 1 ? 'review-fix' : `review-fix-${fixRounds}`, ok: true, summary: fix.summary });
      // Return through deterministic verification before the next independent review.
    }
    summary = `Completed ${steps.length} step(s); review ${verdict.verdict}${verdict.issues.length ? `: ${verdict.issues.join('; ')}` : ''}.`;
    await closeEpisode(sessionId, summary);
    return await finish(true);
  } catch (error) {
    summary = error instanceof Error ? error.message : String(error);
    if (sessionId) await closeEpisode(sessionId, summary).catch(() => {});
    await emit({ type: 'error', message: summary, at: at() });
    return await finish(false);
  }

  async function executeStep(step: { id: string; role: string; task: string; dependsOn: string[] }, signal?: AbortSignal): Promise<StepResult> {
    const role = activeDeps.config.roles.find(candidate => candidate.id === step.role);
    const cli = assignCli(step.role, activeDeps.config, deps.available);
    const agentId = `${runId}-${step.id}`;
    const dependencyContext = step.dependsOn.map(id => `${id}: ${steps.find(item => item.id === id)?.summary ?? ''}`).join('\n');
    const prompt = step.role === 'builder'
      ? `${builderPrompt(step.task, goal, workflowEvidence, harnessLevel)}\n\nDependencies:\n${dependencyContext}`
      : `${step.task}\n\nGoal: ${goal}\n\nDependencies:\n${dependencyContext}`;
    const response = await runText(activeDeps, emit, cli, agentId, step.role, prompt, role?.autonomy ?? 'readonly', supportContext(), methodSummary, signal);
    if (step.role === 'builder') await recordApplications(response.text);
    return { id: step.id, ok: true, summary: response.summary || response.text };
  }
  async function closeEpisode(id: string | undefined, text: string) {
    if (!id || episodeClosed) return;
    await deps.brain.closeSession(id, text);
    episodeClosed = true;
    await emit({ type: 'brain.learn', noteId: id, kind: 'episode', title: `Run: ${goal}`, at: at() });
    await atomicWrite(join(dirname(deps.runsDir), 'reflect-queue', `${runId}.json`), `${JSON.stringify({ runId, sessionId: id, queuedAt: at() }, null, 2)}\n`);
  }
  async function finish(success: boolean): Promise<RunResult> {
    composerClosed = true;
    try { void Promise.resolve(composerIterator?.return?.()).catch(() => {}); } catch { /* Iterator cleanup is best-effort and must not block the run. */ }
    await composerEmission?.catch(() => {});
    let entropyUnsafe = false;
    if (startCommit) {
      try {
        const audit = await auditGitDiff(deps.cwd, startCommit, requirements.map(requirement => requirement.id));
        entropyUnsafe = audit.findings.some(finding => ['weakened-tests', 'checks-bypassed', 'unsafe-invalid'].includes(finding.category));
        for (const finding of audit.findings) {
          await emitEvidence({ type: 'entropy.finding', ...finding, at: at() });
        }
      } catch (error) {
        limitations.push(`Git diff entropy audit unavailable: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      limitations.push('Git start commit unavailable; entropy audit was not run.');
    }
    entropyUnsafe ||= allEvents.some(event => event.type === 'entropy.finding' && ['weakened-tests', 'checks-bypassed', 'unsafe-invalid'].includes(event.category));
    const latestChecks = new Map<string, Extract<EduEvent, { type: 'verify.result' }>>();
    for (const event of evidenceEvents) if (event.type === 'verify.result' && event.kind === 'deterministic' && event.checkId) latestChecks.set(event.checkId, event);
    const verifiedRequirements = requirements.filter(requirement => {
      const checks = effectiveChecks.filter(check => check.requirementIds.includes(requirement.id));
      return checks.length > 0 && checks.every(check => latestChecks.get(check.id)?.ok && !latestChecks.get(check.id)?.timedOut);
    }).map(requirement => requirement.id);
    const verified = requirements.length > 0 && verifiedRequirements.length === requirements.length;
    // A later review or a different check on the same requirement cannot erase a failure.
    success &&= [...latestChecks.values()].every(result => result.ok && !result.timedOut);
    const hasIntervention = evidenceEvents.some(event => event.type === 'intervention' || (event.type === 'approval.resolve' && event.by !== 'policy'));
    let label: OutcomeLabel = entropyUnsafe ? 'unsafe_invalid' : !success ? 'failed' : !verified ? 'unverified_success' : hasIntervention ? 'assisted_verified_success' : 'autonomous_verified_success';
    const outcome: Extract<EduEvent, { type: 'outcome' }> = { type: 'outcome', label, metrics: { harnessLevel, cli: activeDeps.config.defaultCli, role: 'builder', verifiedRequirements, entropySeverity: evidenceEvents.filter(event => event.type === 'entropy.finding').reduce((severity, event) => Math.max(severity, event.severity), 0), elapsedMs: Date.parse(at()) - Date.parse(events[0]?.at ?? at()) }, at: at() };
    const end: Extract<EduEvent, { type: 'run.end' }> = { type: 'run.end', runId, ok: success, summary, at: at() };
    // API8 reads complete packages. Validate a terminal candidate before emitting
    // the single terminal pair or awarding credit; publish the final snapshot below.
    const episodeDir = await buildEpisodePackage(dirname(deps.runsDir), runId, [...allEvents, outcome, end], { limitations: [...limitations, ...(success ? [] : [summary])] });
    const classification = await diagnosePackage(episodeDir);
    outcome.label = label = classification.label;
    if (label === 'failed' && success) {
      success = false;
      end.ok = false;
      end.summary = summary = `Episode verification failed: ${classification.reasons.join('; ')}`;
    }
    await emitEvidence(outcome);
    // Exposure and model self-report alone are insufficient: require final, relevant
    // external checks and a successful, non-unsafe run. Never infer causal benefit.
    if (success && label !== 'unsafe_invalid' && !deps.signal?.aborted) for (const [noteId, application] of applications) {
      const relevant = effectiveChecks.filter(check => check.requirementIds.some(id => application.requirementIds.includes(id)));
      const covered = application.requirementIds.every(id => relevant.some(check => check.requirementIds.includes(id)));
      const passed = relevant.length > 0 && relevant.every(check => latestChecks.get(check.id)?.ok && !latestChecks.get(check.id)?.timedOut);
      if (!covered || !passed) continue;
      const feedback: FeedbackContext = {
        // The persistent ledger is per note; keep its event key bounded regardless of note ID length.
        eventId: `${runId}:${label}`, verified: true,
        evidence: [`application:${application.application}`, ...relevant.map(check => `deterministic-check:${check.id}`)],
      };
      try { await deps.brain.feedback(noteId, true, feedback); }
      catch (error) { limitations.push(`Feedback for ${noteId} unavailable: ${error instanceof Error ? error.message : String(error)}`); }
    }
    await emit(end);
    await buildEpisodePackage(dirname(deps.runsDir), runId, allEvents, { limitations: [...limitations, ...(success ? [] : [summary])] });
    // Best-effort, throttled brain upkeep after the episode is learned; never affects the run outcome.
    await autoMaintain(deps.brain, dirname(deps.runsDir), { now: deps.now?.() ?? new Date() });
    return { runId, ok: success, summary, events, steps, episodeDir };
  }

  async function recordApprovalIntervention(approved: boolean, detail: string): Promise<void> {
    const avoidable = !approved && isAvoidableComposerMessage(detail);
    await emitEvidence({ type: 'intervention', by: 'user', action: approved ? 'approval:approved' : 'approval:rejected', detail, avoidable, harnessGap: avoidable ? 'feedback' : 'unknown', at: at() });
  }

  async function reproduceChecks(checks: Awaited<ReturnType<typeof loadChecks>>): Promise<string> {
    if (!checks.length) return '';
    const results = await Promise.all(checks.map((check) => executeCheck(check)));
    for (const result of results) {
      const check = checks.find((candidate) => candidate.id === result.checkId)!;
      await emitEvidence({ type: 'verify.result', checkId: result.checkId, requirementIds: check.requirementIds, ok: result.ok, output: result.output, exitCode: result.exitCode, durationMs: result.durationMs, timedOut: result.timedOut, kind: 'reproduction', at: at() });
      if (!result.ok) await emitCheckAttribution(check, result);
    }
    return results.map((result) => `${result.checkId}: ${result.ok ? 'passed' : 'failed'} — ${result.output}`).join('\n');
  }

  async function verifyChecks(checks: Awaited<ReturnType<typeof loadChecks>>) {
    const results = await Promise.all(checks.map((check) => executeCheck(check)));
    for (const result of results) {
      const check = checks.find((candidate) => candidate.id === result.checkId)!;
      await emitEvidence({ type: 'verify.result', checkId: result.checkId, requirementIds: check.requirementIds, ok: result.ok, output: result.output, exitCode: result.exitCode, durationMs: result.durationMs, timedOut: result.timedOut, kind: 'deterministic', at: at() });
      if (!result.ok) await emitCheckAttribution(check, result);
    }
    return results;
  }

  async function executeCheck(check: Awaited<ReturnType<typeof loadChecks>>[number]) {
    const callId = `${runId}-check-${check.id}-${randomUUID()}`;
    await emit({ type: 'tool.call', agentId: `${runId}-h3-checks`, callId, tool: 'deterministic-check', input: JSON.stringify({ checkId: check.id, command: check.command }), at: at() });
    const result = await runCheck(check, deps.cwd, deps.signal);
    await emit({ type: 'tool.result', agentId: `${runId}-h3-checks`, callId, ok: result.ok, output: JSON.stringify({ exitCode: result.exitCode, durationMs: result.durationMs, timedOut: result.timedOut, stdout: result.stdout, stderr: result.stderr }), at: at() });
    return result;
  }

  async function emitCheckAttribution(check: Awaited<ReturnType<typeof loadChecks>>[number], result: Awaited<ReturnType<typeof runCheck>>) {
    await emitEvidence({
      type: 'failure.attribution', failureType: 'verify',
      observed: `Check '${check.id}' exited ${result.exitCode ?? 'without an exit code'}${result.timedOut ? ' after timing out' : ''}; stdout=${JSON.stringify(result.stdout)}; stderr=${JSON.stringify(result.stderr)}.`,
      expected: `Expected exit code ${check.expect.exitCode ?? 0}${check.expect.stdoutIncludes === undefined ? '' : ` and stdout to include ${JSON.stringify(check.expect.stdoutIncludes)}`}.`,
      evidence: [`registered-check:${check.id}`, `exitCode:${result.exitCode ?? 'null'}`, `timedOut:${result.timedOut}`, `stdout:${result.stdout}`, `stderr:${result.stderr}`],
      alternatives: [], next: 'Inspect the captured check evidence and identify the cause before making a correction.', at: at(),
    });
  }

  async function recordApplications(text: string): Promise<void> {
    for (const line of text.split('\n')) {
      if (!line.startsWith('EDU_APPLIED ')) continue;
      let value: unknown;
      try { value = JSON.parse(line.slice('EDU_APPLIED '.length)); }
      catch { continue; }
      const parsed = ApplicationSchema.safeParse(value);
      if (!parsed.success) continue;
      const entry = parsed.data;
      if (!suppliedNotes.has(entry.noteId) || !entry.application.includes(`[[${entry.noteId}]]`) ||
          !entry.requirementIds.every(id => requirements.some(requirement => requirement.id === id))) continue;
      const previous = applications.get(entry.noteId);
      applications.set(entry.noteId, { requirementIds: [...new Set([...(previous?.requirementIds ?? []), ...entry.requirementIds])], application: previous ? `${previous.application}\n${entry.application}` : entry.application });
      if (!previous) await emitEvidence({ type: 'context.trace', noteId: entry.noteId, contribution: entry.application, influenced: true, at: at() });
    }
  }

  function supportContext(): string {
    const sections: string[] = [];
    if (harnessLevel !== 'H0') sections.push(`Tool and check registry:\n${registryInfo || 'No registered tools or checks.'}`);
    if (harnessLevel === 'H2' || harnessLevel === 'H3') {
      if (pack.text) sections.push(`Brain context pack:\n${pack.text}`);
      if (taskState) sections.push(`Task state:\n${taskState}`);
    }
    return sections.join('\n\n');
  }
}

function needsApproval(policy: ApprovalPolicy, autonomy: string): boolean {
  return policy === 'always-ask' || (policy === 'ask-on-write' && (autonomy === 'auto' || autonomy === 'full'));
}

async function awaitApproval(approval: Promise<boolean>, signal?: AbortSignal): Promise<boolean> {
  if (!signal) return approval;
  if (signal.aborted) throw new Error('Run cancelled while awaiting approval.');
  return Promise.race([approval, new Promise<boolean>((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Run cancelled while awaiting approval.')), { once: true });
  })]);
}

function parseJson(value: string): unknown {
  const match = value.trim().match(/```(?:json)?\s*([\s\S]*?)```/i);
  try { return JSON.parse(match?.[1]?.trim() ?? value.trim()); }
  catch (error) { throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
}

async function runText(deps: OrchestrateDeps, emit: (event: EduEvent) => Promise<void>, cli: CliId, agentId: string, roleId: RoleId, prompt: string, autonomy: EngineRunRequest['autonomy'], context: string, methodSummary = '', signal: AbortSignal | undefined = deps.signal): Promise<{ text: string; summary: string; sessionId?: string }> {
  const role = deps.config.roles.find(candidate => candidate.id === roleId);
  await emit({ type: 'agent.spawn', agentId, role: roleId, cli, task: prompt.slice(0, 160), at: (deps.now?.() ?? new Date()).toISOString() });
  await emit({ type: 'agent.status', agentId, status: 'running', at: (deps.now?.() ?? new Date()).toISOString() });
  const request: EngineRunRequest = { cli, prompt: `${prompt}\n\nContext pack:\n${context}`, cwd: deps.cwd, autonomy, systemPrompt: [role?.mission, roleId === 'lead' ? '' : methodSummary, roleId === 'builder' && context.includes('Brain context pack:') ? 'If you actually apply a supplied note, cite it explicitly on a separate line: EDU_APPLIED {"noteId":"L-id","requirementIds":["R-1"],"application":"Applied [[L-id]] by ..."}. Report only concrete application, never mere exposure or presumed benefit.' : ''].filter(Boolean).join('\n\n'), ...(role?.model ? { model: role.model } : {}), signal };
  let text = ''; let summary = ''; let sessionId: string | undefined;
  try {
    for await (const event of deps.engines(cli).run(request, agentId)) {
      const stamped = { ...event, at: event.at || (deps.now?.() ?? new Date()).toISOString() } as EduEvent;
      if (stamped.type === 'agent.text') text += stamped.text;
      if (stamped.type === 'agent.end') { summary = stamped.summary; sessionId = stamped.sessionId; }
      await emit(stamped);
      if (signal?.aborted) throw new Error('Run cancelled.');
      if (stamped.type === 'error') throw new Error(`Engine reported an error: ${stamped.message}`);
      if (stamped.type === 'agent.end' && !stamped.ok) throw new Error(`Engine run failed: ${stamped.summary}`);
    }
    if (signal?.aborted) throw new Error('Run cancelled.');
    return { text, summary, ...(sessionId ? { sessionId } : {}) };
  } catch (error) {
    await emit({ type: 'agent.status', agentId, status: signal?.aborted ? 'cancelled' : 'failed', at: (deps.now?.() ?? new Date()).toISOString() });
    throw error;
  }
}

function resolveChecks(planned: Awaited<ReturnType<typeof loadChecks>>, registered: Awaited<ReturnType<typeof loadChecks>>) {
  const byId = new Map(registered.map(check => [check.id, check]));
  return planned.map(check => {
    const configured = byId.get(check.id);
    if (configured && !sameCheck(configured, check)) {
      throw new Error(`Plan check '${check.id}' reuses a registered ID but changes its definition.`);
    }
    return configured ?? check;
  });
}

function sameCheck(left: Awaited<ReturnType<typeof loadChecks>>[number], right: Awaited<ReturnType<typeof loadChecks>>[number]): boolean {
  return left.id === right.id && left.command === right.command && left.timeoutMs === right.timeoutMs &&
    JSON.stringify(left.requirementIds) === JSON.stringify(right.requirementIds) &&
    left.expect.exitCode === right.expect.exitCode && left.expect.stdoutIncludes === right.expect.stdoutIncludes;
}

function builderPrompt(task: string, goal: string, priorEvidence: string, level: HarnessLevel): string {
  const workflow = level === 'H3'
    ? 'Use the H3 workflow: reproduce → attribute → fix → verify → report. Edu runs deterministic checks; if verification disproves the diagnosis, use the back-edge to attribution before the bounded correction.'
    : '';
  return [task, `Goal:\n${goal}`, priorEvidence ? `Prior reproduction evidence:\n${priorEvidence}` : '', workflow].filter(Boolean).join('\n\n');
}

function isAvoidableComposerMessage(message: string): boolean {
  return /\b(?:missing|forgot|should have|please include|must include|wrong path|use the file)\b/i.test(message);
}
