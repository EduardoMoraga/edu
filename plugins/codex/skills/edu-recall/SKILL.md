---
name: edu-recall
description: "Search the Edu second brain for past decisions, lessons, conventions, people and sessions, then read the relevant notes. Triggers: 'what did we decide about', 'have we seen this before', 'do we have a convention for', 'recall'; 'qué decidimos sobre', 'ya pasó esto antes', 'busca en la memoria', 'recuerda lo de'."
---

# Edu recall

## When

- A question may already have an answer in the brain.
- Before repeating a fix, a design choice, or a procedure.

## Steps

1. Call `edu_recall` with a short topic `query` (add `tiers` such as `["transitive"]`
   or `["canonical"]` to narrow it; `limit` defaults to 10).
2. Pick at most three relevant hits and open them with `edu_read` by id.
3. Answer from those notes. If a note clearly helped or misled, call `edu_feedback`
   with its `id` and `helpful: true|false`.

## Show the user

- The answer first, then the sources: id, title and claim band for each note used.
- Separate `verified` facts from `inferred` or `hypothesis` notes.
- If nothing matched, say so plainly and suggest what to record once it is known.

## Failure handling

- The `edu_*` tools are missing: tell the user to run `edu setup`, then restart this CLI.
- `edu_read` returns "Note not found": the id is stale; recall again instead of guessing.
