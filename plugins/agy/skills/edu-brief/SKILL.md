---
name: edu-brief
description: "Load the compact Edu session brief: identity, open commitments and hypotheses, recorded lessons, recent sessions. Triggers: start of a session, 'brief me', 'catch me up', 'where were we', 'what do you remember?'; 'ponme al día', 'dónde quedamos', 'qué recuerdas', 'resumen de contexto'."
---

# Edu brief

## When

- First thing in a session, before planning.
- The user asks what Edu remembers or where the work stands.

## Steps

1. Reuse an injected brief; call `edu_brief` only if absent or the user explicitly
   requests a refresh (`maxTokens` only for a requested size change). In Pi the
   cached hook brief refreshes on the next prompt after `/edu-refresh`.
2. Retain an injected Edu session id; otherwise call `edu_session_open(title, source)`
   and retain its exact returned id per workspace for `edu_session_close(id, summary)`.
   At close, optionally include up to 3 observed actionable lessons if the schema
   supports it (`title`, `body`, optional evidence ids), candidate/inferred, not proof.
   Omit if none; no secrets, invented evidence or duplicate notes. Use this session's
   observations, not another reflection LLM or crew call.
3. Check `edu_capabilities` for this installed version; unavailable means unknown.
   Read the brief; if the goal needs it, run one `edu_recall` with that goal.
4. Memory is stored project/global notes, not model training. Check scope, source,
   claim bands and underlying evidence; recorded status is not external verification.
   `edu_feedback` is advisory, never proof of a lesson. In Pi discover logical tools
   under `mcp__edu__edu_*` via codemode/tool_search when necessary.

## Show the user

- Two to five bullets: open commitments (with due dates), open hypotheses, the lessons
  that apply to today's goal, the last session's summary.
- Cite note ids (`[[C-…]]`) and claim bands. Say "nothing recorded yet" if the brain is empty.

## Failure handling

- `edu_brief` is not available: run `edu brief` in a shell (the same brief; `edu brief <goal>` adds
  matching notes), then tell the user to run `edu setup` and restart this CLI to get the MCP tool.
- The tool errors with no brain found: suggest `edu init --global` (or `edu init` for a
  project brain) and continue without memory.
