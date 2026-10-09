---
description: Edu crew: delegate a task to another coding CLI and report the result
argument-hint: <cli>: <task>   e.g. codex: write tests for src/auth
---

Follow the `edu-crew` skill for: $ARGUMENTS

Example: `/edu:crew codex: write tests for src/auth`

1. Parse `<cli>: <task>` (`claude`, `codex`, `pi`, `opencode`, `agy`). If no CLI is named,
   choose one from a different vendor than yourself and say which.
2. Call `edu_crew_dispatch` with `cli`, a self-contained `task` (goal, files, acceptance
   checks) and `mode` (`pane` if the user wants to watch it in herdr, else `headless`).
3. Tell the user the job id and that `edu watch` shows it live.
4. Poll `edu_crew_status` with the `jobId` until it is `done`, `failed` or `cancelled`;
   then call `edu_crew_result`.
5. Summarize: status, elapsed, tokens/cost, what changed, checks run. Suggest a review.

If the `edu_crew_*` tools are missing, tell the user to run `edu setup` and restart this CLI.
