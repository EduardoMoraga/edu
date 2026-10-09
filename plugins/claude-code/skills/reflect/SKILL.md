---
name: edu-reflect
description: "Review recent Edu sessions and runs to propose lessons, hypotheses, skill changes and canonical proposals: read-only, evidence-linked, never applied without human approval. Triggers: 'reflect', 'weekly review', 'what have we learned', repeated mistakes, after a long run; 'reflexiona', 'revisión semanal', 'qué aprendimos', 'estamos repitiendo el mismo error'."
---

# Edu reflect

## When

- The human asks to reflect, or a review period ends.
- The same problem or procedure showed up in several sessions.
- A run failed, needed a fix round, or a recalled note misled.

## Steps

1. Read recent episodes and runs: `edu_recall` with `tiers: ["episodic"]`, then
   `edu_read` on the relevant ids.
2. Look for patterns with evidence: repeated fixes, repeated procedures, notes that
   helped or misled.
3. Propose, linking every item to the episodes or runs that support it:
   - new **L-** lessons as `candidate`;
   - **H-** hypotheses for patterns that are suggestive but unproven;
   - `edu_feedback` on existing lessons that outcomes proved helpful or misleading;
   - skill diffs or new skills for repeated procedures;
   - canonical proposals from lessons that are already `proven`.
4. Present the proposals with their claim bands and wait. Write them only after the
   human agrees (`edu_remember`, `edu_propose_canonical`). For the full schema-validated
   pass over runs, suggest `edu reflect --since 7d`, then `edu proposals accept <id>`.

## Rules

- Read-only until approved: reflection never edits notes, skills, or code directly.
- No evidence, no proposal. Prefer fewer, stronger items over many weak ones.
- When producing machine output, match the requested JSON schema exactly; malformed
  output is rejected, not guessed.

## Failure handling

- The `edu_*` tools are missing: tell the user to run `edu setup`, then restart this CLI.
