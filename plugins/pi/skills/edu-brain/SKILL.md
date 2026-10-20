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

1. Reuse an injected Edu brief. Only if absent, call `edu_brief` once for identity,
   commitments and lessons; repeat only for an explicit refresh. Retain any injected
   Edu session id. If absent, call `edu_session_open` with `title` and host `source`;
   keep the exact returned id per workspace. Check `edu_capabilities` for the installed
   version; if unavailable, capabilities are unknown, not assumed.
2. `edu_recall` with a topic query; open hits with `edu_read` only when needed.
3. Cite what you use by id (`[[D-…]]`) and state its claim band.
4. `edu_remember` as things happen (`tier: transitive`, `kind`):
   - `decision` (D-): what was chosen and why. Reverting = new decision with `supersedes`.
   - `hypothesis` (H-): the unproven claim plus how to confirm or refute it.
   - `commitment` (C-): `owner` and `due` date.
   - `lesson` (L-): a reusable "next time, do X because Y".
5. `edu_feedback` (`helpful: true|false`) after a recalled note helped or misled.
   This is advisory opinion, not externally verified evidence or proof of `proven`.
6. Durable truth → `edu_propose_canonical`. Only the human accepts it.
7. `edu_session_close` with that exact `id` and a short `summary`: what changed,
   what is open, what was learned. Never invent an id, close a different workspace's
   episode, or report closure after an error.
   If supported by the current tool schema, optionally include
   `lessons?: [{title, body, evidence?: [ids]}]` (max 3). The current model may capture
   what worked or a corrected error as an actionable next-time observation:
   candidate/inferred, not proof; no second reflection LLM or crew call.
   Lessons are optional: omit if none are durable. Do not duplicate notes already
   saved via `edu_remember`, invent evidence ids, store secrets, or treat an opinion
   as verification. Evidence references do not make a lesson verified. If the installed
   schema lacks lessons, preserve the old `id` + `summary` close contract.

## Rules

- Memory is stored project notes plus a global overlay, not model training. Cite
  scope, source, ids, claim bands and evidence. Legacy `proven`/`verified` metadata
  does not establish a newly checked result; opinions cannot prove a lesson.
- In Pi logical `edu_*` tools are `mcp__edu__edu_*`; discover via codemode/tool_search
  when needed. `/edu-refresh` invalidates the current cached brief for the next prompt.
- Verify workspace scope before reading/writing. Pi requests an MCP host-workspace
  lock: change host cwd and restart to change projects, not `edu_project_use`.
  Do not promise automatic synchronization or assume older servers/config overrides
  enforce the lock. Generic MCP clients may allow switching; retain separate session
  ids per workspace.
- Crew is for independent work, substantial changes needing review, or an explicit
  user request. Do not auto-spawn for trivial tasks or session summaries.
- Never present a hypothesis as fact.
- Keep entries short and specific; one idea per note.
- Do not store secrets, credentials, or personal data that was not offered for memory.
- If the `edu_*` tools are missing, tell the user to run `edu setup` and restart the CLI.
