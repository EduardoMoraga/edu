---
name: edu-brief
description: "Load the compact Edu session brief: identity, open commitments and hypotheses, proven lessons, recent sessions. Triggers: start of a session, 'brief me', 'catch me up', 'where were we', 'what do you remember?'; 'ponme al día', 'dónde quedamos', 'qué recuerdas', 'resumen de contexto'."
---

# Edu brief

## When

- First thing in a session, before planning.
- The user asks what Edu remembers or where the work stands.

## Steps

1. Call `edu_brief` (pass `maxTokens` only if the user wants it shorter or longer).
2. Read it; do not call `edu_recall` yet unless the user's goal needs more.
3. If the user stated a goal, run one `edu_recall` with that goal as the query.

## Show the user

- Two to five bullets: open commitments (with due dates), open hypotheses, the lessons
  that apply to today's goal, the last session's summary.
- Cite note ids (`[[C-…]]`) and claim bands. Say "nothing recorded yet" if the brain is empty.

## Failure handling

- `edu_brief` is not available: tell the user to run `edu setup`, then restart this CLI.
- The tool errors with no brain found: suggest `edu init --global` (or `edu init` for a
  project brain) and continue without memory.
