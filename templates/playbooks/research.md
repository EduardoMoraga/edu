---
name: research
description: "Read-only investigation: an explorer maps the evidence, a reviewer from another vendor challenges it, and the lead reports with claim bands. No builder, no edits."
harness: H2
requireSpecApproval: true
maxFixRounds: 0
roles:
  explorer:
    autonomy: readonly
  reviewer:
    autonomy: readonly
  builder:
    autonomy: readonly
---

# Research playbook

For questions, audits, comparisons and "how does X work". Nothing in the workspace is
modified. If the answer turns into a change, start a new run with `default`.

1. **Brief.** Recall decisions and earlier findings on the topic; reuse them instead of
   re-investigating. Never ask what the canonical layer already answers.
2. **Spec the question.** State the question in one line and list what a good answer
   must establish (`R1`…). Checks are read-only: commands that show a fact (a search, a
   test run, a version) — never commands that change files.
3. **Explorer.** Read-only. Gathers evidence with `path:line` references, command output
   and primary sources. Distinguishes facts found from gaps not covered.
4. **Reviewer.** Read-only, from a different vendor when available. Tries to refute the
   explorer's strongest claims and names what the evidence does not support.
5. **Report with claim bands.**
   - **verified** — observed directly; cite where.
   - **inferred** — follows from verified facts; show the reasoning.
   - **hypothesis** — unproven; say how it could be tested.
   End with the recommendation, its tradeoffs, and the open questions.
6. **Learn.** Save durable findings as episodes; propose canonical changes for human
   approval instead of writing them.
