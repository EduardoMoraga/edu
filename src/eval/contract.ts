import { z } from 'zod';

export const ARMS = ['native-clean', 'edu-cold', 'memory-static', 'memory-adaptive'] as const;
export type Arm = (typeof ARMS)[number];

const count = z.number().finite().nonnegative();
/**
 * Every cost is required: a trial with a missing cost cannot be compared, so it is rejected instead of read as zero.
 * Four token categories are DISJOINT and summed as-is: `inputTokens`/`outputTokens` are the task's own model usage
 * (normalized totals) EXCLUDING acquisition and reflection. Cache/reasoning counts are declared subsets, never added.
 * The schema checks the subset relation but cannot detect a recorder that double counts acquisition/reflection.
 */
export const CostsSchema = z.object({
  /** TOTAL normalized input tokens of the task's model calls (cache read/write included), excluding acquisition and reflection. */
  inputTokens: count,
  /** TOTAL normalized output tokens (reasoning included), excluding acquisition and reflection. */
  outputTokens: count,
  /** Tokens spent obtaining memory/context (recall, retrieval, context pack). Disjoint from input/output. */
  acquisitionTokens: count,
  /** Tokens spent on reflection/consolidation attributable to this trial. Disjoint from input/output. */
  reflectionTokens: count,
  wallMs: count,
  humanInterventions: z.number().int().nonnegative(),
  /** Declared breakdown, SUBSETS of inputTokens (cache) and outputTokens (reasoning). Never added to totals. Absent = unknown. */
  cacheReadTokens: count.nullish(), cacheWriteTokens: count.nullish(), reasoningTokens: count.nullish(),
  /** Provider-billed cost in USD. null/absent = unknown (NOT zero); 0 = billed zero. */
  billedCostUsd: count.nullish(),
}).strict().superRefine((c, ctx) => {
  if ((c.cacheReadTokens ?? 0) + (c.cacheWriteTokens ?? 0) > c.inputTokens) ctx.addIssue({ code: 'custom', path: ['cacheReadTokens'], message: 'cacheReadTokens + cacheWriteTokens must be a subset of inputTokens' });
  if ((c.reasoningTokens ?? 0) > c.outputTokens) ctx.addIssue({ code: 'custom', path: ['reasoningTokens'], message: 'reasoningTokens must be a subset of outputTokens' });
});

export const TrialSchema = z.object({
  trialId: z.string().min(1),
  taskId: z.string().min(1),
  /** Distinguishes repeated attempts of the same task; arms are paired on (taskId, repetitionId). */
  repetitionId: z.string().min(1).optional(),
  arm: z.enum(ARMS),
  model: z.string().min(1),
  harness: z.string().min(1),
  /** `measured` = real session; `deterministic-suite` = produced by the rule-based suite and never evidence of model efficiency. */
  provenance: z.enum(['measured', 'deterministic-suite']),
  /** Verdict of an oracle meant to be outside the agent (test, check, human). The recorder must supply it; this contract only requires it to be named. */
  success: z.boolean(),
  /** Declares where `success` came from (provenance). It does NOT prove the oracle is independent of the agent. */
  oracle: z.string().min(1),
  costs: CostsSchema,
  steps: z.number().int().nonnegative().optional(),
}).strict();

export type Trial = z.infer<typeof TrialSchema>;
export type Costs = z.infer<typeof CostsSchema>;

export class EvalContractError extends Error {
  constructor(message: string) { super(message); this.name = 'EvalContractError'; }
}

/** Parses untrusted trial data; every violation is reported with its position. Nothing is coerced. */
export function parseTrials(input: unknown): Trial[] {
  const rows = Array.isArray(input) ? input : (input && typeof input === 'object' && Array.isArray((input as { trials?: unknown }).trials) ? (input as { trials: unknown[] }).trials : undefined);
  if (!rows) throw new EvalContractError('Expected an array of trials or { "trials": [...] }.');
  const trials: Trial[] = [];
  const problems: string[] = [];
  rows.forEach((row, index) => {
    const parsed = TrialSchema.safeParse(row);
    if (parsed.success) trials.push(parsed.data);
    else problems.push(`trial[${index}]: ${parsed.error.issues.map(issue => `${issue.path.join('.') || '(root)'} ${issue.message}`).join('; ')}`);
  });
  if (problems.length) throw new EvalContractError(`Invalid trials:\n${problems.slice(0, 10).join('\n')}${problems.length > 10 ? `\n…and ${problems.length - 10} more` : ''}`);
  const seen = new Set<string>();
  for (const trial of trials) {
    if (seen.has(trial.trialId)) throw new EvalContractError(`Duplicate trialId '${trial.trialId}'.`);
    seen.add(trial.trialId);
  }
  return trials;
}
