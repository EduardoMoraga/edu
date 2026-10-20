import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBrain, type Brain } from '../brain/index.js';
import { estimateTokens } from '../context/index.js';
import type { Arm, Trial } from './contract.js';

/**
 * Deterministic memory-behaviour suite: transfer -> distractor -> correction, judged by a fixed external oracle.
 * The "agent" is a rule-based solver (answer = the `Answer:` line of the best recalled lesson), NOT a model.
 * It shows what the memory layer does (retrieval, verified feedback, correction); it says nothing about LLM quality.
 */
export const SUITE_MODEL = 'rule-based-solver';
export const SUITE_HARNESS = 'edu-eval-suite';
export const SUITE_ORACLE = 'fixed-expected-answer';

interface Task { id: string; phase: 'transfer' | 'distractor' | 'correction'; query: string; expected: string; /** Oracle-supplied fix, applied only by the adaptive arm after a failure. */ correction?: { title: string; body: string } }

const GOOD = { title: 'Run schema migrations with the make target', body: 'Procedure for running database schema migrations.\nAnswer: make db-migrate' };
const DISTRACTOR = { title: 'Database migrations rollback for staging', body: 'Rolling back database migrations in staging.\nAnswer: make db-rollback' };
const UPGRADED = { title: 'Migrations now use db-upgrade after the tooling change', body: 'Since the tooling change, schema migrations are run with a different target.\nAnswer: make db-upgrade' };

export const SUITE_TASKS: Task[] = [
  { id: 'transfer-1', phase: 'transfer', query: 'how to run schema migrations', expected: 'make db-migrate' },
  { id: 'distractor-1', phase: 'distractor', query: 'database migrations staging run', expected: 'make db-migrate' },
  { id: 'distractor-2', phase: 'distractor', query: 'run the database migrations in staging', expected: 'make db-migrate' },
  { id: 'distractor-3', phase: 'distractor', query: 'staging database migrations how to run', expected: 'make db-migrate' },
  { id: 'correction-1', phase: 'correction', query: 'how to run schema migrations after tooling change', expected: 'make db-upgrade', correction: UPGRADED },
  { id: 'correction-2', phase: 'correction', query: 'run schema migrations after the tooling change', expected: 'make db-upgrade' },
];

export interface SuiteStep { taskId: string; phase: Task['phase']; arm: Arm; answer: string; expected: string; success: boolean; usedNote: string | null }
export interface SuiteResult {
  kind: 'deterministic-memory-suite'; model: string; harness: string; notALlmBenchmark: true;
  steps: SuiteStep[]; trials: Trial[];
  byArm: Record<string, { passed: number; total: number; byPhase: Record<string, string> }>;
  limits: string[];
}

function answerOf(body: string): string | null { return /^Answer:\s*(.+)$/m.exec(body)?.[1]?.trim() ?? null; }

async function runArm(arm: Arm, root: string): Promise<{ steps: SuiteStep[]; trials: Trial[] }> {
  const brain: Brain = openBrain([{ scope: 'project', root }]);
  await brain.init({ scope: 'project', root });
  const seeded = arm === 'memory-static' || arm === 'memory-adaptive';
  if (seeded) for (const note of [GOOD, DISTRACTOR]) await brain.write({ ...note, tier: 'transitive', kind: 'lesson', band: 'inferred', source: 'edu:eval-suite' });
  const steps: SuiteStep[] = [], trials: Trial[] = [];
  for (const task of SUITE_TASKS) {
    const started = Date.now();
    let answer = 'unknown', usedNote: string | null = null, acquisition = 0, reflection = 0;
    if (arm !== 'native-clean') {
      const hits = await brain.recall(task.query, { limit: 3, tiers: ['transitive'] });
      const top = hits.find(hit => hit.note.meta.kind === 'lesson' && answerOf(hit.note.body));
      acquisition = estimateTokens(task.query) + hits.reduce((total, hit) => total + estimateTokens(hit.note.body), 0);
      if (top) { answer = answerOf(top.note.body)!; usedNote = top.note.meta.id; }
    }
    const success = answer === task.expected;
    if (arm === 'memory-adaptive') {
      // Trusted runtime caller: the outcome was checked by the fixed oracle, and only the note actually used is credited.
      if (usedNote) await brain.feedback(usedNote, success, { eventId: `${arm}:${task.id}`, verified: true, evidence: [`${SUITE_ORACLE}:${task.id}`] });
      if (!success && task.correction) {
        reflection = estimateTokens(task.correction.body);
        await brain.write({ ...task.correction, tier: 'transitive', kind: 'lesson', band: 'inferred', source: 'edu:eval-suite' });
      }
    }
    steps.push({ taskId: task.id, phase: task.phase, arm, answer, expected: task.expected, success, usedNote });
    trials.push({ trialId: `${arm}:${task.id}`, taskId: task.id, arm, model: SUITE_MODEL, harness: SUITE_HARNESS, provenance: 'deterministic-suite', success, oracle: SUITE_ORACLE,
      costs: { inputTokens: 0, outputTokens: 0, acquisitionTokens: acquisition, reflectionTokens: reflection, wallMs: Date.now() - started, humanInterventions: arm === 'memory-adaptive' && !success && task.correction ? 1 : 0 } });
  }
  return { steps, trials };
}

/** Runs the suite in temporary brains (removed afterwards). No model, CLI or network is involved. */
export async function runMemorySuite(): Promise<SuiteResult> {
  const dir = await mkdtemp(join(tmpdir(), 'edu-eval-'));
  try {
    const steps: SuiteStep[] = [], trials: Trial[] = [];
    for (const arm of ['native-clean', 'edu-cold', 'memory-static', 'memory-adaptive'] as const) {
      const result = await runArm(arm, join(dir, arm, '.edu'));
      steps.push(...result.steps); trials.push(...result.trials);
    }
    const byArm: SuiteResult['byArm'] = {};
    for (const step of steps) {
      const entry = (byArm[step.arm] ??= { passed: 0, total: 0, byPhase: {} });
      entry.total++; entry.passed += Number(step.success);
    }
    for (const arm of Object.keys(byArm)) for (const phase of ['transfer', 'distractor', 'correction']) {
      const rows = steps.filter(step => step.arm === arm && step.phase === phase);
      byArm[arm]!.byPhase[phase] = `${rows.filter(row => row.success).length}/${rows.length}`;
    }
    return { kind: 'deterministic-memory-suite', model: SUITE_MODEL, harness: SUITE_HARNESS, notALlmBenchmark: true, steps, trials, byArm,
      limits: ['Rule-based solver, not a model: shows memory behaviour only, never LLM quality or savings.', 'Tasks, lessons and oracle are fixed fixtures written for this suite.', 'The adaptive correction step stands for a human/oracle-supplied fix and is counted as an intervention and reflection tokens.', 'Feedback uses verified events from a trusted runtime caller; advisory feedback is never used to promote.'] };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
