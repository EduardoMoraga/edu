---
name: edu-crew
description: "Delegate a task to another coding CLI (Claude Code, Codex, Pi, OpenCode, Antigravity) through Edu, wait for it, and summarize the result. Triggers: 'ask codex to', 'have claude do', 'delegate this', 'run this in parallel', 'crew'; 'pídele a codex que', 'que claude haga', 'delega esto', 'en paralelo', 'manda esto al equipo'."
---

# Edu crew

## When

- The user names another CLI for a task ("codex: write tests for src/auth").
- Work is independent and benefits from a fresh context or a different vendor.

## Steps

1. Parse the request as `<cli>: <task>`. Valid CLIs: `claude`, `codex`, `pi`,
   `opencode`, `agy`. If no CLI is named, pick one different from yourself and say which.
2. Call `edu_crew_dispatch` with `cli`, a self-contained `task` (goal, files, acceptance
   checks), and `mode`: `pane` when the user wants to watch it in herdr, otherwise
   `headless`. Add `autonomy: "readonly"` for research or review-only work.
3. Tell the user the job id and how to watch it (`edu watch`, or the herdr pane).
4. Poll with `edu_crew_status` (`jobId`) until the job is `done`, `failed` or `cancelled`.
   Between polls keep doing useful work; do not poll in a tight loop.
5. Call `edu_crew_result` with `jobId` (use `waitSeconds` to block briefly when idle).

## Show the user

- Job id, CLI, status, elapsed time, tokens/cost.
- A short summary of what the job did, the files it touched, and the checks it ran.
  Mark anything not verified as `inferred`.
- Suggest `edu-review` before treating the change as done.

## Failure handling

- `edu_crew_*` tools are missing: tell the user to run `edu setup` (and update Edu if
  `edu --version` is older than 0.2), then restart this CLI.
- The target CLI is not installed or not logged in: report the error and offer another CLI.
- The job `failed`: show its last output and ask whether to retry or take it over.
