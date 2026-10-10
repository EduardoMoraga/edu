# Edu in OpenCode

## Install

```bash
# Windows: irm https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.ps1 | iex
curl -fsSL https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.sh | bash
```

OpenCode has no plugin marketplace, so `edu setup` copies Edu's commands, agents and plugin
into `~/.config/opencode/`, adds `mcp.edu` to `opencode.json`, and writes a managed identity
block in `~/.config/opencode/AGENTS.md`. Every change is recorded for `edu uninstall`.

## Verify

Run `edu vault` after `edu init` to browse linked project memory in Obsidian;
`edu vault --check` reports broken links.

Ask: **"what do you remember?"** OpenCode should call `edu_brief`. `opencode mcp list` shows
the `edu` server; `edu doctor` shows the integration.

## What you get

- Commands: `/edu-brief`, `/edu-recall <topic>`, `/edu-remember <note>`, `/edu-reflect`,
  `/edu-crew <cli>: <task>`, `/edu-run <goal>`, `/edu-review [base]`, `/edu-status`.
- Edu roles as OpenCode agents, and skills that trigger from plain English or Spanish.
- DeepSeek and other models: configure them as OpenCode providers; Edu works the same.

## Troubleshooting

- **No `edu_*` tools:** run `edu setup`, restart OpenCode, check `"mcp": {"edu": …}` in
  `~/.config/opencode/opencode.json`.
- **Commands missing:** check `~/.config/opencode/commands/edu-*.md`; rerun `edu setup`.
- **Remove:** `edu uninstall --scope global` (refuses to overwrite files you edited unless
  `--force`).
