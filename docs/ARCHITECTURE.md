# Edu — Architecture & v0.1 Spec

> Edu is an installable, LLM-agnostic agentic harness. One install gives any coding
> CLI (Claude Code, Codex, Pi, OpenCode, Antigravity) **an identity**, **a second
> brain that learns**, **a context budget that respects the model**, **an
> orchestrator** that works with a single LLM and scales to a crew, and **a live
> terminal view** of agents, tokens, cost and approvals.

## 1. Principles

1. **Files are the product.** The brain is plain Markdown + YAML frontmatter + `[[wikilinks]]`.
   Any LLM can read it; Obsidian can graph it; git can version it. No database.
2. **One contract, many adapters.** `EDU.md` is the engine-independent contract. Each CLI gets a
   *thin* managed block that points to it. Instructions stay small (< 1.5k tokens) — bloated
   instructions make every model worse.
3. **Progressive disclosure.** Sessions start with a compact brief (identity + index + top
   lessons). Everything else is pulled on demand through MCP (`edu_recall`, `edu_read`).
4. **Learning needs a loop, not a pile.** Memories carry usage stats and feedback; they rise,
   decay, get promoted or retired. Canonical truth changes only with human confirmation.
5. **Never assert beyond the evidence.** Every note has a claim band (`verified | inferred |
   hypothesis`); recall shows it; hypotheses are never presented as facts.
6. **Single LLM first.** Every feature works with one CLI. A crew of vendors is a bonus
   (e.g. cross-vendor review), never a requirement.
7. **Reversible installs.** Every write is recorded in a manifest; `edu uninstall` restores it.

## 2. On-disk layout

```
~/.edu/                       global brain (personal: preferences, cross-project lessons)
<project>/.edu/               project brain (overlays global on recall)
├── EDU.md                    the contract: identity, memory rules, protocol (engine-independent)
├── config.json               EduConfig (src/core/contracts.ts)
├── brain/
│   ├── 0-index/              generated: INDEX.md, *.base Obsidian dashboards
│   ├── 1-canonical/<kind>/   stable truth; status proposed → accepted (human-confirmed)
│   ├── 2-episodic/           one note per session: YYYY-MM-DD_HHMM_<slug>.md, immutable once closed
│   └── 3-transitive/         D-/H-/C-/L- items with lifecycles (see contracts.ts)
├── skills/<name>/SKILL.md    reusable procedures
├── agents/<role>.md          role definitions (frontmatter = RoleSpec)
├── proposals/                self-improvement diffs awaiting approval
├── runs/<runId>.jsonl        EduEvent streams (replayable in the TUI)
└── manifest.json             InstallManifest (only in the scope that was installed)
```

## 3. Modules and ownership

| Module | Path | Owner (crew role) | May import |
|---|---|---|---|
| Contracts | `src/core/` | lead | — |
| Brain | `src/brain/` | backend (Codex) | core |
| Context | `src/context/` | backend (Codex) | core, brain |
| Engines | `src/engine/` | backend (Codex) | core |
| Orchestrator | `src/orchestrator/` | backend (Codex) | core, brain, context, engine |
| Reflect (self-improve) | `src/reflect/` | backend (Codex) | core, brain, engine |
| MCP server | `src/mcp/` | backend (Codex) | core, brain, context |
| CLI integrations | `src/adapters/` | backend (Codex) | core |
| Identity | `src/identity/`, `templates/` | frontend (Claude) | core |
| TUI | `src/tui/` | frontend (Claude) | core, identity (+ orchestrator via props only) |
| CLI commands | `src/cli/` | frontend (Claude) | everything |
| Tooling/CI/packaging | `.github/`, `scripts/`, `package.json` | dev (Pi) | — |
| Audit | read-only | helper (Antigravity) + dev (Pi) | — |

Rules for every worker: stay inside your paths; do not edit `src/core/contracts.ts` (ask the lead);
do not commit (the lead integrates and commits); add tests next to code (`*.test.ts`); keep
dependencies to the ones already in `package.json` unless you justify a new one in your summary.

## 4. Brain (`src/brain/`)

Public API (exported from `src/brain/index.ts`):

```ts
openBrain(locations: BrainLocation[]): Brain        // project first, then global
interface Brain {
  init(loc: BrainLocation, opts?: { identityName?: string }): Promise<void>  // creates layout + EDU.md from templates
  list(filter?: Partial<Pick<NoteMeta,'tier'|'kind'|'status'>>): Promise<Note[]>
  read(id: string): Promise<Note | undefined>
  write(input: NewNote): Promise<Note>              // assigns id/prefix/path, validates lifecycle
  update(id: string, patch: Partial<NoteMeta>, body?: string): Promise<Note>
  recall(query: string, opts?: { limit?: number; tiers?: Tier[] }): Promise<RecallHit[]>  // BM25 × learned weight; records usage
  feedback(id: string, helpful: boolean): Promise<Note>
  openSession(title: string, source: string): Promise<Note>   // episodic, status open-session
  closeSession(id: string, summary: string): Promise<Note>    // becomes immutable
  proposeCanonical(input: NewNote): Promise<Note>             // status proposed
  acceptCanonical(id: string): Promise<Note>                  // human-confirmed only
  maintain(now?: Date): Promise<MaintenanceReport>            // decay, overdue commitments, retire stale lessons, rebuild index
  rebuildIndex(): Promise<void>                               // 0-index/INDEX.md + Obsidian .base files
  stats(): Promise<BrainStats>
}
```

- Frontmatter via the `yaml` package (no hand-rolled parser). Writes are atomic (temp file + rename).
- **Learned weight** for ranking: `w = (wins + 1) / (wins + losses + 2)` (Laplace) × recency decay
  `0.5 ^ (daysSinceLastUse / halfLifeDays)` (half-life 45 days, floor 0.25). Final score =
  `bm25 × (0.5 + w)`. `why` explains both factors.
- Lessons lifecycle: `candidate` → `proven` when `wins ≥ 3` and `w ≥ 0.7`; → `retired` when
  `losses ≥ 3` and `w < 0.35`, or unused for 180 days. Proven lessons become
  **canonical proposals** (never auto-accepted).
- Commitments past `due` become `overdue` in `maintain()`.
- Decisions are never edited away: reverting means a new D- with `supersedes`.
- Importers (`src/brain/import/`): `albert` (`_ALBERT/{1-CANONICO,2-EPISODICO,3-TRANSITIVO}` with
  D-/H-/C-/A- prefixes; A- maps to L-) and `moragent` (`.moragent/memory/{canonical,episodic,transient}`).
  Importers never modify the source.

## 5. Context budget (`src/context/`)

- `estimateTokens(text)` — fast heuristic (≈ chars / 3.7, with CJK/code adjustments), unit-tested
  against known samples; one function so it can be swapped for a real tokenizer.
- `buildContext(brain, req: ContextRequest): Promise<ContextPack>` fills sections in priority order
  until the budget is reached:
  1. **Identity core** — the short top section of `EDU.md`.
  2. **Active commitments & open hypotheses** (title + due/band, one line each).
  3. **Proven lessons** relevant to the query, then top-weighted candidates.
  4. **Canonical hits** for the query (summarized to first paragraph when large).
  5. **Last 3 episodes** as one-liners.
  6. **Index pointer** — "N more notes available via edu_recall/edu_read".
  Anything that matched but did not fit goes to `deferred`.
- `brief(brain, budgetTokens = 1500)` — the session-start brief used by hooks and MCP.

## 6. Engines (`src/engine/`)

One adapter per CLI implementing `Engine`. A single table maps autonomy → flags (no duplication).
Known-good headless commands:

| CLI | Command |
|---|---|
| claude | `claude -p <prompt> --output-format stream-json --verbose [--append-system-prompt S] [--model M] [--resume ID] --permission-mode <acceptEdits|plan|bypassPermissions>` |
| codex | `codex exec --json -s <read-only|workspace-write|danger-full-access> --skip-git-repo-check [--model M] [resume ID] <prompt>` (system prompt prepended) |
| pi | `pi -p --mode json [--append-system-prompt S] [--model M] [--session ID] <prompt>` |
| opencode | `opencode run --format json --dir R [--model M] [--session ID] <prompt>` |
| agy | `agy -p <prompt> --output-format stream-json [--model M] [--conversation ID] [--dangerously-skip-permissions]` |

- Spawn with process groups; cancel kills the group; UTF-8-safe line splitting; cap line size.
- Map native JSONL → `EduEvent` (text, thinking, tool.call/result, usage incl. cost when reported, end with sessionId).
- `FakeEngine` for tests and TUI demos: replays a scripted event list with timings.
- Fixtures of real JSONL lines per CLI under `src/engine/fixtures/` drive parser tests.

## 7. Orchestrator (`src/orchestrator/`)

`orchestrate(goal, { config, brain, engines, onEvent, approve }): Promise<RunResult>`

1. **Brief** — build context pack for the goal.
2. **Plan** (lead role) — lead produces a JSON plan: steps with role, task, dependsOn, parallel-safe flag.
3. **Approval gate** — per `approvals` policy (`ask-on-write`: steps whose role autonomy can write).
4. **Execute** — run steps respecting dependencies; independent read-only steps run in parallel.
   *solo* mode: every role uses `defaultCli`, each as its own session. *crew* mode: role → cli;
   reviewer picks a vendor different from the builder when available.
5. **Review** — reviewer verdict (`pass | fix`); at most one fix round.
6. **Learn** — close the episodic session with a summary; queue reflection.
All of it emits `EduEvent`s and persists them to `runs/<runId>.jsonl`.

## 8. Reflect — self-improvement (`src/reflect/`)

`edu reflect [--since 7d]` — uses the configured engine (read-only) to read recent episodes and runs
and propose:
- new **L-** lessons (candidate) and **H-** hypotheses with evidence links,
- updates to existing lessons (feedback inferred from outcomes),
- **skill diffs** and new skills from repeated procedures → written to `proposals/` (never applied
  without `edu proposals accept <id>`),
- canonical proposals from proven lessons.
Output is strictly JSON-schema validated (zod); malformed output is rejected, not guessed.

## 9. MCP server (`src/mcp/`) — `edu mcp`

Stdio server exposing: `edu_brief`, `edu_recall`, `edu_read`, `edu_remember` (episodic/transitive),
`edu_feedback`, `edu_propose_canonical`, `edu_commitments`, `edu_session_open`, `edu_session_close`.
Every tool response is compact and token-aware (respects a `maxTokens` arg).

## 10. CLI integrations (`src/adapters/`) — `edu install`

`edu install [--cli claude,codex,pi,opencode,agy|all] [--scope project|global] [--dry-run]`

| CLI | Instructions | Skills | Agents | MCP | Identity extras |
|---|---|---|---|---|---|
| claude | managed block in `CLAUDE.md` → `@.edu/EDU.md` | `.claude/skills/` | `.claude/agents/*.md` | `.mcp.json` / `~/.claude.json` | output style `edu`, statusline `edu statusline`, SessionStart/SessionEnd hooks |
| codex | managed block in `AGENTS.md` | `.agents/skills/` | — | `~/.codex/config.toml [mcp_servers.edu]` | `notify` hook |
| pi | managed block in `AGENTS.md` | `.agents/skills/` | — | `~/.pi/agent/mcp.json` | — |
| opencode | managed block in `AGENTS.md` | `.agents/skills/` | `opencode.json agent` | `opencode.json mcp` | — |
| agy | managed block in `GEMINI.md` + `AGENTS.md` | `.agents/skills/` | — | per vendor docs (verify) | — |

Managed blocks: `<!-- edu:core:start -->…<!-- edu:core:end -->` — idempotent upsert, user text
outside the block untouched. JSON/TOML merges touch only Edu keys. Everything recorded in the
manifest; `edu uninstall` reverses it and refuses to clobber user-modified files without `--force`.

## 11. Identity (`src/identity/`, `templates/`)

- `templates/EDU.md` — the contract (who Edu is, the three layers, claim bands, protocol:
  brief → work → remember → close). Name is configurable (`--name`), default **Edu**.
- Voice: direct, warm, evidence-first; persona applies to chat only, never to code/commits.
- Visual identity: wordmark banner (ASCII, fits 60 cols), palette tokens (truecolor with 256/16
  fallbacks and `NO_COLOR`), role icons, status glyphs.
- `edu statusline` — one line for Claude Code's statusline: `◆ EDU · brain 243 · 3 lessons · ctx 41%`.

## 12. TUI (`src/tui/`) — `edu` / `edu ui`

Ink app. Layout (≥ 100 cols; degrades to a single column under 80):

```
┌ ◆ EDU ─ goal: "add oauth" ─ solo · claude ─────────────── $0.42 · 38.1k tok ┐
│ AGENTS                     │ ⚙ builder · running · 2m14s                      │
│ ◆ lead        ✓ 0:41       │ › tool Edit src/auth.ts                          │
│ ├ 🔍 explorer ✓ 1:02       │   ✓ 12 lines                                     │
│ ├ ⚙ builder   ● 2:14       │ I added the callback route and …                │
│ └ ⚖ reviewer  ○ queued     │                                                  │
├────────────────────────────┴──────────────────────────────────────────────────┤
│ ⏸ APPROVAL  builder wants to write 3 files   [y] approve  [n] reject  [d] diff │
├───────────────────────────────────────────────────────────────────────────────┤
│ 🧠 recalled 4 · learned 1 lesson · ctx 41% of 8k        › composer…            │
└───────────────────────────────────────────────────────────────────────────────┘
```

- Agent tree with role icons, live status glyphs (○ queued · ● running · ⏸ awaiting · ✓ done · ✗ failed),
  elapsed time, per-agent tokens/cost.
- Focus pane streams the selected agent (text, thinking dimmed, tool calls collapsed).
- Approval card with keyboard actions. Brain strip shows recalls and new learnings live.
- `edu ui --replay runs/<id>.jsonl` renders any past run; `edu demo` runs a FakeEngine script.
- Keyboard: ↑/↓ select agent, tab cycle panes, `?` help, `q` quit, `ctrl+c` cancel run.

## 13. CLI commands (`src/cli/`)

`edu` (TUI) · `edu init [--global] [--name Edu]` · `edu install` · `edu uninstall` · `edu doctor` ·
`edu run "<goal>" [--solo|--crew] [--cli X]` · `edu ui [--replay f]` · `edu demo` ·
`edu brain status|recall <q>|remember|link <vault>|import albert|moragent <path>|maintain` ·
`edu context [--query q] [--budget n]` · `edu reflect` · `edu proposals list|accept|reject` ·
`edu mcp` · `edu statusline`.

## 14. v0.1 acceptance

- `npm i -g github:EduardoMoraga/edu` on a clean HOME gives a working `edu`.
- `edu init && edu install --cli claude --dry-run` prints a correct plan; real install + uninstall
  round-trips to byte-identical files.
- `edu brain import albert <path>` imports the Albert vault read-only with correct tiers.
- `edu demo` shows the full TUI (agents, tokens, approval, brain strip) without any LLM.
- `edu run` completes a small goal in solo mode with at least one real CLI.
- `edu mcp` answers `edu_brief` and `edu_recall` from Claude Code.
- `npm run check` green on CI (macOS + Linux, Node 22).

## 15. Evidence layer — grounded in *AI Harness Engineering* (Zhong & Zhu, arXiv:2605.13357, 2026)

The paper's thesis: capability is a property of the **model–harness–environment system**, and a
harness is judged by whether it produces a **verifiable, attributed, maintainable** change — not a
patch plus an assertion. Edu adopts its vocabulary and makes it executable.

### 15.1 Coverage of the eleven harness responsibilities

| Responsibility | Edu component | Evidence artifact (episode package) |
|---|---|---|
| Task interface | plan with `requirements[]` + success criteria | `task.json` |
| Context manager | `src/context` budgeted pack | **context trace**: notes consulted, contribution, influenced? |
| Tool registry | `.edu/harness/tools.json` + test-command registry | **tool trace**: cmd, exit, duration, timeout, recovered |
| Project memory | brain (canonical/episodic/transitive) | memory references |
| Task state | `task-state.md` per run (hypotheses, inspected files, open questions, next steps) | task-state file |
| Observability | `EduEvent` stream, `runs/*.jsonl` | **action trace** |
| Failure attribution | reproduce → attribute step | **attribution log**: observed, expected, `F_*` type, evidence, alternatives |
| Verification protocol | deterministic check registry `.edu/harness/checks.json` | **verification trace** + verification report |
| Permission boundary | autonomy + approvals | permission record (approval events) |
| Entropy auditor | post-run diff audit (residue, stale docs, dep churn, weakened tests) | **entropy audit** (0–3 severity) |
| Intervention logger | every human approval/reject/correction/composer message mid-run | **intervention log** (avoidable?, harness gap) |

Failure taxonomy: `context | tool | feedback | verify | recovery | entropy | model | unknown`.
Outcome taxonomy (per episode): `autonomous_verified_success | assisted_verified_success |
unverified_success | failed | unsafe_invalid`.

### 15.2 H3 workflow in the orchestrator

For builder steps that fix behavior: **reproduce → attribute → fix → verify → report**, with a
back-edge to attribute when verification disproves the diagnosis. Deterministic checks (command +
expected substring/exit code, bound to requirement ids) run in Edu itself — not trusted to the model.

### 15.3 Harness ladder as a product feature

`edu run --harness H0|H1|H2|H3` (default H3) exposes runtime support per the paper's visibility
matrix. `edu eval <suite>` runs the same task across levels (and across CLIs) and reports the
contribution of each support class. Edu can therefore **measure itself**.

### 15.4 Metrics → self-improvement

`edu metrics` computes over episode packages: **AVSR** (autonomous verified success rate),
**M-HIR** (missing-harness human intervention rate), verification autonomy, tool recovery rate,
attribution completeness, entropy delta — per CLI, per role, over time.
The brain closes the loop: every *avoidable* intervention becomes a candidate lesson tagged with
its harness gap (e.g. human named the file → `context` gap → lesson/known-failure note); reflection
prioritizes gaps with the highest M-HIR contribution. "Self-improving" is then a falsifiable claim:
M-HIR down and AVSR up across releases.

## 16. Plugin-first (v0.2)

Edu's primary surface is **inside the CLI the user already uses**. The standalone TUI becomes an
optional mission-control viewer (`edu watch`). Formats below were verified against the installed CLIs
and their official docs (Claude Code 2.1, Codex 0.160, Pi 0.99, OpenCode 2.0, Antigravity 1.3).

### 16.1 One source, generated plugins

`templates/` stays the single source (EDU.md, skills, agents, commands). `scripts/build-plugins.ts`
generates every native package into `plugins/` (checked in, because marketplaces install from git;
CI fails if `plugins/` is stale):

```
.claude-plugin/marketplace.json      → plugins/claude-code   (Claude Code marketplace)
.agents/plugins/marketplace.json     → plugins/codex         (Codex marketplace)
plugins/
  claude-code/ .claude-plugin/plugin.json · skills/ · agents/ · hooks/hooks.json · .mcp.json (bare map) · output-styles/edu.md
  codex/       .codex-plugin/plugin.json · skills/ · .mcp.json ({"mcpServers":…}) · hooks/hooks.json
  pi/          extensions/edu.ts (registerMcpServer + before_agent_start identity) · prompts/ · skills/
  opencode/    commands/*.md · agents/*.md · plugins/edu.ts
  agy/         plugin.json · mcp_config.json · skills/ · agents/ · rules/edu.md
```
Root `package.json` declares `"pi": {extensions, prompts, skills}` → `plugins/pi/*` and keyword
`pi-package`, so `pi install git:github.com/EduardoMoraga/edu` works.

### 16.2 Same capabilities everywhere

Workflows ship as **skills** (portable; Codex deprecates custom prompts), plus slash commands where
the CLI supports them:

| Workflow | Claude | Pi | OpenCode | Codex / agy |
|---|---|---|---|---|
| brief, recall, remember, reflect, crew, review, status | `/edu:<name>` | `/edu-<name>` | `/edu-<name>` | skill `edu-<name>` |

Identity (EDU.md core) per CLI: Claude/Codex SessionStart hook → `edu hook session-start`;
Pi `before_agent_start`; agy `rules/edu.md`; OpenCode managed block in `~/.config/opencode/AGENTS.md`.

### 16.3 `edu setup` — one command

Detects CLIs and installs **globally** using each CLI's native installer, pointing at the installed
package root (so plugin version == binary version):
claude `plugin marketplace add <pkg>` + `plugin install edu@edu` · codex `plugin marketplace add <pkg>`
+ `plugin add edu@edu` · pi `install <pkg>` · agy `plugin install <pkg>/plugins/agy` · opencode
managed copy of commands/agents/plugin + `mcp.edu`. Falls back to v0.1 managed-file adapters when a
native command is unavailable. Creates the global brain. Records everything for `edu uninstall`.
Bare `edu` on first run runs setup, then prints what to do inside each CLI.

### 16.4 Crew from inside any CLI (MCP)

| Tool | Behavior |
|---|---|
| `edu_crew_dispatch {cli, task, mode: headless|pane, cwd?, autonomy?}` | Starts a job. `headless`: detached `edu crew worker <jobId>` runs the engine and appends EduEvents to `.edu/crew/<jobId>.jsonl`. `pane` (herdr present): `herdr pane split` + `herdr agent start --kind <cli>` + `herdr agent prompt`, visible to the user. Returns `jobId` immediately. |
| `edu_crew_status {jobId?}` | Jobs with cli, status, elapsed, tokens/cost. |
| `edu_crew_result {jobId, waitSeconds?}` | Final summary (and last text) when done; waits up to `waitSeconds`. |
| `edu_crew_review {cli?, base?}` | Dispatches a read-only reviewer on `git diff <base>` to a vendor different from the caller when available; returns findings. |

`edu watch` renders `.edu/crew/*.jsonl` live (the v0.1 TUI, fixed: wrapped text, multi-line composer,
`/` options palette, locale-aware Spanish).
