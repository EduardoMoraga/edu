---
description: Edu reflect: propose evidence-linked lessons and hypotheses from recent sessions
argument-hint: [period or topic, e.g. 7d or auth]
---

Follow the `edu-reflect` skill. Scope: $ARGUMENTS

1. Read recent episodes with `edu_recall` (`tiers: ["episodic"]`) and `edu_read`.
2. Find patterns backed by evidence: repeated fixes, repeated procedures, notes that helped
   or misled.
3. Present proposals (L- candidates, H- hypotheses, feedback, skill changes, canonical
   proposals), each linked to its evidence and claim band.
4. Write nothing until the user approves; then use `edu_remember`, `edu_feedback` and
   `edu_propose_canonical`.

If the `edu_*` tools are missing, tell the user to run `edu setup` and restart this CLI.
