# Edu 2.0 evaluation

What is measured, and what is deliberately not claimed.

## Arms
`native-clean` (host agent, no Edu), `edu-cold` (Edu installed, empty brain), `memory-static` (fixed memory snapshot, no writes during the run), `memory-adaptive` (memory updated from externally verified outcomes).

## Trial contract (`src/eval/contract.ts`)
One row per attempt, strict: `trialId`, `taskId`, `arm`, `model`, `harness`, `provenance` (`measured` | `deterministic-suite`), `success` (verdict reported by an oracle meant to be external to the agent), `oracle` (its name: a provenance declaration, **not** a check of independence — trust rests on whoever records the data), optional `repetitionId`, and all costs: `inputTokens`, `outputTokens`, `acquisitionTokens`, `reflectionTokens`, `wallMs`, `humanInterventions`. Missing, negative, non-finite or mistyped values are rejected, not read as zero. Failed trials are required, not optional.

**Costs are four disjoint categories** summed as recorded: input/output = the task's own model tokens *excluding* acquisition and reflection. A recorder that also folds acquisition/reflection into input/output would double count; the aggregator cannot detect it.

## Rules the aggregator enforces (`edu eval aggregate <file>`)
- `aggregateTrials` re-validates its input, so programmatic callers cannot skip the cost/type contract.
- One model and one harness per report; a mix is an error.
- Total cost = input + output + acquisition + reflection; reported per trial and per success.
- Status is `inconclusive` with no trials, a missing arm, a different multiset of (taskId, repetitionId) between compared arms (equal task *sets* with unbalanced easy/hard frequencies are rejected), or any `deterministic-suite` data; `insufficient-sample` below `--min-trials` (default 10) per compared arm; `observed` otherwise.
- Deltas and Wilson 95% intervals appear only when `observed`, and are descriptive: no causal claim, no "savings" verdict.

## Deterministic suite (`edu eval suite`)
transfer -> distractor -> correction, in temporary brains, judged by a fixed expected answer. The solver is rule-based (answer = `Answer:` line of the best recalled lesson). It demonstrates memory behaviour: recall transfers a lesson; a plausible distractor misleads static memory; verified feedback (trusted caller, `eventId`, `verified: true`, only for the note actually used) lets the adaptive arm recover; a correction supplied by the oracle/human is counted as an intervention and reflection tokens. Advisory feedback is never used to promote. **It is not an LLM benchmark** and its aggregate is always `inconclusive`.

## Running a real pilot
Not done here. It needs controlled clean sessions with the same model and harness for all arms, an external oracle (tests), and enough tasks per arm; record trials in the contract above and run `edu eval aggregate`. Inaccessible models (e.g. Gemini/Kimi) must not be extrapolated.

## Billed cost and declared breakdown
`inputTokens`/`outputTokens` are normalized totals (cache read/write and reasoning are inside them). Optional `cacheReadTokens`, `cacheWriteTokens` (subset of input) and `reasoningTokens` (subset of output) are declared breakdowns, validated as subsets and never added to totals. Optional `billedCostUsd` is the provider-billed amount: absent/`null` = unknown, `0` = billed zero. Arm totals/means of USD are `null` if any trial is unknown; `dollarDelta` exists only when both arms are complete. An `observed` token comparison does not promise financial savings.
