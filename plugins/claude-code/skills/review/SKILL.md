---
name: edu-review
description: "Get an independent, cross-vendor review of substantial changes or an explicitly requested review through Edu. Triggers: 'review this', 'second opinion', 'is this ready', 'cross review', before a substantial commit or PR; 'revisa esto', 'segunda opinión', 'está listo', 'revisión cruzada', antes de un commit o PR sustancial."
---

# Edu review

## When

- Review substantial changes before calling them done, committing, or opening a PR.
- Do not auto-spawn for every trivial task; verify small understood changes locally.
- The user asks for a second opinion on the work in progress.

## Steps

1. Check there is something to review (`git status` / `git diff`). If the tree is clean,
   ask which base to compare against (for example `main`).
2. Call `edu_crew_review` with `base` (default: the working-tree diff against `HEAD`)
   and, only if the user named one, `cli`. Edu picks a reviewer from a different vendor
   than you when one is available, and runs it read-only.
3. `edu_crew_review` returns findings directly. Read its summary before deciding what to do.
4. Verify each finding against the code before acting on it. Fix confirmed issues, or
   explain why a finding does not apply.

## Show the user

- Reviewer CLI and verdict (`pass` or `fix`).
- Findings ranked by severity, each with file:line and whether you confirmed it.
- What you changed in response, and what remains open.

## Failure handling

- `edu_crew_review` is missing: tell the user to run `edu setup`, then restart this CLI.
- No other vendor is installed: ask the user to select an installed reviewer CLI explicitly,
  explaining that a same-vendor review is weaker evidence.
