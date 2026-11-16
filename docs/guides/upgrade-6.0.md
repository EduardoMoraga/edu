# Upgrade to Edu 6.0

[Español](upgrade-6.0.es.md)

Edu 6.0 keeps your brains, notes, identities, registered workspaces and host configs. It changes
defaults that were unsafe, so a few things you did in 5.x now need one more flag or setting. Read
the [breaking changes](#breaking-changes) table first. The full list is in the
[CHANGELOG](../../CHANGELOG.md).

## Before you upgrade

- **Decide pending approvals.** A 5.x run waiting for approval cannot be approved by 6.0 (it has no
  `requestId`). Approve or reject it first, or cancel it after the upgrade with
  `edu crew cancel <id>` and run it again.
- **Let running crew jobs finish.** The upgrade replaces the files a running worker loads.

## Upgrade

### Quick: `edu update`

```bash
edu update --check
edu update
edu --version
```

From 5.x, the updater that runs is the 5.x one: it installs 6.0 straight from the release URL,
without a checksum check. Every update after 6.0 is verified.

### Verified

To verify this jump too, check the package yourself, then run the two steps `edu update` runs
after installing, in the same order:

```bash
curl -fsSLO https://github.com/EduardoMoraga/edu/releases/download/v6.0.0/edu-agent.tgz
curl -fsSLO https://github.com/EduardoMoraga/edu/releases/download/v6.0.0/SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS   # macOS: shasum -a 256 --check --ignore-missing SHA256SUMS
npm install -g ./edu-agent.tgz
edu internal migrate-workspaces                 # back up and migrate managed contracts
edu setup --yes                                 # refresh every host
```

Windows (PowerShell):

```powershell
$base = 'https://github.com/EduardoMoraga/edu/releases/download/v6.0.0'
Invoke-WebRequest "$base/edu-agent.tgz" -OutFile edu-agent.tgz
Invoke-WebRequest "$base/SHA256SUMS" -OutFile SHA256SUMS
(Get-FileHash edu-agent.tgz -Algorithm SHA256).Hash.ToLower()   # must match the edu-agent.tgz line
Get-Content SHA256SUMS
npm install -g .\edu-agent.tgz
edu internal migrate-workspaces
edu setup --yes
```

`edu internal migrate-workspaces` exits 1 when a registered workspace is missing; the others are
still migrated.

**Then restart** Claude Code, Codex, Pi, OpenCode and Antigravity. A running host keeps the old
MCP server, hooks and plugin until it restarts.

## Breaking changes

| Change | Who it affects | What to do |
|---|---|---|
| [Updates and installs are verified](#verified-updates) | Anyone installing a release older than 6.0 | Add `--allow-unverified` |
| [Claim bands are required](#claim-bands-are-required) | Agents and scripts that call `edu_remember` for transitive notes | Pass `band` |
| [Approvals name their gate](#approvals-name-their-gate) | MCP clients and scripts that approve crew runs | Pass `requestId`; drop `autoApprove` |
| [Crew settings live in the global config](#crew-settings-live-in-the-global-config) | MCP callers asking for `autonomy: "full"`; agents that need tokens such as `GITHUB_TOKEN` | Set `crew.maxAutonomy` or `crew.env.passthrough` in the global config |
| [Unregistered checks need a person](#unregistered-checks-need-a-person) | `edu run --yes` in scripts | Register the checks, or pass `--allow-unregistered-checks` |
| [MCP never creates a brain](#mcp-never-creates-a-brain) | `edu_project_use` or MCP roots pointing at a folder without `.edu/` | Run `edu init` there first |
| [Autonomy means the same on every CLI](#autonomy-means-the-same-on-every-cli) | Headless Codex or Pi jobs at the default `ask`; read-only jobs on OpenCode or agy | Use `--autonomy auto` to write; pick claude, codex or pi for read-only |
| [Crew jobs time out](#crew-jobs-time-out) | Headless jobs longer than an hour | `--timeout <minutes>` or `crew.timeoutMinutes` |
| [Test scripts](#test-scripts-for-contributors) | Contributors and CI that run `npm test` | Run `npm run test:perf` or `npm run test:all` for the budgets |

## Verified updates

`edu update`, `install.sh` and `install.ps1` download the package and `SHA256SUMS` only from
`https://github.com/EduardoMoraga/edu/releases/download/<tag>/`, check the SHA-256, and install
the verified local file. A mismatch installs nothing.

| You want | Run |
|---|---|
| The latest release | `edu update` |
| A release older than 6.0 (no `SHA256SUMS`) | `edu update v5.0.1 --allow-unverified` |
| A release older than 6.0 from `install.sh` | `EDU_ASSET=<release asset URL> EDU_ALLOW_UNVERIFIED=1`, or the `--allow-unverified` flag |
| A release older than 6.0 from `install.ps1` | `$env:EDU_ALLOW_UNVERIFIED = '1'` and `$env:EDU_ASSET` |

- A 6.0 or newer release without `SHA256SUMS` is always refused.
- `edu update --json` reports `verified` (`false` only after `--allow-unverified`).
- `EDU_ASSET=<path to a .tgz>` still installs a package you built yourself, as given.

Going back to 5.x installs without a checksum, and the 5.x workspace migration refuses to
downgrade contracts 6.0 migrated, so it reports the update as incomplete. Your notes are not
touched.

## Claim bands are required

Every transitive note (decision, hypothesis, commitment, lesson) states how strongly it may be
asserted: `verified`, `inferred` or `hypothesis`.

- **MCP:** `edu_remember` rejects a transitive note without `band`. The 6.0 skills ask the agent
  for one; update any prompt or script of your own that calls the tool.
- **CLI:** `edu brain remember` without `--band` writes `hypothesis` and says so.
- **Old notes** without a band show as `unbanded`. Edu never rewrites them; add `band:` to the
  frontmatter to set one.

## Approvals name their gate

Every approval gate gets a fresh `requestId`. A decision counts only when it names the gate that
is open and was written after it opened.

```bash
edu crew status <job-id>                                # approval.requestId shows the open gate
edu crew approve <job-id>                               # decide the gate open right now
edu crew approve <job-id> --request <request-id>        # refused if another gate is open now
edu crew reject <job-id> --request <request-id>
```

- **MCP:** `edu_crew_approve` requires `requestId` (from `edu_orchestrate` or `edu_crew_status`).
  It is recorded as the host LLM's decision (`by: host-llm`), which does not count as a person and
  does not authorize unregistered checks.
- `edu_orchestrate` no longer accepts `autoApprove`.
- Crew workers (`EDU_CREW_JOB` set) can never approve, through MCP, the CLI or decision files.
- Decision files from before 6.0 are ignored.
- `edu brain approve` needs a terminal, or `--yes` in scripts, and refuses inside a crew worker.

## Crew settings live in the global config

These settings are read only from the global config, `~/.edu/config.json` (or
`$EDU_HOME/config.json`). A project's `.edu/config.json` can be written by an agent or come with a
cloned repository, so it cannot raise them.

```json
{
  "crew": {
    "maxAutonomy": "auto",
    "env": { "passthrough": ["GITHUB_TOKEN"] },
    "timeoutMinutes": 60
  }
}
```

Add the `crew` section to the existing file; keep its other keys.

| Key | Default | Read from | Effect |
|---|---|---|---|
| `crew.maxAutonomy` | `auto` | global only | Highest autonomy an MCP caller may request in `edu_crew_dispatch`. `full` is refused until you raise it. `edu crew dispatch` from a terminal is not limited. |
| `crew.env.passthrough` | `[]` | global only | Extra variable names agent CLIs receive. |
| `crew.timeoutMinutes` | `60` | the workspace's config, else the global one | Default timeout of headless crew jobs, 1 to 1440. |

An invalid `crew` section falls back to the defaults.

### What agent CLIs receive

Agent CLIs started by Edu no longer inherit your whole environment. They get:

- what any program needs: `PATH`, home and profile folders, locale, `TERM`, proxy variables and
  CA bundles, temp folders, XDG folders and the Windows system variables;
- Edu's own non-secret settings (`EDU_HOME`, `EDU_LANG`, …);
- that CLI's own auth variables, for example `ANTHROPIC_*` for Claude Code and `OPENAI_*` and
  `CODEX_*` for Codex.

Anything else, such as `GITHUB_TOKEN`, `NPM_TOKEN` or `SSH_AUTH_SOCK`, must be listed in
`crew.env.passthrough`. On Windows names match case-insensitively. Registered checks
(`.edu/harness/checks.json`) still get the full environment: you wrote them.

## Unregistered checks need a person

A check the planner proposes that is not in `.edu/harness/checks.json` runs only when:

- a person approves the spec that lists it (the approval shows the exact commands), or
- the run has `--allow-unregistered-checks`.

`edu run --yes` and approvals from the host LLM do not run them. The run reports
`Unregistered check(s) not run: …`. To run a check every time, register it:

```bash
edu checks add --id unit --req R1 --cmd "npm test"
```

## MCP never creates a brain

`edu_project_use` and the MCP roots a client sends accept only:

- a registered workspace (by name or agent name),
- a folder that already has `.edu/`, or
- `global`.

Neither creates a brain any more. Run `edu init` in the folder first. Roots that arrive late, and
`roots/list_changed`, are now picked up.

## Autonomy means the same on every CLI

| Level | Meaning |
|---|---|
| `readonly` | Read and search only. |
| `ask` | Writes need a person. A headless run has nobody to ask, so its writes are refused. |
| `auto` | Edit the workspace and run commands without asking. |
| `full` | No permission checks. |

Headless flags per CLI:

| CLI | `readonly` | `ask` | `auto` | `full` |
|---|---|---|---|---|
| claude | `--permission-mode plan` | `--permission-mode default` | `acceptEdits` plus `--allowedTools Bash` | `bypassPermissions` |
| codex | `-s read-only` | `-s read-only` (5.x: `workspace-write`) | `-s workspace-write` | `-s danger-full-access` |
| pi | `--tools read,grep,find,ls` | same as `readonly` (5.x: all tools) | Pi's default tools | Pi's default tools |
| opencode | refused | its own config | its own config | its own config |
| agy | refused | its own config | its own config | `--dangerously-skip-permissions` |

- The default for `edu crew dispatch` and `edu_crew_dispatch` is `ask`. To let a headless job
  write, pass `--autonomy auto` (MCP: `autonomy: "auto"`).
- The lead planner and the reviewer need a CLI that enforces read-only (claude, codex or pi). Edu
  moves them to one, or stops with a message.
- In pane mode (herdr) a person is there, so Codex `ask` really asks.
- These are the host CLIs' permission modes, not an OS sandbox. Claude `auto` can run any shell
  command; Codex `auto` runs in Codex's workspace sandbox.

## Crew jobs time out

Headless crew jobs now stop after 60 minutes. A timed-out job ends `failed` with
`Timed out after N minute(s)`.

```bash
edu crew dispatch codex "migrate the test suite" --autonomy auto --timeout 180
edu crew cancel <job-id>     # stop the whole process tree now; the job ends cancelled
```

- Set the default with `crew.timeoutMinutes` (1 to 1440).
- Pane jobs and `edu run` orchestrations are not stopped by it.
- `edu crew status` checks that each worker is alive. A worker that died is marked `failed`
  instead of staying `running`.

## Sync: conflict copies and legacy schedulers

**Conflict copies.** When a note changed on two machines, upstream keeps the path and your version
is published beside it as `<name>.conflict-<host>-<sha>.md`, with its own id and `conflict_of`.
Your original commits are still backed up to `sync-conflict/<host>-<sha>`.

```bash
edu sync --status    # lists each conflict copy; exits 1 while any is tracked
```

Merge what you want into the original note, delete the copy, and sync again. Conflicts that differ
only in counters merge on their own (largest `uses`/`wins`/`losses`, newest dates).

**Legacy schedulers.** If you synced with your own LaunchAgent (macOS) or systemd user unit
(Linux), Edu reports it when it runs a `*-vault-sync` script or names your vault. Replace it with
Edu's schedule:

```bash
edu sync --status                       # "Legacy sync agent: <file>"
edu sync --install --replace-legacy     # asks first; add --yes in scripts
```

Edu removes the old agent only after its own schedule has started. On macOS it unloads the agent
with `launchctl` and deletes the plist; on Linux it disables the timer, stops the service, deletes
both units and reloads systemd. `--json` reports `removedLegacy`.

## Test scripts (for contributors)

| Script | Runs |
|---|---|
| `npm test` | The `unit` and `contracts` projects. |
| `npm run test:perf` | The wall-clock budgets (the `perf` project). |
| `npm run test:all` | All three projects. |
| `npm run test:coverage` | `unit` and `contracts` with the coverage ratchet. |
| `npm run test:deck` | The Edu Deck engine tests with `claude plugin test`. |

The Pi contract tests skip when Pi is not installed. See [CONTRIBUTING](../../CONTRIBUTING.md).

## Other changes you may notice

- Creating a note never overwrites a file: a taken path gets `-2`, `-3`. Non-Latin and very long
  titles get ASCII ids with a short hash.
- A note with broken frontmatter is quarantined instead of breaking recall. `edu brain lint` lists
  it as `unreadable` (`--strict` fails), and the brief lists it under "Unreadable notes".
- `edu_recall` shows only whole hits that fit the budget and says how many it left out.
- `edu uninstall` keeps edits you or a host made after install, such as a Claude Code login or new
  MCP servers. Setup keeps a `statusLine`, agent or `mcpServers.edu` you set yourself and says
  "Kept your own …".
- `edu_crew_result` waits at most 600 seconds.
