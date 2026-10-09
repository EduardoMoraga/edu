import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Brain } from '../brain/index.js';
import type { ApprovalPolicy, CliId, ContextPack, EduConfig, EduEvent, Engine, EngineRunRequest, RoleId } from '../core/contracts.js';
import { assignCli } from './assign.js';
import type { ContextProvider } from './types.js';
import { extractPlan, planningPrompt, repairPrompt } from './plan.js';

export interface ApprovalRequest { agentId: string; stepId: string; title: string; detail: string }
export interface OrchestrateDeps {
  config: EduConfig; brain: Brain; context: ContextProvider; engines: (cli: CliId) => Engine;
  available: CliId[]; cwd: string; onEvent(event: EduEvent): void | Promise<void>;
  approve(request: ApprovalRequest): Promise<boolean>; signal?: AbortSignal; runsDir: string; now?: () => Date;
}
export interface StepResult { id: string; ok: boolean; summary: string; skipped?: boolean }
export interface RunResult { runId: string; ok: boolean; summary: string; events: EduEvent[]; steps: StepResult[] }
const VerdictSchema = z.object({ verdict: z.enum(['pass', 'fix']), issues: z.array(z.string()) }).strict();
const iso = (deps: OrchestrateDeps) => (deps.now?.() ?? new Date()).toISOString();

/** Runs a plan with explicit approvals, dependency ordering, cancellation, and JSONL replay. */
export async function orchestrate(goal: string, deps: OrchestrateDeps): Promise<RunResult> {
  const runId = randomUUID();
  const events: EduEvent[] = [];
  const steps: StepResult[] = [];
  const at = () => iso(deps);
  await mkdir(deps.runsDir, { recursive: true });
  const emit = async (event: EduEvent) => {
    events.push(event);
    const file = await open(join(deps.runsDir, `${runId}.jsonl`), 'a');
    try {
      await file.write(`${JSON.stringify(event)}\n`, undefined, 'utf8');
      await file.sync();
    } finally { await file.close(); }
    await deps.onEvent(event);
  };
  const start: EduEvent = { type: 'run.start', runId, goal, mode: deps.config.mode, at: at() };
  await emit(start);
  let sessionId: string | undefined;
  let episodeClosed = false;
  let pack: ContextPack = { text: '', tokens: 0, budgetTokens: deps.config.context.budgetTokens, sections: [], deferred: [] };
  let summary = 'Run failed.';
  let ok = false;
  try {
    if (deps.signal?.aborted) throw new Error('Run cancelled before start.');
    pack = await deps.context.build({ query: goal, budgetTokens: deps.config.context.budgetTokens });
    const session = await deps.brain.openSession(`Run: ${goal}`, 'edu:orchestrator');
    sessionId = session.meta.id;
    const leadId = `${runId}-lead`;
    const leadCli = assignCli('lead', deps.config, deps.available);
    const prompt = planningPrompt(goal, pack.text);
    const planText = await runText(deps, emit, leadCli, leadId, 'lead', prompt, 'readonly', pack.text);
    let plan;
    try { plan = extractPlan(planText.text); }
    catch (first) {
      const repaired = await runText(deps, emit, leadCli, leadId, 'lead', repairPrompt(planText.text, String(first)), 'readonly', pack.text);
      try { plan = extractPlan(repaired.text); }
      catch (second) { throw new Error(`Unable to produce a valid plan after one repair: ${String(second)}`); }
    }
    await emit({ type: 'agent.end', agentId: leadId, ok: true, summary: `Planned ${plan.steps.length} step(s).`, ...(planText.sessionId ? { sessionId: planText.sessionId } : {}), at: at() });

    for (const step of plan.steps) {
      if (step.role !== 'explorer' && step.role !== 'builder' && step.role !== 'reviewer') throw new Error(`Unsupported plan role '${step.role}' in step '${step.id}'.`);
    }
    const approvals = plan.steps.filter(step => needsApproval(deps.config.approvals, deps.config.roles.find(role => role.id === step.role)?.autonomy ?? 'readonly'));
    for (const step of approvals) {
      const agentId = `${runId}-${step.id}`;
      const approvalId = `${runId}-approval-${step.id}`;
      await emit({ type: 'approval.request', agentId, approvalId, title: `Approve ${step.role} step`, detail: step.task, at: at() });
      let approved = false;
      try { approved = await awaitApproval(deps.approve({ agentId, stepId: step.id, title: `Approve ${step.role} step`, detail: step.task }), deps.signal); }
      catch (error) { await emit({ type: 'error', agentId, message: `Approval failed: ${String(error)}`, at: at() }); }
      if (deps.signal?.aborted) throw new Error('Run cancelled while awaiting approval.');
      await emit({ type: 'approval.resolve', approvalId, approved, by: 'user', at: at() });
      if (!approved) {
        for (const candidate of plan.steps) steps.push({ id: candidate.id, ok: false, summary: candidate.id === step.id ? 'Approval rejected.' : 'Not run because approval was rejected.', skipped: true });
        summary = `Run stopped: approval rejected for step '${step.id}'.`;
        await closeEpisode(sessionId, summary);
        await emit({ type: 'agent.status', agentId, status: 'cancelled', at: at() });
        return await finish(false);
      }
    }

    const completed = new Map<string, string>();
    const pending = new Map(plan.steps.map(step => [step.id, step]));
    while (pending.size) {
      if (deps.signal?.aborted) throw new Error('Run cancelled.');
      const ready = [...pending.values()].filter(step => step.dependsOn.every(id => completed.has(id)));
      if (!ready.length) throw new Error('Plan contains a dependency cycle or an unsatisfied dependency.');
      const first = ready[0]!;
      const firstRole = deps.config.roles.find(role => role.id === first.role);
      const firstReadonly = firstRole?.autonomy === 'readonly';
      const batch = first.parallelSafe && firstReadonly
        ? ready.filter(step => step.parallelSafe && deps.config.roles.find(role => role.id === step.role)?.autonomy === 'readonly').slice(0, 3)
        : [first];
      const outcomes = await Promise.all(batch.map(step => executeStep(step)));
      for (const outcome of outcomes) {
        pending.delete(outcome.id);
        steps.push(outcome);
        if (!outcome.ok) throw new Error(`Step '${outcome.id}' failed: ${outcome.summary}`);
        completed.set(outcome.id, outcome.summary);
      }
    }

    const builder = deps.config.roles.find(role => role.id === 'builder');
    const reviewerId = `${runId}-reviewer`;
    const reviewerCli = assignCli('reviewer', deps.config, deps.available);
    const review = await runText(deps, emit, reviewerCli, reviewerId, 'reviewer',
      `Review the completed work. Return strict JSON {"verdict":"pass"|"fix","issues":[string]}.\nGoal: ${goal}\nSteps: ${JSON.stringify(steps)}`,
      'readonly', pack.text);
    let verdict;
    try { verdict = VerdictSchema.parse(parseJson(review.text)); }
    catch (error) { throw new Error(`Reviewer returned invalid JSON: ${String(error)}`); }
    if (verdict.verdict === 'fix') {
      if (!builder) throw new Error('Review requested a fix but no builder role is configured.');
      if (needsApproval(deps.config.approvals, builder.autonomy)) {
        const approvalId = `${runId}-approval-review-fix`;
        const agentId = `${runId}-fix`;
        const title = 'Approve review-fix builder step';
        const detail = verdict.issues.join('; ') || 'Apply the review-requested correction.';
        await emit({ type: 'approval.request', agentId, approvalId, title, detail, at: at() });
        let approved = false;
        try { approved = await awaitApproval(deps.approve({ agentId, stepId: 'review-fix', title, detail }), deps.signal); }
        catch (error) { await emit({ type: 'error', agentId, message: `Approval failed: ${String(error)}`, at: at() }); }
        if (deps.signal?.aborted) throw new Error('Run cancelled while awaiting review-fix approval.');
        await emit({ type: 'approval.resolve', approvalId, approved, by: 'user', at: at() });
        if (!approved) {
          summary = 'Run stopped: approval rejected for review-requested builder fix.';
          await closeEpisode(sessionId, summary);
          await emit({ type: 'agent.status', agentId, status: 'cancelled', at: at() });
          return await finish(false);
        }
      }
      const fixId = `${runId}-fix`;
      const fix = await runText(deps, emit, builder.cli && deps.config.mode === 'crew' ? builder.cli : assignCli('builder', deps.config, deps.available), fixId, 'builder',
        `Address these review issues in one fix round only: ${JSON.stringify(verdict.issues)}\nGoal: ${goal}\nContext: ${pack.text}\nCompleted steps: ${JSON.stringify([...completed])}`, builder.autonomy, pack.text);
      steps.push({ id: 'review-fix', ok: true, summary: fix.summary });
    }
    summary = `Completed ${steps.length} step(s); review ${verdict.verdict}${verdict.issues.length ? `: ${verdict.issues.join('; ')}` : ''}.`;
    ok = true;
    await closeEpisode(sessionId, summary);
    return await finish(true);
  } catch (error) {
    summary = error instanceof Error ? error.message : String(error);
    if (sessionId) await closeEpisode(sessionId, summary).catch(() => {});
    await emit({ type: 'error', message: summary, at: at() });
    return await finish(false);
  }

  async function executeStep(step: { id: string; role: string; task: string; dependsOn: string[] }): Promise<StepResult> {
    const role = deps.config.roles.find(candidate => candidate.id === step.role);
    const cli = assignCli(step.role, deps.config, deps.available);
    const agentId = `${runId}-${step.id}`;
    const dependencyContext = step.dependsOn.map(id => `${id}: ${steps.find(item => item.id === id)?.summary ?? ''}`).join('\n');
    const response = await runText(deps, emit, cli, agentId, step.role, `${step.task}\n\nGoal: ${goal}\n\nContext:\n${pack.text}\n\nDependencies:\n${dependencyContext}`, role?.autonomy ?? 'readonly', pack.text);
    return { id: step.id, ok: true, summary: response.summary || response.text };
  }
  async function closeEpisode(id: string | undefined, text: string) {
    if (!id || episodeClosed) return;
    await deps.brain.closeSession(id, text);
    episodeClosed = true;
    await emit({ type: 'brain.learn', noteId: id, kind: 'episode', title: `Run: ${goal}`, at: at() });
  }
  async function finish(success: boolean): Promise<RunResult> {
    const end: EduEvent = { type: 'run.end', runId, ok: success, summary, at: at() };
    await emit(end);
    return { runId, ok: success, summary, events, steps };
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

async function runText(deps: OrchestrateDeps, emit: (event: EduEvent) => Promise<void>, cli: CliId, agentId: string, roleId: RoleId, prompt: string, autonomy: EngineRunRequest['autonomy'], context: string): Promise<{ text: string; summary: string; sessionId?: string }> {
  const role = deps.config.roles.find(candidate => candidate.id === roleId);
  await emit({ type: 'agent.spawn', agentId, role: roleId, cli, task: prompt.slice(0, 160), at: (deps.now?.() ?? new Date()).toISOString() });
  await emit({ type: 'agent.status', agentId, status: 'running', at: (deps.now?.() ?? new Date()).toISOString() });
  const request: EngineRunRequest = { cli, prompt: `${prompt}\n\nContext pack:\n${context}`, cwd: deps.cwd, autonomy, ...(role?.mission ? { systemPrompt: role.mission } : {}), ...(role?.model ? { model: role.model } : {}), signal: deps.signal };
  let text = ''; let summary = ''; let sessionId: string | undefined;
  try {
    for await (const event of deps.engines(cli).run(request, agentId)) {
      const stamped = { ...event, at: event.at || (deps.now?.() ?? new Date()).toISOString() } as EduEvent;
      if (stamped.type === 'agent.text') text += stamped.text;
      if (stamped.type === 'agent.end') { summary = stamped.summary; sessionId = stamped.sessionId; }
      await emit(stamped);
      if (deps.signal?.aborted) throw new Error('Run cancelled.');
      if (stamped.type === 'error') throw new Error(`Engine reported an error: ${stamped.message}`);
      if (stamped.type === 'agent.end' && !stamped.ok) throw new Error(`Engine run failed: ${stamped.summary}`);
    }
    if (deps.signal?.aborted) throw new Error('Run cancelled.');
    return { text, summary, ...(sessionId ? { sessionId } : {}) };
  } catch (error) {
    await emit({ type: 'agent.status', agentId, status: deps.signal?.aborted ? 'cancelled' : 'failed', at: (deps.now?.() ?? new Date()).toISOString() });
    throw error;
  }
}
