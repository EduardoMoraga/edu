# Edu in Claude Code

## Install

```bash
# Windows: irm https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.ps1 | iex
curl -fsSL https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.sh | bash
```

The installer verifies the release package against its `SHA256SUMS`, installs it and runs
`edu setup --yes`. Setup registers Edu's marketplace from the installed package and installs the
`edu@edu` plugin with Claude Code's own plugin commands.

Or from inside Claude Code:

```
/plugin marketplace add EduardoMoraga/edu
/plugin install edu@edu
```

The plugin starts the `edu` binary for MCP and hooks, so install the npm package either way, then
run `edu setup` once to create the global brain.

## Verify

Ask: **"what do you remember?"** Claude should answer from the brief Edu injected at session start,
or call `edu_brief`. `/mcp` lists the `edu` server; `edu doctor` shows the integration from a
terminal.

## What you get

| Part | What it does |
|---|---|
| Skills | `/edu:brief`, `/edu:recall`, `/edu:remember`, `/edu:reflect`, `/edu:crew`, `/edu:run`, `/edu:review`, `/edu:status`, `/edu:brain`, `/edu:vault`. They also trigger from plain English or Spanish. |
| Roles | `lead`, `explorer`, `builder` and `reviewer` subagents. |
| MCP | The `edu` server (`edu mcp`): brain, workspaces and crew tools. |
| Hooks | `SessionStart` injects the brief; `SessionEnd` closes the session note it opened. |
| Output style | `edu`, the identity's voice. |
| Edu Deck | A live side pane with the agent tree and Edu's state. See [Edu Deck for Claude Code](claude-code-deck.md). |
| Statusline | `edu statusline` (see below). |

### Statusline

The plugin does not change your `statusLine`. To use Edu's, add this to `~/.claude/settings.json`:

```json
{ "statusLine": { "type": "command", "command": "edu statusline" } }
```

The managed-file install (`edu install --cli claude`, or setup's `adapter` method when the plugin
installer fails) writes it for you, unless you already have one: then it prints "Kept your own
statusLine" and leaves yours alone.

## Crew from Claude Code

```
/edu:crew codex: write tests for src/auth
```

Edu dispatches the job (`edu_crew_dispatch`), polls it and brings back a summary.

- The default autonomy is `ask`. A headless job has nobody to ask, so it cannot write: Codex and
  Pi run read-only. Say "with autonomy auto" to let the job edit files.
- From MCP, `full` is refused unless a person raised `crew.maxAutonomy` in the global config. See
  [Upgrade to 6.0](upgrade-6.0.md#crew-settings-live-in-the-global-config).
- Approvals from Claude (`edu_crew_approve`) must name the gate's `requestId` and are recorded as
  the host LLM's decision. The Deck's Approve and Reject buttons record `deck`.

## Troubleshooting

- **No `edu_*` tools:** run `edu setup`, restart Claude Code, then check `/mcp`.
- **No brief at start:** run `edu doctor`; the `brief` column should say `hook`.
- **Deck missing:** type `/edu-deck`. Narrow terminals do not dock it on their own.
- **Remove:** `claude plugin uninstall edu@edu` or `edu uninstall --scope global`.
