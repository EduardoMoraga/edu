---
description: Edu status: crew jobs in flight and open commitments
argument-hint: [job id]
---

Follow the `edu-status` skill. Arguments: $ARGUMENTS

1. Call `edu_crew_status` (pass `jobId` if one was given).
2. Call `edu_commitments`.
3. Show a compact table of jobs (id, CLI, status, elapsed, tokens/cost) and commitments
   sorted by due date, overdue first. Mention `edu watch` for the live view.

If the `edu_*` tools are missing, tell the user to run `edu setup` and restart this CLI.
