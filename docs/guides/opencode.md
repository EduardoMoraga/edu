# Edu in OpenCode

## Install

```bash
# Windows: irm https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.ps1 | iex
curl -fsSL https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.sh | bash
```

OpenCode has no plugin marketplace, so `edu setup` copies Edu's commands, agents and plugin
into `~/.config/opencode/`, adds `mcp.edu` to `opencode.json`, and writes a managed identity
block in `~/.config/opencode/AGENTS.md`. It also installs the Edu Deck TUI plugin as
`~/.config/opencode/plugins/edu-deck/tui.tsx` and the `edu` theme as
`~/.config/opencode/themes/edu.json`. Every change is recorded for `edu uninstall`.

Edu targets OpenCode 2. OpenCode 2 discovers TUI plugins as folders under
`~/.config/opencode/plugins/` that contain a `tui` entrypoint, so the Deck needs no config edit.
It reads the TUI `plugins` list only from `~/.config/opencode/cli.json`, never from `tui.json`
or `tui.jsonc` (OpenCode 2 copies `tui.json` into `cli.json` once, on its first run). Edu
does not add anything to these files. Earlier Edu 0.6 builds installed the Deck as
`~/.config/opencode/tui-plugins/edu.tsx` and listed it in `tui.json`; rerunning `edu setup`
removes that file and that one entry from `tui.json`/`tui.jsonc` and `cli.json`, keeping your
other entries and comments. The server plugin (`plugins/edu.ts`) also loads in OpenCode 1,
but the Deck needs OpenCode 2.

## Verify

Run `edu vault` after `edu init` to browse linked project memory in Obsidian;
`edu vault --check` reports broken links.

Ask: **"what do you remember?"** OpenCode should call `edu_brief`. `opencode mcp list` shows
the `edu` server; `edu doctor` shows the integration.

## What you get

- **Edu Deck:** a `◆ EDU` stats line in the home footer (project, brain
  canonical/proposed/episodic, running crew jobs, approvals, spec), and a live deck in the
  session sidebar: brain tiers and crew jobs with their status. `/edu-deck` (also in the
  command palette) shows the wordmark and the full summary. OpenCode 2 has no slot for
  replacing the home logo, so the wordmark lives in that dialog. It reads `edu deck --json` every 3 seconds; with an older `edu` it shows the
  identity only.
- **`edu` theme** (warm accent on dark): choose it with `/themes`, or set
  `"theme": { "name": "edu" }` in `~/.config/opencode/cli.json`. Edu never selects it for you.
- Commands: `/edu-brief`, `/edu-recall <topic>`, `/edu-remember <note>`, `/edu-reflect`,
  `/edu-crew <cli>: <task>`, `/edu-run <goal>`, `/edu-review [base]`, `/edu-status`.
- Edu roles as OpenCode agents, and skills that trigger from plain English or Spanish.
- DeepSeek and other models: configure them as OpenCode providers; Edu works the same.

## Troubleshooting

- **No `edu_*` tools:** run `edu setup`, restart OpenCode, check `"mcp": {"edu": …}` in
  `~/.config/opencode/opencode.json`.
- **No EDU footer line or sidebar deck:** check that
  `~/.config/opencode/plugins/edu-deck/tui.tsx` exists and that `cli.json` has no `"-edu.deck"`
  entry under `plugins`, then run `/plugins` in OpenCode to see the load status. The Deck needs
  OpenCode 2 (`opencode --version`).
- **Commands missing:** check `~/.config/opencode/commands/edu-*.md`; rerun `edu setup`.
- **Remove:** `edu uninstall --scope global` (refuses to overwrite files you edited unless
  `--force`).
