# Edu in Pi

## Install

```bash
# Windows: irm https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.ps1 | iex
curl -fsSL https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.sh | bash
```

Or with Pi's package manager:

```bash
pi install git:github.com/EduardoMoraga/edu
```

The extension registers the `edu` MCP server (which runs the `edu` binary) and injects the
identity before each agent turn, so install the npm package either way.

## Verify

Run `edu vault` after `edu init` to browse linked project memory in Obsidian;
`edu vault --check` reports broken links.

Ask: **"what do you remember?"** Pi should call `edu_brief`. `pi list` shows the package;
`edu doctor` shows the integration.

## What you get

- Prompts: `/edu-brief`, `/edu-recall <topic>`, `/edu-remember <note>`, `/edu-reflect`,
  `/edu-crew <cli>: <task>`, `/edu-run <goal>`, `/edu-review [base]`, `/edu-status`.
- Skills with the same names that trigger from plain English or Spanish.
- DeepSeek and other models: configure them as Pi providers; Edu works the same.

Example: `/edu-crew codex: write tests for src/auth`.

## Troubleshooting

- **No `edu_*` tools:** run `edu setup`, restart Pi, then `pi list`.
- **`edu: command not found`:** the global npm bin is not on PATH; reinstall `edu-agent`.
- **Remove:** `pi remove git:github.com/EduardoMoraga/edu` or `edu uninstall --scope global`.
