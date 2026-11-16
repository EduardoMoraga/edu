# Edu — Architecture (6.0)

Edu is an installable, LLM-agnostic agent harness. One install gives every coding CLI it supports
(Claude Code, Codex, Pi, OpenCode and Antigravity) **an identity**, **a Markdown second brain that
learns**, **a context budget that respects the model**, **an orchestrator** that works with one LLM and
scales to a crew, and **live views** of agents, tokens, cost and approvals.

This document describes the code as it is. The tables marked *checked* are compared with the code by
tests (`src/test-support/architecture.test.ts`, `src/test-support/architecture-doc.test.ts`): when the
code changes, the test names what to update here.

## 1. Principles

1. **Files are the product.** The brain is plain Markdown with YAML frontmatter and `[[wikilinks]]`.
   Any LLM can read it, Obsidian can graph it, Git can version and sync it. There is no database; the
   caches under `.edu-local/` can be deleted at any time.
2. **One contract, many hosts.** `EDU.md` is the host-independent contract. Each host gets a thin plugin
   or managed block that points to it, and instructions stay small: bloated instructions make every
   model worse.
3. **Progressive disclosure.** A session starts with a compact brief (identity, active commitments, top
   lessons, index pointer). Everything else is pulled on demand through MCP (`edu_recall`, `edu_read`).
4. **Learning needs a loop, not a pile.** Notes carry usage and feedback; lessons rise, decay, get
   promoted or retired. Canonical truth changes only when a person accepts it.
5. **Never assert beyond the evidence.** Every new transitive note has a claim band (`verified`, `inferred`,
   `hypothesis`); recall shows it, and a hypothesis is never presented as a fact.
6. **Single LLM first.** Every feature works with one CLI. A crew of vendors (for example a cross-vendor
   review) is a bonus, never a requirement.
7. **Safe by default.** A person approves writes and raises autonomy; a crew worker can never approve;
   agent CLIs get an allowlisted environment; release downloads are verified.
8. **Reversible installs.** Every write to a host config is recorded; `edu uninstall` restores what Edu
   changed and keeps what the user changed after.
9. **Dependencies point down.** Contracts know nothing, the domain knows no delivery, and only the CLI
   imports the CLI. A test enforces it (section 3).

## 2. On-disk layout

```
~/.edu/                         global brain (personal preferences, cross-project lessons) and machine records
├── config.json                 EduConfig; crew.maxAutonomy and crew.env.passthrough are read only from here
├── projects.json               registered workspaces (src/brain/registry.ts)
├── manifest.json               install manifest of `edu install` (global scope)
├── plugin-setup.json           what `edu setup` registered natively in each host
└── …                           everything a project brain has (below)

<project>/.edu/                 project brain; overlays the global brain on recall
├── EDU.md                      the contract: identity, memory rules, protocol
├── config.json                 EduConfig (src/core/contracts.ts, validated in src/workspace/config.ts)
├── brain/                      the notes (`brainDir` in config.json can move them, e.g. into an Obsidian vault)
│   ├── 0-index/                generated: INDEX.md, catalog.md, log.md, localized Obsidian Bases
│   ├── 1-canonical/<kind>/     stable truth; proposed → accepted only by a person
│   ├── 2-episodic/             one note per session, immutable once closed
│   └── 3-transitive/           decisions, hypotheses, commitments and lessons (D-, H-, C-, L-) with lifecycles
├── skills/<name>/SKILL.md      reusable procedures
├── agents/<role>.md            role definitions
├── playbooks/<name>.md         orchestration methods (project first, then global, then bundled)
├── proposals/                  self-improvement proposals awaiting a person
├── specs/                      run specs a person approves before building
├── runs/                       <runId>.jsonl event streams, <runId>.status.json, <runId>/ episode packages
├── crew/                       <jobId>.json record, .jsonl events, .log, .decision for approval gates
├── harness/                    tools.json and checks.json: commands a person registered as trusted checks
├── reflect-queue/              structured evidence waiting for consolidation
├── state/                      maintain.json, consolidation.json, sync.json
├── backups/                    copies taken before Edu rewrites a file
└── .edu-local/                 machine-local, never synced: usage ledger, parsed-note cache, locks
```

## 3. Layers

Every top-level folder of `src/` is one module, and every module sits in one layer. A module may import
only the modules its row of the dependency table lists, all in its own or a lower layer, and the module
graph has no cycle.

| Layer | Holds |
|---|---|
| core | Contracts: the shared types and constants. Depends on nothing. |
| platform | Infrastructure helpers: processes, files, locks, the child environment, the package root. |
| domain | The model: notes and recall, context budgets, engines, evidence, skills, identity. |
| service | Use cases built on the domain: orchestration, crew, reflection, sync, workspaces, host setup. |
| delivery | How people and hosts reach Edu: the MCP server, the TUI and the CLI. |

`src/test-support/architecture.test.ts` builds the import graph of every non-test file under `src/`
(static, type-only, re-exported and dynamic imports) and fails when:

- an import is not allowed by the table below;
- two modules depend on each other, directly or through others;
- a module other than the CLI (and the package entry, which re-exports `createProgram`) imports `src/cli`;
- production code imports `src/test-support`;
- the table allows an import the code no longer has (so this document stays exact);
- a `src/` file that `scripts/build-plugins.ts` loads through Node's type stripping imports another `src/`
  file at run time (type stripping cannot resolve `.js` to `.ts`).

When a lower layer needs something only a higher one has, move the shared piece down or pass it in.

### Allowed dependencies (*checked*)

<!-- generated:dependencies -->
| Module | Layer | May import |
|---|---|---|
| core | core | — |
| platform | platform | core |
| identity | domain | core |
| skills | domain | core |
| engine | domain | core, platform |
| brain | domain | core, platform |
| context | domain | brain, core |
| evidence | domain | brain, core, platform |
| adapters | service | brain, core, platform, skills |
| detach | service | adapters, platform |
| doctor | service | adapters, core, detach, platform |
| release | service | platform |
| vault | service | brain, core, platform |
| update | service | brain, platform, release |
| reflect | service | adapters, brain, context, core, engine, platform, skills |
| workspace | service | adapters, brain, core, engine, platform |
| setup | service | adapters, brain, core, detach, platform, reflect, update, vault, workspace |
| orchestrator | service | brain, context, core, engine, evidence, platform, reflect, workspace |
| crew | service | brain, context, core, engine, orchestrator, platform, workspace |
| chat | service | brain, context, core, engine |
| eval | service | brain, context |
| bench | service | brain, core |
| experiment | service | platform, skills |
| connect | service | platform |
| mcp | delivery | brain, context, core, crew, platform, reflect, release, workspace |
| tui | delivery | core, crew, identity |
| cli | delivery | adapters, bench, brain, chat, connect, context, core, crew, detach, doctor, engine, eval, evidence, experiment, identity, mcp, orchestrator, platform, reflect, release, setup, tui, update, vault, workspace |
| index | delivery | cli, core |
<!-- /generated:dependencies -->

## 4. Module map (*checked*)

<!-- generated:modules -->
| Module | Layer | Purpose |
|---|---|---|
| `src/core/` | core | Contracts: notes, events, config, engines, approvals, crew settings |
| `src/platform/` | platform | Process launch and tree kill, child env, file locks, fs retries, package root, PATH lookup |
| `src/identity/` | domain | Banner, theme, glyphs, statusline text and display-width formatting |
| `src/skills/` | domain | Skill bundles: validation, limits and portable paths |
| `src/engine/` | domain | One adapter per agent CLI: argv, autonomy flags, JSONL to EduEvent |
| `src/brain/` | domain | The Markdown second brain: notes, recall, learning, lint, views, project registry |
| `src/context/` | domain | Token estimates, context packs and the session brief |
| `src/evidence/` | domain | Episode packages, check registry, attribution and metrics |
| `src/adapters/` | service | Per-host install plans: managed blocks, JSON/TOML merges, manifests, host files |
| `src/detach/` | service | Removes other tools from host configs, with backups and undo |
| `src/doctor/` | service | Health checks: CLI integration, native plugins, context weight |
| `src/release/` | service | Release capabilities of the running version |
| `src/vault/` | service | Obsidian vault link and Git sync with conflict copies |
| `src/update/` | service | Verified self-update and workspace migrations |
| `src/reflect/` | service | Self-improvement: reflection, consolidation, dreams, skill proposals, auto-maintain |
| `src/workspace/` | service | Workspaces: init, config, create, scaffold, ingest and readers |
| `src/setup/` | service | Native plugin setup, upgrade and uninstall for every host |
| `src/orchestrator/` | service | Plan, approve, build, verify, review and learn for one goal |
| `src/crew/` | service | Crew jobs: headless and pane workers, status, approvals, cancel |
| `src/chat/` | service | One chat turn with brain context |
| `src/eval/` | service | Evaluation suites across harness levels |
| `src/bench/` | service | Retrieval and activation benchmarks |
| `src/experiment/` | service | Isolated skill experiments in throwaway workspaces |
| `src/connect/` | service | Connects Edu to other agents (Hermes) |
| `src/mcp/` | delivery | The MCP server and its tools |
| `src/tui/` | delivery | Ink views: live run, watch and mission deck |
| `src/cli/` | delivery | The `edu` command and host hooks |
| `src/index.ts` | delivery | Package entry: the contracts and createProgram |
<!-- /generated:modules -->

`src/test-support/` holds test helpers (a captured CLI context, TUI event fixtures, a DOCX builder,
wall-clock budgets) and the architecture checks. Production code never imports it.

Single sources worth knowing:

| Concern | The one place |
|---|---|
| Frontmatter | `src/brain/frontmatter.ts` (`splitFrontmatter`, `parseFrontmatter`, `parseMarkdown`: BOM and CRLF safe). `src/skills/bundle.ts` keeps its own fence because type stripping loads it. |
| TOML in host configs | `src/adapters/toml.ts` (`scanTomlLines`): install, detach and doctor |
| Package root, version, templates | `src/platform/package.ts` |
| Child environment | `src/platform/child-env.ts` (`childEnv`) |
| Process tree kill | `src/platform/process-tree.ts` (`killTree`) |
| Crew job statuses | `src/crew/status.ts` |
| CLI ids | `CLI_IDS` in `src/core/contracts.ts` |

## 5. How the pieces work together

- **Session start.** A host hook (`edu hook session-start`, or Pi's extension) runs
  `context.brief()` on the nearest project brain over the global one and injects it. The same brief is
  `edu brief` and the `edu_brief` tool.
- **Memory.** Hosts call the MCP tools. Writes go through `brain` (exclusive create, note locks, redaction,
  claim bands); invalid notes are quarantined, reported by lint, doctor and the brief, never overwritten.
- **A run.** `edu run` and detached orchestrations go through `orchestrator/session.ts`: brief → plan
  (lead, read-only) → spec approval → build → deterministic checks → review (read-only, another vendor
  when available) → learn. Every step emits `EduEvent`s to `runs/<runId>.jsonl` and an episode package.
- **The crew.** `edu crew dispatch` and `edu_crew_dispatch` create a job under `crew/`. A headless job
  runs as a detached `edu crew worker`; a pane job runs visibly in a herdr pane. Jobs end as `done`,
  `failed` or `cancelled`; `awaiting-approval` waits for a decision.
- **Learning.** Session close and run end queue structured evidence; `reflect/auto-maintain.ts`
  consolidates it into candidate lessons and runs throttled maintenance. `edu reflect` and `edu dream`
  propose more, and a person accepts or rejects proposals.
- **Hosts.** `edu setup` installs the generated plugins (`scripts/build-plugins.ts` builds `plugins/`
  from `templates/`) through each host's own installer, and falls back to managed files.

## 6. MCP tools (*checked*)

`edu mcp` serves these tools over stdio, in this order. The `memory` profile serves only the memory
tools. **Access** follows each tool's annotations: a crew worker can call only `read-only` tools.

| Tool | Profiles | Access | What it does |
|---|---|---|---|
| `edu_brief` | full, memory | read-only | Session-start brief |
| `edu_recall` | full, memory | read-only | Search notes; shows only whole hits that fit the budget |
| `edu_read` | full, memory | read-only | Read a note by id, alias, prefix, filename or title, paged |
| `edu_remember` | full, memory | writes | Write an episodic or transitive note (transitive needs a claim band) |
| `edu_feedback` | full, memory | writes | Record whether a note helped (advisory) |
| `edu_propose_canonical` | full, memory | writes | Propose a canonical note; a person accepts it |
| `edu_commitments` | full, memory | read-only | List commitments |
| `edu_session_open` | full, memory | writes | Open a work session |
| `edu_session_close` | full, memory | writes | Close a session by its exact id with a summary |
| `edu_capabilities` | full, memory | read-only | Running version and features |
| `edu_projects` | full, memory | read-only | List registered workspaces and agent names |
| `edu_project_use` | full, memory | destructive | Switch this session's workspace; only registered workspaces or existing brains |
| `edu_crew_dispatch` | full | destructive | Run a crew job on a coding CLI, headless or in a herdr pane |
| `edu_crew_status` | full | read-only | List crew jobs or show one |
| `edu_crew_result` | full | read-only | Wait for and read a job result (`waitSeconds` up to 600) |
| `edu_crew_artifact` | full | read-only | Page a job's sanitized output or summary |
| `edu_crew_cancel` | full | destructive | Stop a job's process tree or pane and mark it cancelled |
| `edu_orchestrate` | full | destructive | Start a detached orchestration with a visible spec |
| `edu_crew_approve` | full | destructive | Decide the gate a job waits on; needs its `requestId`, recorded as `host-llm` |
| `edu_crew_review` | full | destructive | Read-only review by a different available CLI |

## 7. CLI commands (*checked*)

Top-level commands, grouped as `edu --help` shows them. `edu help <command>` shows each one's options.

| Command | What it does |
|---|---|
| **Get started** | |
| `edu setup` | Install Edu's plugins into your coding CLIs |
| `edu create` | Turn documents into an Obsidian-ready workspace with a named agent |
| `edu init` | Create a brain (`./.edu`, or `~/.edu` with `--global`) |
| `edu vault` | Create or check a safe Obsidian window onto registered brains |
| `edu sync` | Sync the shared brain with GitHub; conflicting notes keep both versions |
| `edu join` | Attach this machine or a cloud sandbox to the shared brain repository |
| `edu install` | Connect Edu to coding CLIs through managed files (reversible) |
| `edu uninstall` | Remove what `edu setup` and `edu install` added; the brain is kept |
| `edu update` | Update to the latest verified GitHub release |
| `edu doctor` | Check Node, coding CLIs, integrations, brains and the Obsidian link |
| `edu detach` | Reversibly remove competing instructions, hooks, MCP servers and plugins |
| `edu capabilities` | Describe this version, its limits and restart needs (alias `whats-new`) |
| **Work** | |
| `edu run` | Run a goal: plan, approve, build, verify, review, learn |
| `edu ui` | Open the live view, or replay a recorded run |
| `edu demo` | Watch a scripted crew in the live view (no LLM) |
| `edu deck` | Show the brain, the latest spec and crew jobs (`--json` feeds the Edu Deck) |
| `edu crew` | Dispatch, inspect, cancel, approve or reject crew jobs |
| `edu watch` | Watch crew jobs live |
| `edu experiment` | Run approved commands in disposable workspace copies |
| **Brain** | |
| `edu brief` | Print the session brief |
| `edu brain` | Inspect and grow the brain: status, recall, read, remember, lint, approve… |
| `edu context` | Show the context pack Edu would inject, with a token table |
| `edu reflect` | Learn from recent episodes: lessons, hypotheses, skill proposals |
| `edu dream` | Consolidate recent sessions into a reviewable plan; nothing changes until `--apply` |
| `edu proposals` | Review self-improvement proposals |
| `edu metrics` | Summarize evidence from recent episode packages |
| `edu checks` | Manage the deterministic checks in `.edu/harness/checks.json` |
| `edu eval` | Evaluate memory without model calls |
| `edu bench` | Measure retrieval quality, context cost and activation |
| **Integrations** | |
| `edu mcp` | Serve the brain over MCP (stdio) |
| `edu connect` | Connect Edu to an agent gateway (Hermes) |
| `edu statusline` | One status line for Claude Code |
| `edu hook` | Lifecycle hooks the coding CLIs call; they never fail the host |

## 8. Safety model

**Approvals.** Every crew approval gate (including a detached run's spec) gets a fresh random `requestId`. A
decision applies only when it names the open gate's `requestId` and was written after the gate opened;
stale, forged, early and pre-6.0 decision files are discarded. `edu crew approve|reject` take
`--request <id>` and `--via cli|deck`; `edu_crew_approve` requires `requestId`. Every decision records
who made it (`cli`, `deck` or `host-llm`); a `host-llm` approval never counts as a person's
intervention. Canonical notes change only through `edu brain approve`, which needs a TTY or `--yes`.

**Autonomy ceiling.** Roles and crew jobs run at `readonly`, `ask`, `auto` or `full`, mapped to each
CLI's own permission flags (`src/engine/autonomy.ts`). `crew.maxAutonomy` (default `auto`) is read only
from the global `~/.edu/config.json`: a project config sits where agents and cloned repositories can
write, so it can never raise it. Roles above the ceiling run at the ceiling (and the run says so); MCP
dispatch above it is refused. Planners and reviewers must run read-only on a CLI that can enforce it.
Checks the planner invents run only after a person approves a spec that lists the exact commands, or
with `--allow-unregistered-checks`.

**Child environment.** Agent CLIs start with `childEnv(cli)`: PATH, HOME/USERPROFILE, locale, TERM,
proxy and temp variables, plus that CLI's own auth variables. Anything else (for example `GITHUB_TOKEN`
or `SSH_AUTH_SOCK`) must be listed in `crew.env.passthrough` in the global config. On Windows, npm
shims are resolved and started without `cmd.exe` where possible (`src/platform/index.ts`). A cancelled
or timed-out job's whole process tree is killed (`killTree`).

**Worker mode.** A crew worker runs with `EDU_CREW_JOB` set (Codex forwards it to Edu's MCP server).
In worker mode the MCP server serves only the `read-only` tools of section 6, and the crew store, the
CLI and decision files refuse any approval: a worker can read and recall, but never write notes,
approve, dispatch, cancel or switch workspaces.

**Installs and updates.** Host configs are merged only in Edu's own keys, blocks and TOML sections;
user values are never overwritten, and uninstall keeps edits made after install. `edu update` and the
installers accept only `https://github.com/EduardoMoraga/edu/releases/download/<tag>/` and verify the
package against the release's `SHA256SUMS` before installing it.
