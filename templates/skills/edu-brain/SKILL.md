---
name: edu-brain
description: Use the Edu second brain during a session — brief at start, recall and read on demand, remember decisions/hypotheses/commitments/lessons, give feedback, and close the session. Trigger on session start, "what did we decide", recurring problems, or before ending work.
---

# Edu brain

## When

- At session start, before planning.
- When a question may already have an answer: past decisions, conventions, people, lessons.
- When something durable happens: a decision, a hypothesis, a promise, a lesson.
- Before ending the session.

## Steps

1. `edu_brief` — read identity, open commitments, and top lessons. Do not load more yet.
2. `edu_recall "<query>"` — search by topic; read hits with `edu_read <id>` only if needed.
3. Cite what you use by id (`[[D-…]]`) and state its claim band.
4. `edu_remember` as things happen:
   - `decision` (D-): what was chosen and why. Reverting = new decision with `supersedes`.
   - `hypothesis` (H-): unproven claim plus how it could be confirmed or refuted.
   - `commitment` (C-): owner and `due` date.
   - `lesson` (L-): a reusable "next time, do X because Y".
5. `edu_feedback <id> helpful|not` after a recalled note helped or misled.
6. Durable truth → `edu_propose_canonical`. Only the human accepts it.
7. `edu_session_close` with a short summary: what changed, what is open, what was learned.

## Rules

- Never present a hypothesis as fact.
- Keep entries short and specific; one idea per note.
- Do not store secrets, credentials, or personal data that was not offered for memory.
