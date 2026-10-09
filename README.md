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

**Edu gives any coding CLI an identity, a second brain that learns, a context budget, an orchestrator, and a live view of what your agents are doing.**

Works with Claude Code, Codex, Pi, OpenCode and Antigravity. One CLI is enough; more is a bonus.

[Español](docs/README.es.md) · [Architecture](docs/ARCHITECTURE.md)

---

## Why Edu

Coding agents forget everything between sessions, bloat their own context, and work in a black box.

- **Memory that survives the session** — decisions, lessons and commitments live as plain Markdown you own.
- **Memory that learns** — notes that help rise, notes that mislead decay; nothing becomes "truth" without you.
- **Context on a budget** — a compact brief at start, everything else pulled on demand.
- **One model or a crew** — solo mode runs every role with one CLI; crew mode mixes vendors.
- **You can see it** — a terminal view of agents, tokens, cost, approvals and what the brain recalled.

## 60-second quickstart

```bash
npm i -g github:EduardoMoraga/edu   # Node >= 22
edu init                            # creates ./.edu (brain, contract, config, roles, skills)
edu install --cli claude            # connects Claude Code (prints the plan, asks first)
edu demo                            # the live view with a scripted crew, no LLM needed
edu run "add a health-check endpoint"
```

`edu doctor` tells you what is installed, integrated and linked.

## The brain

Plain Markdown with YAML frontmatter and `[[wikilinks]]`. Readable by any LLM, graphable in Obsidian, versionable with git. No database.

```
.edu/
├── EDU.md              the contract: identity, claim bands, session protocol
├── config.json         mode, default CLI, roles, approvals, context budget
├── brain/
│   ├── 0-index/        generated index + Obsidian dashboards
│   ├── 1-canonical/    stable truth — proposed → accepted only by you
│   ├── 2-episodic/     one note per session, immutable once closed
│   └── 3-transitive/   D- decisions · H- hypotheses · C- commitments · L- lessons
├── skills/  agents/  proposals/  runs/
```

**Three layers.** *Canonical* is what is true here (standards, preferences, lexicon). *Episodic* is what happened. *Transitive* is what carries forward:

| Prefix | Kind | Lifecycle |
|---|---|---|
| `D-` | decision | active → reverted (by a new `D-` that supersedes it) |
| `H-` | hypothesis | open → confirmed / refuted / no-evidence |
| `C-` | commitment | pending → delivered / overdue |
| `L-` | lesson | candidate → proven / retired |

**Claim bands.** Every note is `verified`, `inferred` or `hypothesis`. Recall shows the band; Edu never states a hypothesis as fact.

A global brain (`~/.edu`, or `EDU_HOME`) holds personal preferences; a project brain overlays it.

## How it learns

```
recall → feedback → maintain → reflect → proposals
```

1. **Recall** ranks notes by relevance × learned weight, and records the use.
2. **Feedback** marks a note as helpful or misleading (wins / losses).
3. **Maintain** (`edu brain maintain`) decays unused notes, promotes lessons with ≥ 3 wins and a learned weight ≥ 0.7, retires misleading ones, flags overdue commitments.
4. **Reflect** (`edu reflect --since 7d`) reads recent episodes and runs and proposes lessons, hypotheses and skill changes — schema-validated, never guessed.
5. **Proposals** wait for you: `edu proposals list | accept <id> | reject <id>`. Proven lessons become canonical *proposals*; only you accept them.

## Context budget

Sessions start with a short brief (identity, open commitments and hypotheses, proven lessons, last episodes, an index pointer). Everything else is fetched on demand through MCP (`edu_recall`, `edu_read`). Inspect exactly what would be injected:

```bash
edu context --query "auth" --budget 4000
```

It prints the pack and a per-section token table; what did not fit is listed as deferred.

## Solo vs crew

| | Solo (default) | Crew |
|---|---|---|
| Engines | one CLI plays every role | roles mapped to different CLIs |
| Sessions | each role is its own session | same |
| Review | reviewer is a fresh session | reviewer prefers a different vendor than the builder |

```bash
edu run "migrate the config loader" --solo --cli codex --harness H3
edu run "migrate the config loader" --crew
```

Roles: lead (plans), explorer (reads), builder (writes), reviewer (pass/fix verdict, one fix round). Steps that can write ask for approval (`ask-on-write`); `--yes` approves automatically. In a terminal you get the live view; in pipes and CI you get plain log lines. `Ctrl+C` cancels cleanly.

### Why evidence

Edu records task, context, verification, attribution, intervention and outcome evidence so results can be checked instead of inferred from a successful-looking patch. This follows the system-level harness framing in [AI Harness Engineering](https://arxiv.org/abs/2605.13357).

## Supported CLIs

`edu install [--cli claude,codex,pi,opencode,agy | all] [--scope project|global] [--dry-run] [--yes]`

| CLI | Instructions | Skills | Agents | MCP | Extras |
|---|---|---|---|---|---|
| Claude Code | managed block in `CLAUDE.md` | `.claude/skills/` | `.claude/agents/` | `.mcp.json` / `~/.claude.json` | output style, `edu statusline`, SessionStart/SessionEnd hooks |
| Codex | managed block in `AGENTS.md` | `.agents/skills/` | — | `~/.codex/config.toml` | — |
| Pi | managed block in `AGENTS.md` | `.agents/skills/` | — | `~/.pi/agent/mcp.json` | — |
| OpenCode | managed block in `AGENTS.md` | `.agents/skills/` | `opencode.json` | `opencode.json` | — |
| Antigravity | managed block in `GEMINI.md` + `AGENTS.md` | `.agents/skills/` | — | manual step | — |

Managed blocks touch only the text between `<!-- edu:core:start -->` and `<!-- edu:core:end -->`; JSON/TOML merges touch only Edu keys. Every write is recorded in `.edu/manifest.json`.

## Obsidian

```bash
edu brain link ~/Obsidian/MyVault
```

Creates `<vault>/Edu/<project>` pointing at the brain folder (a symlink; a junction on Windows). It never replaces anything that already exists. Graph view, backlinks and the generated `.base` dashboards work out of the box.

## Commands

| Command | What it does |
|---|---|
| `edu` | live view home (in a terminal); type a goal to start a solo run |
| `edu init [--global] [--name Edu] [--cli X]` | create a brain |
| `edu install` / `edu uninstall [--force]` | connect / disconnect coding CLIs |
| `edu doctor [--json]` | Node, CLIs, integrations, brains, Obsidian link |
| `edu run "<goal>" [--solo\|--crew] [--cli X] [--harness H0\|H1\|H2\|H3] [--yes]` | orchestrate a goal with H3 evidence support by default |
| `edu ui [--replay runs/<id>.jsonl] [--speed n]` / `edu demo` | live view, replays, demo |
| `edu brain status \| recall <q> \| remember <title> \| maintain \| import albert\|moragent <path> \| link <vault>` | work with the brain |
| `edu context [--query q] [--budget n]` | show the context pack |
| `edu metrics [--since 30d] [--by cli\|role\|level] [--json]` | summarize episode evidence (AVSR, M-HIR and verification/recovery quality) |
| `edu checks list\|add\|run` | manage and execute deterministic checks in `.edu/harness/checks.json` |
| `edu reflect [--since 7d]` · `edu proposals list\|accept\|reject` | self-improvement loop |
| `edu mcp` · `edu statusline` · `edu hook …` | integrations used by your CLIs |

Global flags: `--cwd <dir>`, `--lang en|es`, and `--json` where it makes sense.

## Uninstall

```bash
edu uninstall                 # project scope; --scope global for global installs
npm rm -g edu-agent
```

Uninstall restores every file from the manifest and refuses to clobber files you edited since install (`--force` to override). Your `.edu/` brain is never deleted — it is your data.

## FAQ

**Do I need several LLM subscriptions?** No. Everything works with one CLI.

**Does Edu send my code anywhere?** Edu itself makes no network calls. It runs the CLIs you already use, with their own settings.

**Can I edit the brain by hand?** Yes — it is Markdown. Canonical notes you accept are protected from automatic edits.

**What does `edu demo` need?** Nothing but Node. It replays a scripted crew.

**Where are runs stored?** `.edu/runs/<runId>.jsonl`; replay any of them with `edu ui --replay`.

## License

MIT © Eduardo Moraga
