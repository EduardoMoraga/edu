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

[Español](docs/README.es.md) · [Guides](docs/guides/) · [Architecture](docs/ARCHITECTURE.md)

---

## Edu 2.1

Edu 2.1 includes the audited 2.0 memory/session work and adds honest usage completeness,
capability-aware reader scheduling, declared skill bundles and explicitly approved experiments.
It does not establish that Edu is generally cheaper or faster than a native harness.

See [install and upgrade](docs/guides/upgrade-2.1.md),
[measurement](docs/guides/measurement-2.1.md), [skill bundles](docs/guides/skills-2.1.md)
and [experiments](docs/guides/experiments-2.1.md). Experiments never run during setup or upgrade,
make no automatic model calls and activate no candidates.

`edu capabilities --json` (alias `edu whats-new --json`) describes the actual installed binary.
Ask your agent to call `edu_capabilities` or run that command; restart host CLIs and MCP servers
after upgrading so existing sessions reload the plugin and tools.

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
never runs sudo), installs Edu, runs `edu setup`, which connects Edu to every coding CLI it finds,
and prints the next steps in your language. Prefer npm directly?
`npm i -g https://github.com/EduardoMoraga/edu/releases/latest/download/edu-agent.tgz` then `edu setup`
For a source checkout, use the [build and install workflow](docs/guides/upgrade-2.1.md#install-from-a-source-checkout).

Open your CLI and ask: **"what do you remember?"** — Edu answers from its brain.

`edu setup` installs globally with each CLI's own plugin system, creates the global brain
(`~/.edu`), and records every change so `edu uninstall` can reverse it. `edu doctor` shows
what is connected.

**Stay current:** `edu update` installs the latest published GitHub release with the npm of the Node
that runs Edu. Version 2.1 backs up and migrates managed contracts for the global brain and
registered workspaces before refreshing setup; it preserves custom memory and does not enable paid
background inference. Partial migration is reported as incomplete. `edu update --check` only reports;
`edu update <published-tag>` (or `--to <published-tag>`) selects a release, including an explicitly
published RC. npm installation is not transactional: after failure, verify `edu --version` before
retrying. Restart your host CLIs/MCP servers after a successful upgrade.

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
  `--cli`. What a document states becomes **accepted** canonical notes (band `verified`, source
  `file#heading`); interpretations stay **proposed** for you to approve. Procedures become
  playbooks, terms one glossary note. Invalid answers are retried once, then Edu falls back to
  the heading split. Review them with `edu brain proposals` (title, source, band, why) and decide
  with `edu brain approve <id>` / `--all` / `--reject <id>` (a rejected proposal is deleted and a
  record stays in episodic memory).
- `--no-llm` splits by headings, offline and deterministic. `--lang es|en` names the folders
  (default `EDU_LANG`, then your locale, then Spanish). `--dir` sets the parent (default `~/Edu`);
  a non-empty target needs `--yes`. Originals are never modified.
- Add more later from inside the workspace: `edu create --add notes.pdf`.
- PDFs use `pdftotext` when installed, otherwise a built-in JS reader. Scanned PDFs need OCR first.
- Any brain can live in a visible folder: set `"brainDir": "01-KNOWLEDGE"` in `.edu/config.json`.

## Use Edu inside the agent you already love

| CLI | Install (or just `edu setup`) | What you get | How to call it |
|---|---|---|---|
| **Claude Code** | `/plugin marketplace add EduardoMoraga/edu` then `/plugin install edu@edu` | skills, slash commands, roles, MCP, identity hook, statusline | `/edu:brief`, `/edu:crew …`, or just ask |
| **Codex** | `codex plugin marketplace add EduardoMoraga/edu` then `codex plugin add edu@edu` | skills, MCP, identity hook | ask, or name a skill: `edu-crew` |
| **Pi** | `pi install git:github.com/EduardoMoraga/edu` | extension (MCP + identity + live Edu Deck), `edu` theme, prompts, skills | `/edu-deck`, `/edu-brief`, `/edu-crew …` |
| **OpenCode** | `edu setup` | commands, agents, plugin, MCP, live Edu Deck (logo + sidebar), `edu` theme | `/edu-deck`, `/edu-brief`, `/edu-crew …` |
| **Antigravity** | `agy plugin install "$(npm root -g)/edu-agent/plugins/agy"` | skills, agents, rules (identity), MCP | ask, or name a skill: `edu-review` |
| **DeepSeek** | use it as a model provider in OpenCode or Pi | everything the host CLI gets | same as the host CLI |

Manual plugin installation is incomplete: run `edu setup` afterward to initialize the global
brain and install the Codex identity instructions. The marketplace commands alone do not do this.

Eight workflows, the same everywhere: **brief · recall · remember · reflect · crew · run ·
review · status**. Per-CLI details: [Claude Code](docs/guides/claude.md) · [Codex](docs/guides/codex.md) ·
[Pi](docs/guides/pi.md) · [OpenCode](docs/guides/opencode.md) ·
[Antigravity](docs/guides/antigravity.md).

Chat with your workspaces from Telegram: `edu connect hermes --project <workspace>` adds Edu to
[Hermes](docs/guides/hermes.md), and `--undo` reverts it byte for byte.

## The crew

Ask Codex to write tests from inside Claude, and watch it work:

```
/edu:crew codex: write tests for src/auth
```

Edu dispatches the job (`edu_crew_dispatch`), polls it (`edu_crew_status`), and brings back
a summary (`edu_crew_result`). With herdr running,
jobs can open in a visible pane next to you; otherwise they run headless.

```
/edu:review main
```

A read-only reviewer from a **different vendor** checks your diff (`edu_crew_review`) and
returns ranked findings. If no different vendor is installed, Edu asks you to select an
available reviewer explicitly.

**Mission control.** `edu watch` in a second terminal shows every crew job live: agents,
status, tokens and cost.

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
edu crew approve <job-id>                             # resume a detached spec approval
edu crew reject <job-id>                              # stop a detached run
```

```
/edu:run add a --json flag to the status command      # Claude Code (Pi/OpenCode: /edu-run)
```

In Codex, ask "run this with edu" or name the `edu-run` skill. `edu watch` shows the spec
card, every agent and each check live. Non-interactive stdin requires `--yes`; otherwise
the terminal asks you to approve the printed spec before execution. MCP clients can use
`edu_orchestrate` and `edu_crew_approve` for the same detached workflow.

## The brain

Plain Markdown with YAML frontmatter and `[[wikilinks]]`: readable by any LLM, graphable in
Obsidian (`edu brain link <vault>`), versionable with git. No database.

| Layer | What lives there |
|---|---|
| `canonical` | stable truth: standards, preferences, lexicon. Changes only when you accept a proposal |
| `episodic` | one note per session, immutable once closed |
| `transitive` | what carries forward: `D-` decisions · `H-` hypotheses · `C-` commitments · `L-` lessons |

Every note has a **claim band** — `verified`, `inferred` or `hypothesis` — and Edu never
states a hypothesis as fact. Sessions start with a small brief; everything else is pulled on
demand (`edu_recall`, `edu_read`), so context stays lean. In a shell, `edu brief [goal]` prints
the same session brief and `edu brain read <ref>` prints one note.

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

**It learns.** Notes that help rise, notes that mislead decay (`edu_feedback`).
`edu reflect` proposes lessons and skill changes from recent work; nothing becomes truth
until you run `edu proposals accept <id>`.

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

## Evidence and metrics

A change counts when it is verified, not when it looks right. Edu records context, tool,
verification, attribution and intervention traces per episode, following
[AI Harness Engineering](https://arxiv.org/abs/2605.13357).

```bash
edu checks run         # deterministic checks Edu runs itself
edu metrics --by cli    # AVSR, human-intervention rate, verification autonomy
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

Native alternatives: `claude plugin uninstall edu@edu` · `codex plugin remove edu@edu` ·
`pi remove git:github.com/EduardoMoraga/edu` · `agy plugin uninstall edu`. Edu refuses to
overwrite files you edited since install (`--force` to override). Your brain (`~/.edu`,
`.edu/`) is never deleted: it is your data.

## Windows

- Works in PowerShell, cmd and Git Bash with Node ≥ 22; CI runs on Windows, macOS and Linux.
- In PowerShell the Antigravity path is `"$(npm root -g)\edu-agent\plugins\agy"`.
- `edu brain link` creates a junction instead of a symlink; no admin rights needed.
- Crew pane mode needs herdr; without it, jobs run headless and `edu watch` shows them.

## FAQ

**Do I need several LLM subscriptions?** No. Everything works with one CLI; the crew is a bonus.

**Does Edu send my code anywhere?** Edu makes no network calls. It runs the CLIs you already
use, with their own settings.

**Can I edit the brain by hand?** Yes, it is Markdown. Accepted canonical notes are protected
from automatic edits.

## License

MIT © Eduardo Moraga
