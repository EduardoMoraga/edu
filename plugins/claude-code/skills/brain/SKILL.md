---
name: edu-brain
description: "Use the Edu second brain through a whole session: brief at start, recall and read on demand, remember decisions/hypotheses/commitments/lessons, give feedback, and close the session. Triggers: session start, 'what did we decide', 'have we seen this before', recurring problems, before ending work; 'qué decidimos', 'ya vimos esto antes', 'cerremos la sesión', 'usa la memoria de Edu'."
---

# Edu brain

The umbrella protocol. Each step also has its own focused skill: `edu-brief`,
`edu-recall`, `edu-remember`, `edu-reflect`, `edu-status`.

## When

- At session start, before planning.
- When a question may already have an answer: past decisions, conventions, people, lessons.
- When something durable happens: a decision, a hypothesis, a promise, a lesson.
- Before ending the session.

## Steps

1. `edu_brief` — identity, open commitments, top lessons. Do not load more yet.
2. `edu_recall` with a topic query; open hits with `edu_read` only when needed.
3. Cite what you use by id (`[[D-…]]`) and state its claim band.
4. `edu_remember` as things happen (`tier: transitive`, `kind`):
   - `decision` (D-): what was chosen and why. Reverting = new decision with `supersedes`.
   - `hypothesis` (H-): the unproven claim plus how to confirm or refute it.
   - `commitment` (C-): `owner` and `due` date.
   - `lesson` (L-): a reusable "next time, do X because Y".
5. `edu_feedback` (`helpful: true|false`) after a recalled note helped or misled.
6. Durable truth → `edu_propose_canonical`. Only the human accepts it.
7. `edu_session_close` with a short summary: what changed, what is open, what was learned.

## Rules

- Never present a hypothesis as fact.
- Keep entries short and specific; one idea per note.
- Do not store secrets, credentials, or personal data that was not offered for memory.
- If the `edu_*` tools are missing, tell the user to run `edu setup` and restart the CLI.
