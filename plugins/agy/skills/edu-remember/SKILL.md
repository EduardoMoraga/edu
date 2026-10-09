---
name: edu-remember
description: "Save something durable to the Edu second brain: a decision, hypothesis, commitment or lesson, or propose a canonical truth. Triggers: 'remember this', 'note that we decided', 'save this lesson', 'I promise to', 'remind me'; 'recuerda esto', 'anota que decidimos', 'guarda esta lección', 'me comprometo a', 'apúntalo'."
---

# Edu remember

## When

- A decision was made, a hypothesis appeared, someone committed to something, or a
  reusable lesson was learned.
- The user explicitly asks Edu to remember something.

## Steps

1. Pick the kind:
   - `decision` (D-): what was chosen and why.
   - `hypothesis` (H-): the unproven claim and how to confirm or refute it.
   - `commitment` (C-): what, `owner`, and `due` (YYYY-MM-DD).
   - `lesson` (L-): "next time, do X because Y".
2. Call `edu_remember` with `tier: "transitive"`, the `kind`, a short `title`, a
   one-paragraph `body`, the claim `band` (`verified`, `inferred` or `hypothesis`) and
   optional `tags`.
3. Stable truth (a standard, a preference, a domain fact) goes to
   `edu_propose_canonical` instead; it stays a proposal until the human accepts it.

## Show the user

- One line per note created: id, kind, title, band. For canonical proposals, add that
  the user can accept it with `edu proposals accept <id>`.

## Rules

- One idea per note. Never store secrets, credentials, or personal data not offered for memory.
- Reverting a decision is a new decision that supersedes the old one, never an edit.

## Failure handling

- The `edu_*` tools are missing: tell the user to run `edu setup`, then restart this CLI.
- Invalid-arguments errors list the bad field; fix it and retry once.
