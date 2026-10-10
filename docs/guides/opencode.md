# Edu in OpenCode

## Install

```bash
# Windows: irm https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.ps1 | iex
curl -fsSL https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.sh | bash
```

OpenCode has no plugin marketplace, so `edu setup` copies Edu's commands, agents and plugin
into `~/.config/opencode/`, adds `mcp.edu` to `opencode.json`, and writes a managed identity
block in `~/.config/opencode/AGENTS.md`. It also installs the Edu Deck TUI plugin in
`~/.config/opencode/tui-plugins/edu.tsx`, adds its path to the `plugin` list in
`~/.config/opencode/tui.json` (or edits your `tui.jsonc` in place, comments kept), and copies
the `edu` theme to `~/.config/opencode/themes/edu.json`. Every change is recorded for
`edu uninstall`.

## Verify

Run `edu vault` after `edu init` to browse linked project memory in Obsidian;
`edu vault --check` reports broken links.

Ask: **"what do you remember?"** OpenCode should call `edu_brief`. `opencode mcp list` shows
the `edu` server; `edu doctor` shows the integration.

## What you get

- **Edu Deck:** the EDU wordmark on the home screen with a stats line (project, brain
  canonical/proposed/episodic/transitive, crew running/approvals, spec), and a live deck in
  the session sidebar: brain tiers and crew jobs with their status. `/edu-deck` shows the
  full summary. It reads `edu deck --json` every 3 seconds; with an older `edu` it shows the
  identity only.
- **`edu` theme** (warm accent on dark): choose it with `/themes`, or set `"theme": "edu"` in
  `tui.json`. Edu never selects it for you.
- Commands: `/edu-brief`, `/edu-recall <topic>`, `/edu-remember <note>`, `/edu-reflect`,
  `/edu-crew <cli>: <task>`, `/edu-run <goal>`, `/edu-review [base]`, `/edu-status`.
- Edu roles as OpenCode agents, and skills that trigger from plain English or Spanish.
- DeepSeek and other models: configure them as OpenCode providers; Edu works the same.

## Troubleshooting

- **No `edu_*` tools:** run `edu setup`, restart OpenCode, check `"mcp": {"edu": …}` in
  `~/.config/opencode/opencode.json`.
- **No EDU logo or sidebar deck:** check that `tui.json` lists
  `~/.config/opencode/tui-plugins/edu.tsx` under `plugin`, then restart OpenCode.
- **Commands missing:** check `~/.config/opencode/commands/edu-*.md`; rerun `edu setup`.
- **Remove:** `edu uninstall --scope global` (refuses to overwrite files you edited unless
  `--force`).
