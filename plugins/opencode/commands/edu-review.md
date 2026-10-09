---
description: Edu review: cross-vendor, read-only review of the current diff
agent: build
subtask: false
---

Follow the `edu-review` skill. Arguments: $ARGUMENTS

1. Confirm there is a diff to review (`git status`, `git diff`). If the tree is clean, use
   the base ref from the arguments or ask for one.
2. Call `edu_crew_review` with `base` and, only if one was named, `cli`. Edu picks a
   reviewer from a different vendor when available and runs it read-only.
3. If a job id comes back, poll `edu_crew_status` and fetch `edu_crew_result`.
4. Verify each finding against the code. Report verdict (`pass` or `fix`), findings by
   severity with file:line, which ones you confirmed, and what you changed.

If `edu_crew_review` is missing, tell the user to run `edu setup` and restart this CLI.
