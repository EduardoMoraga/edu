# Edu in Hermes (Telegram and other chats)

[Hermes](https://github.com/NousResearch/hermes-agent) is an agent with a messaging gateway
for Telegram, Slack, Discord, WhatsApp and other apps. Once you connect it, the agent you chat
with on your phone can use the same Edu tools as Claude Code, Codex or Pi. It can read and
write your workspace's brain, list and switch workspaces, and hand tasks to your coding CLIs.

## Connect

```bash
edu connect hermes                      # global brain (~/.edu) until you pick a workspace
edu connect hermes --project albert     # pin a workspace: registry name, agent name, or path
```

The command:

1. Adds `mcp_servers.edu` to `~/.hermes/config.yaml`. It uses `$HERMES_HOME/config.yaml` when
   `HERMES_HOME` is set, or the file you give with `--config <path>`. The command is your
   absolute Node binary plus Edu's absolute script, because the Hermes gateway runs as a
   LaunchAgent with a minimal `PATH`. If you move or reinstall Node, run `edu connect hermes` again.
2. Changes only that entry. Comments, quoting and long strings elsewhere in the file are
   left byte-for-byte as they were. Edu keeps a backup first.
3. Lists every MCP server whose command no longer exists, such as an uninstalled `engram`.
   Add `--remove-dead` to delete those entries in the same step.
4. Runs `hermes mcp test edu` to check that Hermes can start Edu and see its tools. Skip this
   with `--no-test`.
5. Tells you how to load the change in the running gateway.

Running it again changes nothing ("Already connected"). `--dry-run` shows the edits without
writing them.

### Telegram sees Edu automatically

Hermes gives every enabled MCP server to every platform. A platform stops getting them in
two cases:

- Its `platform_toolsets` list names MCP servers explicitly. The list is then an allowlist,
  so `edu connect hermes` adds `edu` to it.
- The list contains `no_mcp`. Edu warns you about this and leaves the list alone.

With the default `telegram: [hermes-telegram]`, nothing else needs to change.

### Load the change

The gateway reads MCP servers at startup. Use either of these:

- Send `/reload-mcp` in Telegram. With `approvals.mcp_reload_confirm: true`, Hermes first asks
  you to confirm, because reloading invalidates the prompt cache.
- Restart the gateway with `hermes gateway restart`, or run `edu connect hermes --restart`.
  A restart stops agents that are running in Hermes.

### Undo

```bash
edu connect hermes --undo        # restore the config exactly as it was before the latest connect
edu connect hermes --list        # active backups
```

Backups live in `~/.edu/backups/connect/`. If Hermes or you edited the file after the
connect, `--undo` refuses to run. Add `--force` to restore the backup anyway.

## Pick a workspace from the chat

Each workspace made with `edu create` has its own agent, for example "Albert". In Hermes:

- *"Which Edu workspaces do I have?"* calls `edu_projects`. It lists each workspace's name,
  agent and folder, and marks the active one.
- *"Use albert"* calls `edu_project_use`. It accepts a workspace name, an agent name, a path,
  or `global`. The switch lasts as long as the Hermes MCP session.

`edu mcp` picks its starting workspace in this order:

1. `--project <name|path>` (what `edu connect hermes --project` writes).
2. The `EDU_PROJECT` environment variable. Hermes passes environment variables to MCP
   servers only through the entry's `env:` map.
3. The client's MCP roots, or the launch folder.
4. The global brain `~/.edu`.

## Crew from Telegram

Ask *"have claude summarize this week's decisions"*. Hermes calls `edu_crew_dispatch`.

- **Headless** (default): the CLI runs in the background. Ask for the result later with
  `edu_crew_result`, or check progress with `edu_crew_status`.
- **Pane** (`mode: "pane"`): the job runs in a [herdr](https://herdr.dev) pane you can watch.
  Hermes does not run inside herdr, so Edu connects to the running herdr server through its
  socket (`~/.config/herdr/herdr.sock`, or `HERDR_SOCKET_PATH`). Each job gets a new tab in a
  workspace named **Edu**, and Edu creates that workspace if it does not exist. Open herdr to
  watch the job or answer the CLI's questions. When no herdr server is reachable, the job runs
  headless and its note says why, e.g. `Herdr unavailable (no herdr server is reachable from here)`.
  Inside herdr, the pane opens beside yours, as before.

Crew jobs run in the active workspace's folder, and the CLIs they start (claude, codex, pi…)
must be on the gateway's `PATH`.
