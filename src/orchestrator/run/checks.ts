import { randomUUID } from 'node:crypto';
import type { DeterministicCheck } from '../../core/contracts.js';
import { runCheck, type CheckResult } from '../../evidence/registry.js';
import { at, emit, emitEvidence, type RunState } from './state.js';

/** H3 reproduction before any builder step: the evidence builders start from. */
export async function reproduceChecks(run: RunState, checks: DeterministicCheck[]): Promise<string> {
  if (!checks.length) return '';
  const results = await runChecks(run, checks, 'reproduction');
  return results.map((result) => `${result.checkId}: ${result.ok ? 'passed' : 'failed'} — ${result.output}`).join('\n');
}

/** Deterministic verification: the results that decide whether the run succeeded. */
export function verifyChecks(run: RunState, checks: DeterministicCheck[]): Promise<CheckResult[]> {
  return runChecks(run, checks, 'deterministic');
}

async function runChecks(run: RunState, checks: DeterministicCheck[], kind: 'reproduction' | 'deterministic'): Promise<CheckResult[]> {
  const results = await Promise.all(checks.map((check) => executeCheck(run, check)));
  for (const result of results) {
    const check = checks.find((candidate) => candidate.id === result.checkId)!;
    await emitEvidence(run, { type: 'verify.result', checkId: result.checkId, requirementIds: check.requirementIds, ok: result.ok, output: result.output, exitCode: result.exitCode, durationMs: result.durationMs, timedOut: result.timedOut, kind, at: at(run) });
    if (!result.ok) await emitCheckAttribution(run, check, result);
  }
  return results;
}

async function executeCheck(run: RunState, check: DeterministicCheck): Promise<CheckResult> {
  const agentId = `${run.runId}-h3-checks`;
  const callId = `${run.runId}-check-${check.id}-${randomUUID()}`;
  await emit(run, { type: 'tool.call', agentId, callId, tool: 'deterministic-check', input: JSON.stringify({ checkId: check.id, command: check.command }), at: at(run) });
  const result = await runCheck(check, run.deps.cwd, run.deps.signal);
  await emit(run, { type: 'tool.result', agentId, callId, ok: result.ok, output: JSON.stringify({ exitCode: result.exitCode, durationMs: result.durationMs, timedOut: result.timedOut, stdout: result.stdout, stderr: result.stderr }), at: at(run) });
  return result;
}

async function emitCheckAttribution(run: RunState, check: DeterministicCheck, result: CheckResult): Promise<void> {
  await emitEvidence(run, {
    type: 'failure.attribution', failureType: 'verify',
    observed: `Check '${check.id}' exited ${result.exitCode ?? 'without an exit code'}${result.timedOut ? ' after timing out' : ''}; stdout=${JSON.stringify(result.stdout)}; stderr=${JSON.stringify(result.stderr)}.`,
    expected: `Expected exit code ${check.expect.exitCode ?? 0}${check.expect.stdoutIncludes === undefined ? '' : ` and stdout to include ${JSON.stringify(check.expect.stdoutIncludes)}`}.`,
    evidence: [`registered-check:${check.id}`, `exitCode:${result.exitCode ?? 'null'}`, `timedOut:${result.timedOut}`, `stdout:${result.stdout}`, `stderr:${result.stderr}`],
    alternatives: [], next: 'Inspect the captured check evidence and identify the cause before making a correction.', at: at(run),
  });
}

/** The plan's checks, with registered ones taken from the registry; a plan may not redefine a registered id. */
export function resolveChecks(planned: DeterministicCheck[], registered: DeterministicCheck[]): DeterministicCheck[] {
  const byId = new Map(registered.map(check => [check.id, check]));
  return planned.map(check => {
    const configured = byId.get(check.id);
    if (configured && !sameCheck(configured, check)) {
      throw new Error(`Plan check '${check.id}' reuses a registered ID but changes its definition.`);
    }
    return configured ?? check;
  });
}

export function sameCheck(left: DeterministicCheck, right: DeterministicCheck): boolean {
  return left.id === right.id && left.command === right.command && left.timeoutMs === right.timeoutMs &&
    JSON.stringify(left.requirementIds) === JSON.stringify(right.requirementIds) &&
    left.expect.exitCode === right.expect.exitCode && left.expect.stdoutIncludes === right.expect.stdoutIncludes;
}
