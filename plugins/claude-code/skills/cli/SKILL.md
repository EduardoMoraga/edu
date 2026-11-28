---
name: edu-cli
description: "Use the edu CLI when this session has no Edu MCP server. Triggers: edu_brief is missing, MCP is unavailable, a cloud session without Edu, 'run edu brief'."
---

# Edu CLI when MCP is missing

`edu_brief`, `edu_recall`, `edu_read` and `edu_remember` are MCP tools. This session does not have them.
Use the `edu` binary. It uses the brain at this process's `EDU_HOME`.

## Steps

1. Run `edu brief` once and reuse it.
2. Search with `edu recall`. The command is `edu brain recall <query>`.
3. Open a note with `edu brain read <id>`.
4. Save a durable decision or lesson with `edu brain remember "<title>"`.
5. Sync with `edu sync --cloud`. Do not install a schedule in a sandbox.

## One profile

Follow the `AGENTS.md` already in this environment. It names one profile.
`edu join --cloud` belongs in that file, with that file's `--profile`.
Do not change `EDU_HOME`. Do not open a second vault. Do not pass a different `--profile`.
