# Edu in Codex

## Install

```bash
# Windows: irm https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.ps1 | iex
curl -fsSL https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.sh | bash
```

Or with the Codex marketplace:

```bash
codex plugin marketplace add EduardoMoraga/edu
codex plugin add edu@edu
```

The plugin calls the `edu` binary for MCP, so install the npm package either way. `edu setup`
also writes a managed block in `~/.codex/AGENTS.md` so the identity loads even if plugin
hooks do not fire.

## Verify

Ask: **"what do you remember?"** Codex should call `edu_brief`. `edu doctor` shows the
integration from a terminal.

## What you get

Codex has no plugin slash commands; the workflows ship as skills. Ask in plain English or
Spanish, or name the skill:

| Skill | Say |
|---|---|
| `edu-brief` | "catch me up" · "ponme al día" |
| `edu-recall` | "what did we decide about auth?" · "qué decidimos sobre auth" |
| `edu-remember` | "remember that we use pnpm" · "recuerda esto" |
| `edu-reflect` | "reflect on this week" · "reflexiona" |
| `edu-crew` | "ask claude to review the API docs" · "pídele a claude que…" |
| `edu-run` | "run this with edu" · "orquesta esto" · "haz que el equipo…" |
| `edu-review` | "get a cross-vendor review" · "revisión cruzada" |
| `edu-status` | "what are the agents doing?" · "estado" |

## Troubleshooting

- **No `edu_*` tools:** run `edu setup`, restart Codex, check `[mcp_servers.edu]` in
  `~/.codex/config.toml` or the plugin with `codex plugin list`.
- **Skill does not trigger:** name it explicitly ("use the edu-crew skill").
- **Remove:** `codex plugin remove edu@edu` or `edu uninstall --scope global`.
