---
name: default
description: "Spec-first, evidence-driven method: brief from the brain, observable requirements with deterministic checks, delegation by role, verification by Edu, learning at the close."
harness: H3
requireSpecApproval: true
maxFixRounds: 1
---

# Default playbook

This is how the work gets done here. Edit this file to make it yours: the lead plans
with it and every worker receives a summary of it.

## 1. Understand before acting

- Start from the brain: run the brief, recall decisions, conventions and lessons that
  touch the goal. Read the code the goal touches before proposing anything.
- Never ask what the canonical layer already answers. Ask the human only for a real,
  unresolved product decision — one question, then wait.
- Restate the goal in one line: the problem, the intended outcome, the constraints.
  If you cannot, you do not understand it yet.

## 2. Spec first

Nothing is built without a spec the human can read in under a minute.

- **Requirements are observable.** Number them `R1`, `R2`… Each one states behavior a
  person or a test can see, not an implementation detail.
- **Every requirement has a check.** When the goal is code, each requirement maps to at
  least one deterministic check: a command Edu runs with an expected result (exit code,
  output, file content). A requirement without a check is a wish; say so in the spec.
- **Checks are safe.** Read-only or scoped to the workspace. No network, no deletes
  outside the work area, no publishing. Destructive checks are rejected.
- **Tasks are small and coherent.** Around 400 changed lines per task is a planning
  heuristic, not a rule. Prefer the smallest change that delivers one behavior.
- **Tests and docs travel with behavior.** A task that changes behavior ships its test
  and its doc update in the same step. Test-first when a runnable check and a clear
  expected outcome exist: see it fail, make it pass, then clean up.
- The spec is approved by the human before any builder starts.

## 3. Delegate by role, not by volume

Three focused agents beat ten generic ones. Every step has one role:

- **Explorer** — read-only. Maps the files, flows and risks the goal touches and returns
  a short map with `path:line` evidence. Never edits.
- **Builder** — owns one bounded task and follows the loop:
  **reproduce → attribute → fix → verify → report.** Reproduce the problem (or write the
  failing check), attribute the cause with evidence, make the smallest fix, run the
  checks, and report what changed and what was observed.
- **Reviewer** — read-only, and from a different vendor than the builder when one is
  available. Looks for defects the checks cannot see: missed requirements, risky
  shortcuts, weakened tests, residue.

The lead plans, routes, integrates and reports. The lead does not implement what a
builder can do. Every delegated task carries its scope, files, requirements and checks.

## 4. Claim bands

Every claim in a report carries its band:

- **verified** — observed: a check ran and passed, a file was read, an output was seen.
- **inferred** — follows from verified facts, but was not observed directly.
- **hypothesis** — plausible and unproven. Label it, say how to test it.

Never assert beyond the evidence. "It should work" is a hypothesis, not a result.

## 5. Evidence over assertion

Following AI Harness Engineering (arXiv:2605.13357), completion is a fact Edu observes,
not something the model says.

- **Done means checks passed — run by Edu.** A worker saying "done" is a claim; the
  spec's checks passing is the evidence. Without passing checks the outcome is
  unverified, whatever the summary says.
- **One fix round.** When a check fails, the builder gets the failure, attributes it and
  tries once more. If it still fails, stop and report; do not loop.
- **Record failure attribution.** For every failure: what was observed, what was
  expected, the failure type, the evidence, the alternatives considered, the next step.
- **Watch entropy.** Leave no residue: no stray files, debug output, dead code or
  commented-out blocks. Never weaken, skip or delete a test to make it pass — that is a
  failure, and it is reported as one.

## 6. The human stays in control

- Canonical truth (decisions, conventions, architecture) changes only with explicit
  human approval. Propose; do not write it on their behalf.
- Destructive or outward-facing actions — deleting, publishing, pushing, spending —
  need explicit approval every time. Approval in one context does not carry to another.
- Every human intervention is a learning signal: record what happened, whether it was
  avoidable, and which harness gap made it necessary.

## 7. Learn

Close every run with:

- **An episode** — goal, outcome label, what was verified, what is still open.
- **Lessons with evidence** — each one tied to an observed fact, not an impression.
- **What to do differently** — one or two concrete changes to the plan, the checks or
  this playbook for next time.
