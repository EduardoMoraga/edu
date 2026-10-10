---
name: edu-run
description: "Hand a goal to Edu's orchestrator: Edu writes a spec with requirements and checks using your playbook, you approve it, the team builds, and Edu verifies. Triggers: 'run with edu', 'orchestrate this', 'have the team build', 'let edu handle it', 'edu run'; 'orquesta', 'orquesta esto', 'haz que el equipo', 'que el equipo construya', 'que edu lo haga', 'corre con edu'."
---

# Edu run

## When

- The goal needs more than one step or more than one role (explore, build, review).
- The user wants the work done with their own method (the playbook) and verified by
  Edu, not just by the model saying "done".
- For a single task in another CLI, use `edu-crew` instead.

## Steps

1. Call `edu_orchestrate` with `goal` set to the user's request, verbatim. Add
   `playbook` only if the user named one (`default`, `quick`, `research`, or their own),
   and `mode` (`solo` | `crew`) only if they asked. Never set `autoApprove` unless the
   user explicitly said to skip approval.
2. Show the user the job id and the **spec path**, and summarize the spec: its
   requirements (`R1`…) and the checks Edu will run. Tell them `edu watch` shows the run
   live.
3. Ask the user to approve the spec, then STOP and wait. Do not approve on their behalf.
   - Approved: call `edu_crew_approve` with `jobId` and `approve: true`.
   - Rejected: call `edu_crew_approve` with `approve: false`; ask what to change in the
     goal or the playbook and offer to start a new run.
4. Poll `edu_crew_status` with the `jobId` until the job is `done`, `failed` or
   `cancelled`. Keep doing useful work between polls; do not poll in a tight loop.
   If it pauses at `awaiting-approval` again, show what is being asked and go back to 3.
5. Call `edu_crew_result` with the `jobId` for the final report.

## Show the user

- The outcome label (for example `autonomous_verified_success`, `unverified_success`).
- The verification summary: each check, pass or fail, run by Edu. Anything not covered
  by a passing check is `inferred` or `hypothesis`, never `verified`.
- Files changed, open items, and the spec path for reference.
- If verification failed: the failure attribution (observed, expected, next step).

## Failure handling

- `edu_orchestrate` is missing: tell the user to run `edu setup` (and update Edu if
  `edu --version` is older than 0.3), then restart this CLI.
- No spec path after the call: report what the tool returned and suggest
  `edu run "<goal>"` in a terminal to see the full error.
- The job `failed`: show the last output and the attribution, and ask whether to retry,
  adjust the spec, or take it over.
