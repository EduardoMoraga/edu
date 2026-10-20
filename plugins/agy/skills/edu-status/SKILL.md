---
name: edu-status
description: "Show where things stand in Edu: open commitments, crew jobs in flight, and recent brain activity. Triggers: 'status', 'what is pending', 'what are the agents doing', 'any jobs running'; 'estado', 'qué está pendiente', 'qué están haciendo los agentes', 'hay trabajos corriendo'."
---

# Edu status

## Steps

1. Call `edu_crew_status` with no `jobId` to list crew jobs.
2. Call `edu_commitments` (optionally `status: "overdue"` or `"pending"`).
3. Reuse the injected brief for context. Call `edu_brief` only if absent or the user
   explicitly requests a refresh. Check `edu_capabilities` for actual installed support.

## Show the user

- A compact table of crew jobs: id, CLI, status, elapsed, tokens/cost.
- Commitments sorted by due date, overdue first, with owners.
- One line on how to watch live: `edu watch` in another terminal.
- If everything is empty, say so in one line.

## Failure handling

- The `edu_*` tools are missing: tell the user to run `edu setup`, then restart this CLI.
- Only `edu_crew_status` is missing: support is unknown (the tool may be deferred or
  unavailable). In Pi discover `mcp__edu__edu_crew_status` via codemode/tool_search;
  consult `edu_capabilities` if available and show commitments alone if needed.
