---
name: quick
description: "Small chores (a rename, a config tweak, a typo, a one-file fix): one builder, one deterministic check, no spec approval."
harness: H2
requireSpecApproval: false
maxFixRounds: 1
---

# Quick playbook

For work that is small and already understood. If exploring reveals more than one
meaningful step, or the change touches behavior others depend on, switch to `default`.

1. **Brief.** Recall what the brain knows about the files involved. Do not ask what the
   canonical layer already answers.
2. **One-line spec.** Restate the goal, list the requirements (`R1`…) and give each a
   deterministic check Edu can run — usually one. The spec is still written; it just does
   not wait for approval.
3. **One builder.** Reproduce → fix → verify → report, inside the stated files only.
   Tests and docs that the change affects travel with it.
4. **Edu verifies.** Done means the checks passed when Edu ran them. One fix round on
   failure, then stop and report.
5. **Report with claim bands.** `verified`, `inferred`, `hypothesis`. Note any residue
   removed. Destructive or outward-facing actions still need explicit approval.
6. **Learn briefly.** One episode line; a lesson only when something surprised you.
