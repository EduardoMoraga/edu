---
name: edu-status
description: "Show where things stand in Edu: open commitments, crew jobs in flight, and recent brain activity. Triggers: 'status', 'what is pending', 'what are the agents doing', 'any jobs running'; 'estado', 'qué está pendiente', 'qué están haciendo los agentes', 'hay trabajos corriendo'."
---

# Edu status

## Steps

1. Call `edu_crew_status` with no `jobId` to list crew jobs.
2. Call `edu_commitments` (optionally `status: "overdue"` or `"pending"`).
3. If the user wants more context, call `edu_brief`.

## Show the user

- A compact table of crew jobs: id, CLI, status, elapsed, tokens/cost.
- Commitments sorted by due date, overdue first, with owners.
- One line on how to watch live: `edu watch` in another terminal.
- If everything is empty, say so in one line.

## Failure handling

- The `edu_*` tools are missing: tell the user to run `edu setup`, then restart this CLI.
- Only `edu_crew_status` is missing: Edu is older than 0.2; suggest updating Edu, then
  `edu setup`, and show commitments alone.
