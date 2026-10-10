# Edu in Antigravity

## Install

```bash
# Windows: irm https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.ps1 | iex
curl -fsSL https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.sh | bash
```

Or install the plugin folder shipped in the npm package:

```bash
agy plugin install "$(npm root -g)/edu-agent/plugins/agy"
```

In PowerShell: `agy plugin install "$(npm root -g)\edu-agent\plugins\agy"`.

## Verify

Run `edu vault` after `edu init` to browse linked project memory in Obsidian;
`edu vault --check` reports broken links.

Ask: **"what do you remember?"** Antigravity should call `edu_brief`. `agy plugin list`
shows `edu`; `edu doctor` shows the integration.

## What you get

- Identity from the plugin rule (`rules/edu.md`).
- Skills that trigger from plain English or Spanish: `edu-brief`, `edu-recall`,
  `edu-remember`, `edu-reflect`, `edu-crew`, `edu-run`, `edu-review`, `edu-status`.
- Edu roles as agents and the `edu` MCP server.

Example: "use edu-crew: codex, write tests for src/auth".

## Troubleshooting

- **No `edu_*` tools:** run `edu setup`, restart Antigravity, check `agy plugin list`.
- **Plugin rejected:** run `agy plugin validate "$(npm root -g)/edu-agent/plugins/agy"` and
  update Edu.
- **Remove:** `agy plugin uninstall edu` or `edu uninstall --scope global`.
