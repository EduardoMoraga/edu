---
description: "Edu brief: what Edu remembers for this session (commitments, hypotheses, lessons)"
argument-hint: "[today's goal]"
---

Follow the `edu-brief` skill.

1. Reuse an injected brief; call `edu_brief` only if absent or explicitly refreshing.
2. Keep the injected Edu session id; if absent, `edu_session_open(title, source)` and
   retain its exact id per workspace for `edu_session_close(id, summary)`.
   If supported, optional close `lessons` contains at most 3 actionable observations
   (`title`, `body`, optional `evidence` ids), candidate/inferred, not proof. Omit if
   none; no secrets, invented evidence, duplicate notes or second reflection LLM.
3. Check `edu_capabilities` for this version (missing = unknown).
4. If a goal was given, call `edu_recall` with it as the query: $ARGUMENTS
5. Show two to five bullets (open commitments with due dates, open hypotheses, lessons that
   apply, last session) with note ids and claim bands.

Memory is stored project/global notes, not model training. Check scope and evidence;
`edu_feedback` is advisory, never proof. Pi tools use `mcp__edu__edu_*`, discoverable
via codemode/tool_search; `/edu-refresh` refreshes the hook on the next prompt.

If no brief was injected and the `edu_*` tools are missing, run `edu brief $ARGUMENTS` in a shell for the same brief, and tell
the user to run `edu setup` and restart this CLI.
