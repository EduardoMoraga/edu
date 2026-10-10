---
description: Edu run: orchestrate a goal with your playbook — spec, your approval, build, verified outcome
argument-hint: <goal>   e.g. add a --json flag to the status command
---

Follow the `edu-run` skill for: $ARGUMENTS

Example: `/edu:run add a --json flag to the status command`

1. Call `edu_orchestrate` with `goal: "$ARGUMENTS"`. Pass `playbook` or `mode` only if
   the user named them. Never set `autoApprove` unless the user explicitly asked.
2. Show the job id and the spec path, and summarize the spec's requirements and checks.
   Mention that `edu watch` shows the run live.
3. Ask the user to approve the spec and wait for the answer. Then call
   `edu_crew_approve` with the `jobId` and `approve: true` or `approve: false`.
4. Poll `edu_crew_status` with the `jobId` until it is `done`, `failed` or `cancelled`;
   then call `edu_crew_result`.
5. Report the outcome label and the verification summary (each check run by Edu, pass
   or fail), files changed and open items. Unchecked claims are `inferred`, not
   `verified`.

If `edu_orchestrate` is missing, tell the user to run `edu setup` and restart this CLI.
