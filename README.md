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

## Quickstart

**Windows** (PowerShell):

```powershell
irm https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.ps1 | iex
```

**macOS / Linux**:

```bash
curl -fsSL https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.sh | bash
```

The installer checks Node.js 22+, installs Edu and runs `edu setup`, which connects Edu to every
coding CLI it finds. Prefer npm directly?
`npm i -g https://github.com/EduardoMoraga/edu/releases/latest/download/edu-agent.tgz` then `edu setup`
(or `npm i -g github:EduardoMoraga/edu`).

Open your CLI and ask: **"what do you remember?"** — Edu answers from its brain.

`edu setup` installs globally with each CLI's own plugin system, creates the global brain
(`~/.edu`), and records every change so `edu uninstall` can reverse it. `edu doctor` shows
what is connected.

## Use Edu inside the agent you already love

| CLI | Install (or just `edu setup`) | What you get | How to call it |
|---|---|---|---|
| **Claude Code** | `/plugin marketplace add EduardoMoraga/edu` then `/plugin install edu@edu` | skills, slash commands, roles, MCP, identity hook, statusline | `/edu:brief`, `/edu:crew …`, or just ask |
| **Codex** | `codex plugin marketplace add EduardoMoraga/edu` then `codex plugin add edu@edu` | skills, MCP, identity hook | ask, or name a skill: `edu-crew` |
| **Pi** | `pi install git:github.com/EduardoMoraga/edu` | extension (MCP + identity), prompts, skills | `/edu-brief`, `/edu-crew …` |
| **OpenCode** | `edu setup` | commands, agents, plugin, MCP | `/edu-brief`, `/edu-crew …` |
| **Antigravity** | `agy plugin install "$(npm root -g)/edu-agent/plugins/agy"` | skills, agents, rules (identity), MCP | ask, or name a skill: `edu-review` |
| **DeepSeek** | use it as a model provider in OpenCode or Pi | everything the host CLI gets | same as the host CLI |

Manual plugin installation is incomplete: run `edu setup` afterward to initialize the global
brain and install the Codex identity instructions. The marketplace commands alone do not do this.

Eight workflows, the same everywhere: **brief · recall · remember · reflect · crew · run ·
review · status**. Per-CLI details: [Claude Code](docs/guides/claude.md) · [Codex](docs/guides/codex.md) ·
[Pi](docs/guides/pi.md) · [OpenCode](docs/guides/opencode.md) ·
[Antigravity](docs/guides/antigravity.md).

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
```

```
/edu:run add a --json flag to the status command      # Claude Code (Pi/OpenCode: /edu-run)
```

In Codex, ask "run this with edu" or name the `edu-run` skill. `edu watch` shows the spec
card, every agent and each check live.

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
demand (`edu_recall`, `edu_read`), so context stays lean.

**It learns.** Notes that help rise, notes that mislead decay (`edu_feedback`).
`edu reflect` proposes lessons and skill changes from recent work; nothing becomes truth
until you run `edu proposals accept <id>`.

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
