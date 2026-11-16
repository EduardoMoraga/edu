// src/eval/contract.ts
import { z } from "zod";
var ARMS = ["native-clean", "edu-cold", "memory-static", "memory-adaptive"];
var count = z.number().finite().nonnegative();
var CostsSchema = z.object({
  /** Existing numeric trial records declare measurements; new incomplete recorders must set false explicitly. */
  known: z.object({ inputTokens: z.boolean().optional(), outputTokens: z.boolean().optional(), acquisitionTokens: z.boolean().optional(), reflectionTokens: z.boolean().optional(), billedCostUsd: z.boolean().optional() }).strict().optional(),
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
  cacheReadTokens: count.nullish(),
  cacheWriteTokens: count.nullish(),
  reasoningTokens: count.nullish(),
  /** Provider-billed cost in USD. null/absent = unknown (NOT zero); 0 = billed zero. */
  billedCostUsd: count.nullish()
}).strict().superRefine((c, ctx) => {
  if (c.known?.inputTokens !== false && (c.cacheReadTokens ?? 0) + (c.cacheWriteTokens ?? 0) > c.inputTokens) ctx.addIssue({ code: "custom", path: ["cacheReadTokens"], message: "cacheReadTokens + cacheWriteTokens must be a subset of inputTokens" });
  if (c.known?.outputTokens !== false && (c.reasoningTokens ?? 0) > c.outputTokens) ctx.addIssue({ code: "custom", path: ["reasoningTokens"], message: "reasoningTokens must be a subset of outputTokens" });
});
var TrialSchema = z.object({
  trialId: z.string().min(1),
  taskId: z.string().min(1),
  /** Distinguishes repeated attempts of the same task; arms are paired on (taskId, repetitionId). */
  repetitionId: z.string().min(1).optional(),
  arm: z.enum(ARMS),
  model: z.string().min(1),
  harness: z.string().min(1),
  /** `measured` = real session; `deterministic-suite` = produced by the rule-based suite and never evidence of model efficiency. */
  provenance: z.enum(["measured", "deterministic-suite"]),
  /** Verdict of an oracle meant to be outside the agent (test, check, human). The recorder must supply it; this contract only requires it to be named. */
  success: z.boolean(),
  /** Declares where `success` came from (provenance). It does NOT prove the oracle is independent of the agent. */
  oracle: z.string().min(1),
  costs: CostsSchema,
  steps: z.number().int().nonnegative().optional()
}).strict();
var EvalContractError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "EvalContractError";
  }
};
function parseTrials(input) {
  const rows = Array.isArray(input) ? input : input && typeof input === "object" && Array.isArray(input.trials) ? input.trials : void 0;
  if (!rows) throw new EvalContractError('Expected an array of trials or { "trials": [...] }.');
  const trials = [];
  const problems = [];
  rows.forEach((row, index) => {
    const parsed = TrialSchema.safeParse(row);
    if (parsed.success) trials.push(parsed.data);
    else problems.push(`trial[${index}]: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`).join("; ")}`);
  });
  if (problems.length) throw new EvalContractError(`Invalid trials:
${problems.slice(0, 10).join("\n")}${problems.length > 10 ? `
\u2026and ${problems.length - 10} more` : ""}`);
  const seen = /* @__PURE__ */ new Set();
  for (const trial of trials) {
    if (seen.has(trial.trialId)) throw new EvalContractError(`Duplicate trialId '${trial.trialId}'.`);
    seen.add(trial.trialId);
  }
  return trials;
}

// src/eval/aggregate.ts
var DEFAULT_MIN_TRIALS = 10;
var LIMITS = [
  "Success is whatever the named oracle reported. The contract requires the oracle to be declared and meant to be external; it cannot verify independence, so trust rests on the recorder of the data.",
  "Costs are four disjoint token categories (input, output, acquisition, reflection) summed as recorded; double counting by the recorder is not detectable. Failed trials are included.",
  "An observed token difference does not promise financial savings: prices, caching and billing differ; only complete provider-billed costs are compared in USD, and unknown cost is never zero.",
  "Arms are compared only when they contain the same multiset of (taskId, repetitionId) pairs.",
  "Differences are descriptive: no causal or general efficiency claim; one model/harness per report.",
  "Wilson intervals assume independent trials of comparable tasks."
];
function wilson(successes, n) {
  if (!n) return [0, 0];
  const z2 = 1.96, p = successes / n, d = 1 + z2 * z2 / n;
  const centre = (p + z2 * z2 / (2 * n)) / d, half = z2 * Math.sqrt(p * (1 - p) / n + z2 * z2 / (4 * n * n)) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}
function pairingKey(rows) {
  return rows.map((row) => JSON.stringify([row.taskId, row.repetitionId ?? ""])).sort().join("\n");
}
function summarize(rows) {
  const n = rows.length, successes = rows.filter((row) => row.success).length;
  const sum = (pick) => rows.reduce((total, row) => total + pick(row), 0);
  const tokens = { input: sum((r) => r.costs.inputTokens), output: sum((r) => r.costs.outputTokens), acquisition: sum((r) => r.costs.acquisitionTokens), reflection: sum((r) => r.costs.reflectionTokens), total: 0 };
  tokens.total = tokens.input + tokens.output + tokens.acquisition + tokens.reflection;
  const known = (pick) => rows.every((row) => pick(row) != null) ? sum((row) => pick(row) ?? 0) : null;
  const totalBilledCostUsd = known((r) => r.costs.known?.billedCostUsd === false ? null : r.costs.billedCostUsd);
  const tokensKnown = {
    input: rows.every((r) => r.costs.known?.inputTokens !== false),
    output: rows.every((r) => r.costs.known?.outputTokens !== false),
    acquisition: rows.every((r) => r.costs.known?.acquisitionTokens !== false),
    reflection: rows.every((r) => r.costs.known?.reflectionTokens !== false),
    total: false
  };
  tokensKnown.total = tokensKnown.input && tokensKnown.output && tokensKnown.acquisition && tokensKnown.reflection;
  return {
    n,
    successes,
    failures: n - successes,
    successRate: successes / n,
    wilson95: wilson(successes, n),
    tokens,
    tokensKnown,
    meanTotalTokens: tokensKnown.total ? tokens.total / n : null,
    tokensPerSuccess: successes && tokensKnown.total ? tokens.total / successes : null,
    meanWallMs: sum((r) => r.costs.wallMs) / n,
    humanInterventions: sum((r) => r.costs.humanInterventions),
    declared: { cacheReadTokens: known((r) => r.costs.cacheReadTokens), cacheWriteTokens: known((r) => r.costs.cacheWriteTokens), reasoningTokens: known((r) => r.costs.reasoningTokens) },
    totalBilledCostUsd,
    meanBilledCostUsd: totalBilledCostUsd === null ? null : totalBilledCostUsd / n,
    billedCostKnownTrials: rows.filter((r) => r.costs.billedCostUsd != null && r.costs.known?.billedCostUsd !== false).length
  };
}
function aggregateTrials(input, options = {}) {
  const trials = parseTrials(input);
  const min = options.minTrialsPerArm ?? DEFAULT_MIN_TRIALS;
  if (!Number.isInteger(min) || min < 1) throw new EvalContractError("minTrialsPerArm must be a positive integer.");
  const base = { status: "inconclusive", reasons: [], limits: LIMITS, model: null, harness: null, minTrialsPerArm: min, trials: trials.length, arms: {}, comparisons: [] };
  if (!trials.length) return { ...base, reasons: ["no-trials"] };
  const models = [...new Set(trials.map((t) => t.model))], harnesses = [...new Set(trials.map((t) => t.harness))];
  if (models.length > 1 || harnesses.length > 1) throw new EvalContractError(`A comparison needs one model and one harness; got models [${models.join(", ")}] and harnesses [${harnesses.join(", ")}].`);
  const byArm = /* @__PURE__ */ new Map();
  for (const trial of trials) byArm.set(trial.arm, [...byArm.get(trial.arm) ?? [], trial]);
  const arms = {};
  for (const arm of ARMS) if (byArm.has(arm)) arms[arm] = summarize(byArm.get(arm));
  const synthetic = trials.some((t) => t.provenance !== "measured");
  const pairs = [["native-clean", "edu-cold"], ["native-clean", "memory-static"], ["native-clean", "memory-adaptive"], ["memory-static", "memory-adaptive"]];
  const comparisons = pairs.map(([baseline, candidate]) => {
    const a = byArm.get(baseline), b = byArm.get(candidate);
    const reasons2 = [];
    if (!a || !b) reasons2.push(`missing-arm:${[!a && baseline, !b && candidate].filter(Boolean).join(",")}`);
    if (synthetic) reasons2.push("deterministic-suite-not-llm-benchmark");
    if (a && b) {
      if (pairingKey(a) !== pairingKey(b)) reasons2.push("unmatched-task-multiset");
    }
    const small = Boolean(a && b) && (a.length < min || b.length < min);
    if (small) reasons2.push(`sample-below-${min}-per-arm`);
    const status2 = !a || !b || synthetic || reasons2.includes("unmatched-task-multiset") ? "inconclusive" : small ? "insufficient-sample" : "observed";
    if (status2 !== "observed") return { baseline, candidate, status: status2, reasons: reasons2, successRateDelta: null, meanTotalTokensDelta: null, dollarDelta: null, tokensPerSuccessDelta: null, successInterval: null };
    const sa = arms[baseline], sb = arms[candidate];
    return {
      baseline,
      candidate,
      status: status2,
      reasons: reasons2,
      successRateDelta: sb.successRate - sa.successRate,
      meanTotalTokensDelta: sb.meanTotalTokens !== null && sa.meanTotalTokens !== null ? sb.meanTotalTokens - sa.meanTotalTokens : null,
      dollarDelta: sa.meanBilledCostUsd !== null && sb.meanBilledCostUsd !== null ? sb.meanBilledCostUsd - sa.meanBilledCostUsd : null,
      tokensPerSuccessDelta: sa.tokensPerSuccess !== null && sb.tokensPerSuccess !== null ? sb.tokensPerSuccess - sa.tokensPerSuccess : null,
      successInterval: sb.wilson95[0] > sa.wilson95[1] ? "candidate-higher" : sb.wilson95[1] < sa.wilson95[0] ? "candidate-lower" : "overlap"
    };
  });
  const observed = comparisons.some((c) => c.status === "observed");
  const status = observed ? "observed" : comparisons.some((c) => c.status === "insufficient-sample") ? "insufficient-sample" : "inconclusive";
  const reasons = observed ? [] : [...new Set(comparisons.flatMap((c) => c.reasons))];
  return { ...base, status, reasons, model: models[0], harness: harnesses[0], arms, comparisons };
}

export {
  ARMS,
  CostsSchema,
  TrialSchema,
  EvalContractError,
  parseTrials,
  DEFAULT_MIN_TRIALS,
  aggregateTrials
};
//# sourceMappingURL=chunk-ODFAACD4.js.map