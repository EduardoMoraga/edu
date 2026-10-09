---
name: edu-reflect
description: Review recent Edu sessions and runs to propose lessons, hypotheses, skill changes, and canonical proposals — read-only, evidence-linked, never applied without human approval. Trigger on "reflect", weekly review, repeated mistakes, or after a long run.
---

# Edu reflect

## When

- The human asks to reflect, or a review period ends.
- The same problem or procedure showed up in several sessions.
- A run failed, needed a fix round, or a recalled note misled.

## Steps

1. Read recent episodes and runs (`edu_recall` over `episodic`, run summaries).
2. Look for patterns with evidence: repeated fixes, repeated procedures, notes that helped or misled.
3. Propose, linking every item to the episodes or runs that support it:
   - new **L-** lessons as `candidate`;
   - **H-** hypotheses for patterns that are suggestive but unproven;
   - feedback on existing lessons inferred from outcomes;
   - skill diffs or new skills for repeated procedures, written to `proposals/`;
   - canonical proposals from lessons that are already `proven`.
4. Present the proposals with their claim bands and wait. Nothing is applied until
   the human runs `edu proposals accept <id>`.

## Rules

- Read-only: reflection never edits notes, skills, or code directly.
- No evidence, no proposal. Prefer fewer, stronger items over many weak ones.
- Output must match the requested JSON schema exactly; malformed output is rejected, not guessed.
