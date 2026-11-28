# Edu

```
███████╗██████╗ ██╗   ██╗
██╔════╝██╔══██╗██║   ██║
█████╗  ██║  ██║██║   ██║
██╔══╝  ██║  ██║██║   ██║
███████╗██████╔╝╚██████╔╝
╚══════╝╚═════╝  ╚═════╝

a second brain that learns · a crew you can see
```

**Edu lives inside the coding agent you already use.** It gives Claude Code, Codex, Pi,
OpenCode and Antigravity one identity, a second brain that learns, and a crew: from any of
them, hand work to the others and watch it happen.

[Español](docs/README.es.md) · [Guides](docs/guides/) · [Changelog](CHANGELOG.md) ·
[Upgrade to 6.0](docs/guides/upgrade-6.0.md) · [Architecture](docs/ARCHITECTURE.md)

---

## Edu 6.0

Safe by default, reliable on macOS, Linux and Windows, and a deck that shows your agents.

- **Edu Deck for Claude Code:** a side pane with a live tree of the session's agents (stop one,
  write to it, switch its model) and Edu's brain, crew jobs and approvals.
  [Guide](docs/guides/claude-code-deck.md)
- **Safe by default:** verified installs and updates, approvals pinned to the gate you reviewed,
  an autonomy ceiling for MCP callers, agent CLIs that get only the environment they need, and
  planner-proposed checks that wait for a person. See the [safety model](#safety-model).
- **Memory you can trust:** creating a note never overwrites one, a broken note is quarantined
  instead of breaking recall, every transitive note states its claim band, and search covers every
  script.
- **Sync keeps both sides:** a real conflict publishes your version beside GitHub's, and
  `edu sync --install --replace-legacy` retires a hand-made sync scheduler.
- **Reliable crews:** jobs time out (60 minutes by default), `edu crew cancel` stops the whole
  process tree, a dead worker no longer shows as running, and a CLI error counts as a failure.

**Upgrading from 5.x?** Some defaults changed: read [Upgrade to Edu 6.0](docs/guides/upgrade-6.0.md).
Every change, and the history before 6.0, is in the [CHANGELOG](CHANGELOG.md).

## Quickstart

**Windows** (PowerShell):

```powershell
irm https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.ps1 | iex
```

**macOS / Linux**:

```bash
curl -fsSL https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.sh | bash
```

The installer checks Node.js 22+ (if missing: `brew install node` on macOS with Homebrew,
`winget install OpenJS.NodeJS.LTS` on Windows, otherwise it offers fnm or points to nodejs.org; it
never runs sudo). It downloads the latest release package and its `SHA256SUMS` from GitHub, checks
the checksum, installs the verified file, runs `edu setup`, which connects Edu to every coding CLI
it finds, and prints the next steps in your language.

Prefer npm directly? Verify the package first:

```bash
curl -fsSLO https://github.com/EduardoMoraga/edu/releases/latest/download/edu-agent.tgz
curl -fsSLO https://github.com/EduardoMoraga/edu/releases/latest/download/SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS   # macOS: shasum -a 256 --check --ignore-missing SHA256SUMS
npm i -g ./edu-agent.tgz
edu setup
```

For a source checkout, see [Git installs](CONTRIBUTING.md#git-installs). For cloud sandboxes
(Claude Code on the web, Codex cloud):
`curl -fsSL https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.sh | EDU_YES=1 EDU_JOIN=https://github.com/<you>/<brain>.git sh`
with a `GH_TOKEN` secret ([guide](docs/guides/install-5.0.md)).

Open your CLI and ask: **"what do you remember?"** — Edu answers from its brain.

`edu setup` installs globally with each CLI's own plugin system, creates the global brain
(`~/.edu`), and records every change so `edu uninstall` can reverse it. `edu doctor` shows
what is connected.

**Stay current:**

```bash
edu update --check   # only report
edu update           # install the latest release, verified against its SHA256SUMS
```

`edu update` downloads the package and `SHA256SUMS` only from this repository's GitHub releases,
checks the hash, installs the verified file with the npm of the Node that runs Edu, backs up and
migrates registered workspaces, and refreshes setup. `edu update <tag>` (or `--to <tag>`) picks a
release; releases older than 6.0 have no checksums and need `--allow-unverified`. npm installation
is not transactional: after a failure, check `edu --version` before retrying. Restart your host
CLIs and MCP servers afterwards. `edu capabilities --json` describes the installed binary.

## The Edu Deck

See your agents and Edu's state without leaving your CLI.

| Host | What it shows | Open it |
|---|---|---|
| **Claude Code** | Side pane: a live tree of agents with Stop, Write, Model and Effort controls; Edu, Reports, Files, Log, Usage and Help tabs; Approve and Reject for crew runs | Opens at start in wide terminals; `/edu-deck` |
| **Pi** | Header, footer and a crew widget in the TUI; a full deck overlay | `/edu-deck` |
| **OpenCode 2** | A footer stats line and a sidebar deck | `/edu-deck` |

Every deck reads `edu deck --json`; while that fails, it backs off instead of retrying in a loop.
Guides: [Claude Code](docs/guides/claude-code-deck.md) ·
[Pi](docs/guides/pi.md) · [OpenCode](docs/guides/opencode.md). In a terminal, `edu deck` prints the
same snapshot and `edu watch` follows crew jobs live.

## Give Edu your knowledge: `edu create`

Hand Edu a knowledge base (Word, PDF, Markdown or plain text) and it builds a self-contained,
Obsidian-ready workspace whose agent knows your operation and answers by the name you chose:

```bash
edu create manual.docx clients.md --name Albert          # → ~/Edu/albert/
cd ~/Edu/albert && claude                                 # or codex · pi · opencode
```

```
albert/
  00-START/README.md      home: what this is, Obsidian, first questions      (es: 00-INICIO)
  01-KNOWLEDGE/           the brain, visible + sources/ (copies of originals) (es: 01-CONOCIMIENTO)
  02-DELIVERABLES/ 03-LAB/ 04-PROJECTS/ 05-ARCHIVE/
  .edu/                   config (brainDir, identity), EDU.md, playbooks
  .obsidian/              the folder itself is the vault; opens on the README
  AGENTS.md, CLAUDE.md    "You are Albert, this workspace's agent…"
```

- Extraction runs headless through the first installed CLI (claude, codex, pi, opencode) or
  `--cli`. Every extracted note becomes a **proposed** canonical note awaiting your approval, even
  what a document states outright (band `verified`, source `file#heading`); nothing is accepted
  without you. Procedures become
  playbooks, terms one glossary note. Invalid answers are retried once, then Edu falls back to
  the heading split. Review them with `edu brain proposals` (title, source, band, why) and decide
  with `edu brain approve <id>` / `--all` / `--reject <id>` (a rejected proposal is deleted and a
  record stays in episodic memory). `edu brain approve` needs a terminal, or `--yes` in scripts.
- `--no-llm` splits by headings, offline and deterministic. `--lang es|en` names the folders
  (default `EDU_LANG`, then your locale, then Spanish). `--dir` sets the parent (default `~/Edu`);
  a non-empty target needs `--yes`. Originals are never modified.
- Add more later from inside the workspace: `edu create --add notes.pdf`.
- PDFs use `pdftotext` when installed, otherwise a built-in JS reader. Scanned PDFs need OCR first.
- Any brain can live in a visible folder: set `"brainDir": "01-KNOWLEDGE"` in `.edu/config.json`.

## Use Edu inside the agent you already love

| CLI | Install (or just `edu setup`) | What you get | How to call it |
|---|---|---|---|
| **Claude Code** | `/plugin marketplace add EduardoMoraga/edu` then `/plugin install edu@edu` | skills, roles, MCP, identity hooks, live Edu Deck pane ([guide](docs/guides/claude-code-deck.md)), `edu statusline` | `/edu-deck`, `/edu:brief`, `/edu:crew …`, or just ask |
| **Codex** | `codex plugin marketplace add EduardoMoraga/edu` then `codex plugin add edu@edu` | skills, MCP, identity hook | ask, or name a skill: `edu-crew` |
| **Pi** | `pi install git:github.com/EduardoMoraga/edu` | extension (MCP + identity + live Edu Deck), `edu` theme, prompts, skills | `/edu-deck`, `/edu-brief`, `/edu-crew …` |
| **OpenCode** | `edu setup` | commands, agents, plugin, MCP, live Edu Deck (logo + sidebar), `edu` theme | `/edu-deck`, `/edu-brief`, `/edu-crew …` |
| **Antigravity** | `agy plugin install "$(npm root -g)/edu-agent/plugins/agy"` | skills, agents, rules (identity), MCP | ask, or name a skill: `edu-review` |
| **DeepSeek** | use it as a model provider in OpenCode or Pi | everything the host CLI gets | same as the host CLI |

Manual plugin installation is incomplete: run `edu setup` afterward to initialize the global
brain and install the Codex identity instructions. The marketplace commands alone do not do this.

Eight workflows, the same everywhere: **brief · recall · remember · reflect · crew · run ·
review · status**. Per-CLI details: [Claude Code](docs/guides/claude-code.md) ·
[Codex](docs/guides/codex.md) · [Pi](docs/guides/pi.md) · [OpenCode](docs/guides/opencode.md) ·
[Antigravity](docs/guides/antigravity.md).

Chat with your workspaces from Telegram: `edu connect hermes --project <workspace>` adds Edu to
[Hermes](docs/guides/hermes.md), and `--undo` reverts it byte for byte.

## The crew

Ask Codex to write tests from inside Claude, and watch it work:

```
/edu:crew codex: write tests for src/auth
```

Edu dispatches the job (`edu_crew_dispatch`), polls it (`edu_crew_status`), and brings back
a summary (`edu_crew_result`); `edu_crew_cancel` stops it. With herdr running, jobs can open in a
visible pane next to you; otherwise they run headless. Either way the agent runs as a crew worker:
its Edu tools can read the brain but cannot approve gates, dispatch agents or write memory. The
same from a terminal:

```bash
edu crew dispatch codex "write tests for src/auth" --autonomy auto   # let it edit files
edu crew status                                  # every job; a dead worker is marked failed
edu crew result <job-id> --wait 300
edu crew cancel <job-id>                         # stop its whole process tree
```

| Autonomy | A headless job may |
|---|---|
| `readonly` | read and search |
| `ask` (default) | read; writes need a person, so headless Claude, Codex and Pi jobs do not write |
| `auto` | edit the workspace and run commands |
| `full` | do anything the CLI allows without asking; needs `crew.maxAutonomy: "full"` in the global config |

Crew jobs stop after 60 minutes: pass `--timeout <minutes>` (MCP: `timeoutMinutes` on
`edu_crew_dispatch`), or set `crew.timeoutMinutes`. A pane job past its limit is marked failed and
its pane closed. `edu crew status` prints a table (`--json` for scripts). Read-only work goes
only to CLIs that enforce it: claude, codex and pi. OpenCode `auto` and `full` pass `--auto`, which
approves every permission OpenCode's config does not deny. The exact flags per CLI are in the
[upgrade guide](docs/guides/upgrade-6.0.md#autonomy-means-the-same-on-every-cli).

```
/edu:review main
```

A read-only reviewer from a **different vendor** checks your diff (`edu_crew_review`) and
returns ranked findings. If no different vendor is installed, Edu asks you to select an
available reviewer explicitly.

**Mission control.** `edu watch` in a second terminal shows every crew job live: agents,
status, tokens and cost, including jobs waiting for your approval.

## Edu as your orchestrator

Give Edu a goal and it directs the team with **your** method, not a generic one.

1. **Playbook.** The lead plans with `.edu/playbooks/default.md` — spec first, observable
   requirements with deterministic checks, delegation by role, claim bands, learning at the
   close. Edit it to encode how you work. `quick` (small chores, no approval) and `research`
   (read-only, no builder) ship alongside; pick one with `--playbook <name>`.
2. **Spec → approve.** Edu writes `.edu/specs/<date>-<slug>.md` with requirements (`R1`…) and
   the checks it will run. Nothing is built until you approve it.
3. **Verified outcome.** Builders work, Edu runs the checks itself, a reviewer from another
   vendor looks at the result. "Done" means the checks passed — not that the model said so.

```bash
edu run "add a --json flag to the status command"   # from a terminal
edu run "add a --json flag" --playbook default --yes  # approve the spec and steps automatically
edu run "add a --json flag" --detach                  # continue as a watchable crew job
edu crew approve <job-id>                             # approve the open gate of a detached run
edu crew reject <job-id>                              # stop a detached run
```

```
/edu:run add a --json flag to the status command      # Claude Code (Pi/OpenCode: /edu-run)
```

In Codex, ask "run this with edu" or name the `edu-run` skill. `edu watch` shows the spec
card, every agent and each check live. Non-interactive stdin requires `--yes`; otherwise
the terminal asks you to approve the printed spec before execution.

Checks the planner proposes that are not registered run only when you approve the spec that lists
them. `--yes` approves for you, so those checks are skipped and reported; register them with
`edu checks add` and `edu checks accept`, or pass `--allow-unregistered-checks`. A repository's own
`.edu/harness/checks.json` counts as registered only after you review it and run
`edu checks accept` on your machine; changing it needs a new acceptance.

A detached run (`--detach`, `edu_orchestrate`) always stops at the spec gate, and its project
config cannot loosen the global `approvals` or raise `crew.maxAutonomy`. Its working time and each
gate's wait are limited by `crew.timeoutMinutes`.

MCP clients can use `edu_orchestrate` and `edu_crew_approve` for the same detached workflow.
`edu_crew_approve` must name the gate's `requestId`, and Edu records it as the host LLM's decision,
not yours.

## Safety model

What Edu enforces, and how to change it:

| Area | Default | Change it with |
|---|---|---|
| Installs and updates | Only packages that match the release's `SHA256SUMS`, downloaded from this repository's GitHub releases | `--allow-unverified`, only for releases older than 6.0 |
| Crew approvals | Each gate has a `requestId` and a decision must name it. Gates and decisions live in your global home, outside the workspace. Crew workers, headless or in a herdr pane, can never approve, dispatch or cancel. Each decision records `cli`, `deck` or `host-llm` | `edu crew approve <id> --request <requestId>` |
| Canonical notes | Only a person accepts them: `edu brain approve` needs a terminal | `--yes` in scripts |
| Crew autonomy | Up to `auto` from MCP and the CLI; `full` is refused | `crew.maxAutonomy` in the global config |
| Agent CLI environment | PATH, home, locale, terminal, proxy, temp and that CLI's own auth variables | `crew.env.passthrough` in the global config |
| Checks the planner invents, and a repository's own checks.json | Run only after a person approves the spec that lists them | `edu checks accept` (pinned per workspace until checks.json changes), or `--allow-unregistered-checks` |
| Workspaces from MCP | Registered workspaces and folders with `.edu/` only; MCP never creates a brain | `edu init` in the folder |
| Read-only roles | The planner, the reviewer and every read-only step run only on CLIs that enforce read-only | — |
| Your configs | Setup keeps values you set; uninstall keeps edits made after install | — |

The global config is `~/.edu/config.json` (or `$EDU_HOME/config.json`). A project's
`.edu/config.json` can be written by an agent, so it cannot raise these settings.

Edu adds no OS or network sandbox: autonomy maps to each CLI's own permission modes. Claude `auto`
can run any shell command; Codex `auto` runs inside Codex's workspace sandbox.

## The brain

Plain Markdown with YAML frontmatter and `[[wikilinks]]`: readable by any LLM, graphable in
Obsidian (`edu brain link <vault>`), versionable with git. No database.

| Layer | What lives there |
|---|---|
| `canonical` | stable truth: standards, preferences, lexicon. Changes only when you accept a proposal |
| `episodic` | one note per session, immutable once closed |
| `transitive` | what carries forward: `D-` decisions · `H-` hypotheses · `C-` commitments · `L-` lessons |

Every note has a **claim band** — `verified`, `inferred` or `hypothesis` — and Edu never
states a hypothesis as fact. `edu_remember` requires one for transitive notes, `edu brain remember`
defaults to `hypothesis` and says so, and older notes without one show as `unbanded`. Sessions
start with a small brief; everything else is pulled on demand (`edu_recall`, `edu_read`), so
context stays lean. In a shell, `edu brief [goal]` prints the same session brief and
`edu brain read <ref>` prints one note.

**Nothing is lost.** Creating a note never overwrites a file: a taken name gets `-2`, `-3`. A file
whose frontmatter Edu cannot read is quarantined: recall skips it, `edu brain lint` lists it as
`unreadable` and the brief names it, so you can repair it.

**Reading a note.** `edu_read` and `edu brain read` accept what you would call the note, tried
in order: exact id → legacy id or alias (`D-010`) → unique id prefix → filename → exact title
(ignoring case and accents). When several notes match, you get the candidates, never a guess.

**Importing an Albert vault.** `edu brain import albert <path>` reads `_ALBERT` without changing
it. Correlatives survive: `D-010_x.md` becomes `D-010-<title>` with `legacy_id: D-010` and
`aliases: [D-010, D-010_x]`, so `[[D-010]]` still resolves in Obsidian. `produjo`, `cerro`,
`revierte` and `revertida_por` become `links`, `supersedes` and `superseded_by`; body wikilinks
to imported notes are rewritten to the new filename, keeping the old text as the label.
Commitments keep `dueno` → `owner`, `para` → `stakeholder`, `plazo` → `due`. Every key without
an Edu field (`kpi`, `evidencia`, `decidido_por`, …) is kept verbatim under `albert:` and listed
in an "Origen Albert" section. A note with invalid YAML is imported with its raw text as the
body, marked `import_warning: invalid-frontmatter`, and listed as a warning. Running the import
again skips notes already imported.

**It learns.** Notes that help rise, notes that mislead decay (`edu_feedback`); advisory feedback
never retires a proven lesson. `edu reflect` proposes lessons and skill changes from recent work;
nothing becomes truth until you run `edu proposals accept <id>`.

**It cleans up.** `edu brain lint` is a read-only health check. `edu brain tidy` writes a
reviewable plan for what maintenance never cleans (empty sessions, stale hypotheses, broken import
links), and `edu brain tidy --apply` runs it with a backup. `edu dream` turns recent sessions from
every host into a plan you review; nothing changes until `--apply`.

## Obsidian: a window, not a second memory

Run `edu init` in each project, then `edu vault` once. Edu creates `~/EduVault`, links
registered brains, and adds it to Obsidian's vault list when Obsidian is installed.
`edu vault --check` reports broken links and note counts; `edu vault --no-register` skips
Obsidian registration.

```text
<project>/.edu/brain/ ──link──> ~/EduVault/Edu/<project>/
~/.edu/brain/        ──link──> ~/EduVault/Edu/_global/
                               ~/EduVault/Notes/  (your own notes)
```

**One writer:** only Edu writes brain memory. Keep your drafts in `Notes/`; do not copy
brain notes or let another tool generate a second memory folder in the vault. Never use
your home folder as the vault: Obsidian scans the whole tree, which can be very slow or
fail on protected files. Use a dedicated folder such as `~/EduVault` instead.

**Views.** Every maintenance run writes Obsidian Bases into the brain's `0-index/`, named in
the workspace language (`lang` in `.edu/config.json`): Knowledge (All / To approve),
Decisions, Lessons, Hypotheses, Commitments (Pending / Overdue / All) and Sessions; in
Spanish, Conocimiento, Decisiones, Lecciones, Hipótesis, Compromisos and Sesiones. A
brain sitting directly under the vault root (e.g. `~/Edu/01-CONOCIMIENTO`) is the
orchestrator: its Bases span every workspace in the vault and add a Project column. It
also gets `00-START/Dashboard.md` (es: `00-INICIO/Panel.md`), which embeds those views
and links each registered workspace. Edu rewrites that note only while its frontmatter
says `generated_by: edu`; delete that line to make it yours.

## One brain on every machine: `edu sync`

Keep the brain in a Git repository (for example `~/Edu`, with `~/.edu/brain` linked to its
`01-CONOCIMIENTO`) and run the same sync everywhere:

```bash
edu sync                              # commit, rebase on GitHub, push (never force)
edu sync --install                    # personal every 5 min, cheil every 15: systemd, LaunchAgent, or Task Scheduler
edu sync --install --replace-legacy   # also retire a hand-made sync agent (asks first)
edu sync --status                     # last result, scheduler, conflict copies; edu doctor shows it too
edu sync --cloud                      # cloud sandboxes: keep usage counters and Obsidian bases local
```

Files Edu regenerates (`0-index/`, `Panel.md`, `*.base`) never stop the sync: the GitHub copy wins
and Edu rewrites them. Conflicts that differ only in usage counters merge on their own (largest
counters, newest dates). A real conflict keeps both sides: GitHub's version stays at the path and
yours is published beside it as `<name>.conflict-<host>-<sha>.md`, and your commits are also backed
up to `sync-conflict/<host>-<sha>`. You get a desktop notification; merge what you need, delete
the copy and sync. `edu sync --status` exits 1 while a conflict copy is tracked.

Each profile gets its own scheduler, so two profiles on one machine do not share a task:
`EduSync-personal` and `EduSync-cheil` on Windows, `edu-sync-<id>` on systemd, and
`dev.edu.sync.<id>` on launchd. The script for each profile lives in that profile's home.
A personal sync refuses to push when `origin` is `cheil-vault` or a changed path resolves under
`C:\Cheil`. A cheil sync refuses `edu-vault`, and a Windows path that resolves outside the cheil
vault into the personal tree.

Edu also reports an older sync agent for the same vault (a LaunchAgent or systemd user unit that
runs a `*-vault-sync` script or names the vault), the previous unsuffixed `EduSync` task, and a
`CheilVaultSync` task. `--replace-legacy` removes them, after asking, once Edu's own schedule has
started. Without that flag they stay.

`edu join <repo>` attaches another machine or a cloud sandbox to the shared brain, and
`edu brain share <id>` moves a note to the global brain. Shared writes are hash-guarded (`edu_read`
shows the hash; `expected_hash` refuses a stale update), every note records its host, agent and
session, and secrets are redacted before writing.

## Evidence and metrics

A change counts when it is verified, not when it looks right. Edu records context, tool,
verification, attribution and intervention traces per episode, following
[AI Harness Engineering](https://arxiv.org/abs/2605.13357).

```bash
edu checks run         # deterministic checks Edu runs itself
edu metrics --by cli    # AVSR, human-intervention rate, verification autonomy
edu bench               # memory: retrieval quality and context cost, in temporary brains
```

## Standalone

Edu also runs on its own: `edu run "<goal>" [--solo|--crew] [--playbook <name>]` orchestrates
lead, explorer, builder and reviewer roles (see [Edu as your orchestrator](#edu-as-your-orchestrator)); `edu demo` shows the live view without any LLM.

## Uninstall

To audit competing startup context before removing anything:

```bash
edu doctor --context                  # estimated instruction tokens, hooks, MCPs and plugins by host
edu detach gentle-ai engram --dry-run # inspect selective removals; non-TTY runs dry by default
edu detach gentle-ai engram --yes     # back up and apply across detected hosts
edu detach --list                     # find an active backup ID
edu detach --undo                     # restore the latest backup byte-for-byte
```

`edu detach` never removes Edu or uninstalls binaries. Backups live under
`~/.edu/backups/detach-*/`; undo refuses changed files unless `--force` is explicit.
Use `--host claude,codex,pi,opencode,gemini` to limit the hosts.
OpenCode TUI plugins count too: `edu detach gentle-ai` removes its logo plugin from the
`plugins` list in OpenCode 2's `cli.json` (and the OpenCode 1 `plugin` list in
`tui.json`/`tui.jsonc`) and keeps your comments and other entries.

## Remove Edu

```bash
edu uninstall --scope global   # reverses everything edu setup recorded
npm rm -g edu-agent
```

`edu uninstall` removes only Edu's part of each host config and keeps edits you or a host made
after install, such as a Claude Code login or new MCP servers. A file nobody touched since install
goes back byte for byte. It also stops and deletes the `edu sync` scheduler and every nightly dream
(`edu dream --install`; `edu dream --uninstall` removes only the current project's). On Windows
`edu dream --install` installs nothing, so a Task Scheduler job you created yourself stays yours to remove.

Native alternatives: `claude plugin uninstall edu@edu` · `codex plugin remove edu@edu` ·
`pi remove git:github.com/EduardoMoraga/edu` · `agy plugin uninstall edu`. If you changed the part
of a file Edu manages, uninstall stops and names the file (`--force` removes Edu's part anyway).
Your brain (`~/.edu`, `.edu/`) is never deleted: it is your data.

## Windows

- Works in PowerShell, cmd and Git Bash with Node ≥ 22; CI runs on Windows, macOS and Linux.
- In PowerShell the Antigravity path is `"$(npm root -g)\edu-agent\plugins\agy"`.
- `edu brain link` creates a junction instead of a symlink; no admin rights needed.
- Crew pane mode needs herdr; without it, jobs run headless and `edu watch` shows them.
- Cancelling a crew job or closing the terminal ends the agent's whole process tree
  (`taskkill /t /f`).

## FAQ

**Do I need several LLM subscriptions?** No. Everything works with one CLI; the crew is a bonus.

**Does Edu send my code anywhere?** Edu has no server of its own and sends no telemetry. It uses
the network only for what you ask: the installers and `edu update` download releases from GitHub,
and `edu sync` and `edu join` push and pull your brain repository with Git. The CLIs Edu runs
(Claude Code, Codex, …) talk to their model providers with their own settings.

**Can I edit the brain by hand?** Yes, it is Markdown. Accepted canonical notes are protected
from automatic edits.

## License

MIT © Eduardo Moraga
