import { HUMAN_APPROVERS, type ApprovalBy, type ApprovalPolicy } from '../../core/contracts.js';
import type { ApprovalAnswer } from '../run.js';
import { at, emit, emitEvidence, type RunState } from './state.js';

export function needsApproval(policy: ApprovalPolicy, autonomy: string): boolean {
  return policy === 'always-ask' || (policy === 'ask-on-write' && (autonomy === 'auto' || autonomy === 'full'));
}

export const isHuman = (by: ApprovalBy) => HUMAN_APPROVERS.includes(by);

/** A boolean answer comes from the in-process prompt (or the --yes policy): `fallback` names it. */
export function answerOf(value: boolean | ApprovalAnswer, fallback: ApprovalBy): ApprovalAnswer {
  return typeof value === 'boolean' ? { approved: value, by: fallback } : { approved: value.approved === true, by: value.by };
}

/**
 * Waits for an answer to a gate. The execution budget does not run while a person decides; the caller's own signal
 * (Ctrl-C, a detached worker's gate-wait limit) still ends the wait.
 */
export async function waitForAnswer<T>(run: RunState, approval: () => Promise<T>): Promise<T> {
  run.clock.pause();
  try { return await awaitApproval(approval(), run.deps.signal); }
  finally { run.clock.resume(); }
}

export async function awaitApproval<T>(approval: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return approval;
  if (signal.aborted) throw new Error('Run cancelled while awaiting approval.');
  return Promise.race([approval, new Promise<T>((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Run cancelled while awaiting approval.')), { once: true });
  })]);
}

export interface Gate {
  agentId: string;
  approvalId: string;
  stepId: string;
  title: string;
  detail: string;
  /** Thrown when the run is cancelled while the gate is open. */
  cancelled: string;
  /** What a human intervention on this gate is recorded as. Default: `detail`. */
  interventionDetail?: string;
  /** Who answered a boolean (or failed) approval. Default: `policy` under --yes, else `user`. */
  fallback?: ApprovalBy;
  unregisteredChecks?: string[];
}

/**
 * Opens one approval gate, waits for it and records it with the channel that answered. A failed approval is a
 * rejection; a person's answer is also recorded as an intervention.
 */
export async function askApproval(run: RunState, gate: Gate): Promise<ApprovalAnswer> {
  const { deps } = run;
  const { agentId, approvalId, stepId, title, detail } = gate;
  await emit(run, { type: 'approval.request', agentId, approvalId, title, detail, ...(gate.unregisteredChecks?.length ? { unregisteredChecks: gate.unregisteredChecks } : {}), at: at(run) });
  let answer: ApprovalAnswer = { approved: false, by: gate.fallback ?? (deps.autoApprove ? 'policy' : 'user') };
  try { answer = answerOf(await waitForAnswer(run, () => deps.approve({ agentId, stepId, title, detail })), answer.by); }
  catch (error) { await emit(run, { type: 'error', agentId, message: `Approval failed: ${String(error)}`, at: at(run) }); }
  if (deps.signal?.aborted) throw new Error(gate.cancelled);
  await emit(run, { type: 'approval.resolve', approvalId, approved: answer.approved, by: answer.by, at: at(run) });
  if (isHuman(answer.by)) await recordApprovalIntervention(run, answer.approved, gate.interventionDetail ?? detail);
  return answer;
}

async function recordApprovalIntervention(run: RunState, approved: boolean, detail: string): Promise<void> {
  const avoidable = !approved && isAvoidableComposerMessage(detail);
  await emitEvidence(run, { type: 'intervention', by: 'user', action: approved ? 'approval:approved' : 'approval:rejected', detail, avoidable, harnessGap: avoidable ? 'feedback' : 'unknown', at: at(run) });
}

export function isAvoidableComposerMessage(message: string): boolean {
  return /\b(?:missing|forgot|should have|please include|must include|wrong path|use the file)\b/i.test(message);
}
