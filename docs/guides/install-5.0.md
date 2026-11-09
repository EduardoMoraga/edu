# Installing Edu 5.0

One command installs Edu and connects it to every coding CLI it finds. One command takes it out again.

## Install

macOS and Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.sh | sh
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.ps1 | iex
```

The installer checks Node.js 22 or newer, runs `npm install -g` on the release package, then runs
`edu setup --yes`. Setup finds `claude`, `codex`, `pi`, `opencode` and `agy` on `PATH`, configures each
one without asking, skips the ones that are not installed, and ends with one row per host:

```
host      method   MCP  brief  restart
claude    plugin   ok   hook   yes
codex     plugin   ok   hook   yes
pi        plugin   ok   hook   yes
opencode  adapter  ok   hook   yes
agy       plugin   ok   hook   yes
```

- **method**: `plugin` means the host's own plugin installer was used. `adapter` means Edu wrote
  managed files (always the case for OpenCode, and for any host whose plugin installer failed).
- **MCP**: `ok` means the `edu` MCP server is registered and `edu` is on `PATH`. `manual` means agy
  without its plugin, where Edu has no file it can register MCP in. `edu-missing` means `edu` is not on
  `PATH`, so hosts cannot start `edu mcp`.
- **brief**: `hook` means the host injects the Edu brief when a session starts. `instructions` means the
  managed instruction block tells the agent to call `edu_brief` once at the start.
- **restart**: a running host does not see the change until you restart it.

### Brief parity by host

| Host | How the brief arrives | Notes |
| --- | --- | --- |
| Claude Code | `SessionStart` hook | The plugin hook; the `adapter` method writes the same hook into `settings.json`. |
| Codex | `SessionStart` hook from the plugin | Codex asks you to trust a new or changed plugin hook once. Until you do, the `~/.codex/AGENTS.md` block covers it. Turns are recorded through `notify` only with the `adapter` method. |
| Pi | Edu extension | With the `adapter` method: the `AGENTS.md` block. |
| OpenCode 2 | TUI plugin attaches the brief to each new session as a session instruction | `opencode run` has no TUI and falls back to the `AGENTS.md` block. |
| Antigravity (`agy`) | `SessionStart` hook in the plugin (`hooks.json`) | With the `adapter` method: the `GEMINI.md` / `AGENTS.md` block. |

The block always says: reuse an injected brief, otherwise call `edu_brief` once.

### Options

| Environment | Flag | Meaning |
| --- | --- | --- |
| `EDU_YES=1` | `--yes` | Never ask. Any failed step makes the exit status 1. |
| `EDU_HOSTS=claude,codex` | `--hosts claude,codex` | Set up only these hosts (`edu setup --yes --cli …`). |
| `EDU_JOIN=<repo-url>` | `--join <repo-url>` | After setup, run `edu join <repo-url> --cloud`. |
| `EDU_ASSET=<url or .tgz>` | | Package to install (default: the latest release). |
| `EDU_LANG=es` | | Spanish messages. |
| `EDU_DRY_RUN=1` | `--dry-run` | Print the commands without running them. |

Flags go after `sh -s --`: `curl -fsSL …/install.sh | sh -s -- --yes --hosts claude`.

If you install a new CLI later, run `edu setup --yes --cli <name>`. A plain `edu setup --yes` (also what
`edu update` runs) refreshes the hosts that are already set up and lists any new CLI it found, but does not
add it on its own.

## Cloud sandboxes

For Claude Code on the web, Codex cloud, Grok and other sandboxes that run a setup script. This installs Edu
for the CLI in the sandbox and attaches the sandbox to your shared brain repository:

```sh
curl -fsSL https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.sh \
  | EDU_YES=1 EDU_HOSTS=claude EDU_JOIN=https://github.com/<you>/<brain-repo>.git sh
```

Use `EDU_HOSTS=codex` in Codex cloud. Leave out `EDU_HOSTS` to set up every CLI the image has.

**Where the Git token comes from.** Store a GitHub token with read/write access to the brain repository as
a secret named `GH_TOKEN` (or `GITHUB_TOKEN`) in the sandbox's environment settings. `edu join` and
`edu sync` hand it to Git through a credential helper scoped to that one command. The token never goes on
the command line or into the repository URL, and nothing prints it: the installer masks any
`user:token@` part of a URL before printing. Do not put the token in `EDU_JOIN`.

`--cloud` keeps usage counters and Obsidian bases local to the sandbox, so they do not cause sync churn.

## Uninstall

```sh
edu uninstall --yes
npm uninstall -g edu-agent
```

`edu uninstall` removes what `edu setup` and `edu install` recorded, for the global scope and for the
project in the current directory:

- native plugins, through each host's own command (`claude plugin uninstall`, `codex plugin remove`,
  `pi remove`, `agy plugin uninstall`) and the Edu marketplaces it added;
- managed files: MCP entries, hooks, instruction blocks between the `edu:core` markers, subagents,
  skills, OpenCode commands, agents, plugins and theme;
- directories Edu created, once they are empty.

What it guarantees:

- **Exact.** A file Edu changed is restored from the backup taken before the change. A file Edu created
  is deleted. JSON and TOML merges lose only Edu's keys. Where Edu was the only change, every config file
  ends up byte-for-byte as it was before setup. Tests check this with all five hosts on the managed-file
  path and on the plugin path.
- **Safe.** A managed file you edited after setup stops the uninstall (`Edu installation drift`).
  `--force` restores it anyway.
- **Idempotent.** A second run prints `Nothing to remove` and exits 0.
- **The brain stays.** `~/.edu` (or `EDU_HOME`) is kept unless you pass `--purge-brain`, which asks for
  confirmation. Without a terminal it also needs `--yes`. It refuses to delete a directory that holds your
  home or that is not an Edu brain, and it never touches a remote you joined.
- **Limits.** Native plugin state belongs to the host. For example, Codex keeps its own hook-trust
  records in `config.toml`. Edu asks the host to remove its plugin but does not edit the host's records
  of it.

Options: `--scope project|global` limits the uninstall to one scope. `--keep-brain` is the default, spelled
out.

## Install matrix (maintainers)

```sh
scripts/install-matrix.sh            # node:22-bookworm-slim and node:24-alpine in Docker
scripts/install-matrix.sh --local    # the same case on this machine in a temp HOME
```

It packs the checkout. For each case it installs with `install.sh` from the local package into a fake HOME
that holds user configs and stub `claude`/`codex`/`pi`/`opencode`/`agy` executables, which log their
arguments. Then it runs `edu setup --yes`, `edu doctor`, `edu bench context --json`, the Codex and agy
session-start hooks, and `edu uninstall --yes` twice. It checks exit codes, the plugin commands that ran,
and that HOME outside `~/.edu` matches its pre-install state byte for byte. It only needs the npm
registry. An image without Node (for example `ubuntu:24.04`) is not in the matrix, because the fnm path
downloads from GitHub and nodejs.org.
