# Changelog

All notable changes to Edu (`edu-agent`) are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Entries before 6.0 are short summaries of the release
commits and of each version's README.

## [6.0.0] - Unreleased

Upgrading from 5.x? Read [Upgrade to Edu 6.0](docs/guides/upgrade-6.0.md) first.

### Highlights

- **Edu Deck for Claude Code.** A side pane with a live tree of the session's agents and a control
  for each, plus Edu's brain, crew jobs and this session's note. Crew runs waiting for approval get
  Approve and Reject buttons pinned to the gate you saw. [Guide](docs/guides/claude-code-deck.md)
- **Safer by default.** Verified updates, approvals bound to one gate, an autonomy ceiling for MCP
  callers, an allowlisted environment for agent CLIs, and planner-proposed checks that need a
  person.
- **Memory you can trust.** Creating a note never overwrites one, broken notes are quarantined
  instead of breaking recall, every transitive note states its claim band, and search covers every
  script.
- **Sync keeps both sides.** A real conflict publishes your version beside upstream's instead of
  hiding it on a branch, and `edu sync --install --replace-legacy` retires a hand-made scheduler.
- **Reliable crews.** Per-job timeouts, `edu crew cancel`, liveness checks, whole-process-tree
  kills on every platform, and CLI failures reported as failures.

### Breaking changes

Each item links to its migration step in the [upgrade guide](docs/guides/upgrade-6.0.md).

- **Updates and installs are verified.** `edu update`, `install.sh` and `install.ps1` install only
  packages that match the release's `SHA256SUMS`, downloaded from
  `https://github.com/EduardoMoraga/edu/releases/download/<tag>/`. Releases older than 6.0 have no
  `SHA256SUMS`. *Migration:* add `--allow-unverified` (installers: `EDU_ALLOW_UNVERIFIED=1`) to
  install one. [Details](docs/guides/upgrade-6.0.md#verified-updates)
- **Claim bands are required.** MCP `edu_remember` rejects a transitive note without `band`.
  *Migration:* pass `verified`, `inferred` or `hypothesis`; `edu brain remember` defaults to
  `hypothesis`. [Details](docs/guides/upgrade-6.0.md#claim-bands-are-required)
- **Approvals name their gate.** MCP `edu_crew_approve` requires `requestId`; `edu_orchestrate` no
  longer accepts `autoApprove`; decision files from before 6.0 are ignored. *Migration:* read the
  `requestId` from `edu_orchestrate` or `edu_crew_status`; decide pending 5.x approvals before
  upgrading. [Details](docs/guides/upgrade-6.0.md#approvals-name-their-gate)
- **MCP `autonomy: "full"` is refused** until a person raises `crew.maxAutonomy` (default `auto`)
  in the global config. *Migration:* set it in `~/.edu/config.json`, or dispatch from a terminal.
  [Details](docs/guides/upgrade-6.0.md#crew-settings-live-in-the-global-config)
- **Agent CLIs get an allowlisted environment.** Variables such as `GITHUB_TOKEN` or
  `SSH_AUTH_SOCK` no longer reach them. *Migration:* list them in `crew.env.passthrough` in the
  global config. [Details](docs/guides/upgrade-6.0.md#what-agent-clis-receive)
- **Unregistered checks need a person.** `edu run --yes` no longer runs checks the planner proposed
  that are not in `.edu/harness/checks.json`. *Migration:* register them with `edu checks add`, or
  pass `--allow-unregistered-checks`.
  [Details](docs/guides/upgrade-6.0.md#unregistered-checks-need-a-person)
- **MCP never creates a brain.** `edu_project_use` and MCP roots accept only registered workspaces
  and folders that already have `.edu/`. *Migration:* run `edu init` in the folder first.
  [Details](docs/guides/upgrade-6.0.md#mcp-never-creates-a-brain)
- **Headless `ask` no longer writes on Codex and Pi**, and read-only dispatch to OpenCode or agy is
  refused. *Migration:* use `--autonomy auto` for jobs that must edit files; use claude, codex or
  pi for read-only work. [Details](docs/guides/upgrade-6.0.md#autonomy-means-the-same-on-every-cli)
- **Headless crew jobs time out after 60 minutes.** *Migration:* pass `--timeout <minutes>` or set
  `crew.timeoutMinutes` (1 to 1440). [Details](docs/guides/upgrade-6.0.md#crew-jobs-time-out)
- **`npm test` runs only the unit and contract tests.** *Migration (contributors):* run
  `npm run test:perf` or `npm run test:all` for the wall-clock budgets.
  [Details](docs/guides/upgrade-6.0.md#test-scripts-for-contributors)

### Added

- Edu Deck for Claude Code, rebuilt on [Agent Tree](https://github.com/MikeGT4/agent-tree)'s live
  agent tree, with Tree, Edu, Reports, Files, Log, Usage and Help tabs.
- `edu deck --json --session <id>` reports the Edu note a host session opened.
- `edu crew cancel <id>` stops the job's whole process tree (or closes its pane) and marks it
  `cancelled`. MCP: `edu_crew_cancel`.
- `edu crew dispatch --timeout <minutes>` and `crew.timeoutMinutes` (default 60). MCP:
  `timeoutMinutes` on `edu_crew_dispatch`.
- `edu crew approve|reject --request <id> --via cli|deck`.
- `crew.maxAutonomy` and `crew.env.passthrough` in the global config.
- `edu run --allow-unregistered-checks`.
- `edu brain approve --yes` for scripts.
- `edu update --allow-unverified`; `--json` reports `verified`.
- `edu sync --install --replace-legacy [--yes]`; `edu sync --status` lists conflict copies
  (JSON `conflictCopies`) and legacy sync agents.
- `edu help <command>`. Setup, crew and watch commands are grouped in `edu --help`.
- `edu doctor` uses the installer's drift check, names drifted files, checks that `edu` is on
  `PATH`, and finds untracked plugin registrations, a moved or missing package root and corrupt
  records (JSON `problems`).
- `edu install --json` lists the values it kept under `notes`.
- A machine-local parse cache (`.edu-local/notes-cache.json`) for faster cold starts.
- npm scripts `test:perf`, `test:all`, `test:coverage` and `test:deck`, and a coverage ratchet.
- A release workflow that publishes `edu-agent-<version>.tgz`, `edu-agent.tgz` and `SHA256SUMS`
  with build provenance.

### Changed

- Every approval gate has a fresh `requestId`, and each decision records who made it: `cli`,
  `deck` or `host-llm`. A `host-llm` approval does not count as human intervention.
- The lead planner, the reviewer and `review()` run only on a CLI that enforces read-only (claude,
  codex or pi), or stop with a message.
- Pi read-only uses `--tools read,grep,find,ls`. Pi reads its prompt from stdin; OpenCode and herdr
  get `--` before the prompt. Codex, agy and OpenCode put system instructions first and label the
  task.
- In pane mode (herdr), autonomy passes as each CLI's own flags, and a prompt is sent exactly once.
- `edu brain remember` without `--band` writes `hypothesis` and says so; old notes without a band
  show as `unbanded`.
- `edu_recall` shows only whole hits that fit the budget, says how many it left out, and records
  use only for the hits it showed.
- Feedback is deduplicated per session, note and verdict; advisory feedback can lower a lesson's
  rank but never retires a proven lesson.
- Search indexes every script (`\p{L}\p{N}`, with bigrams for CJK). Slugs are ASCII and at most 80
  characters, with a short hash when letters were dropped. Token estimates err high.
- `edu uninstall` keeps edits made after install (for example a Claude Code login, permissions, MCP
  servers or Codex trust entries) and removes only Edu's part. It runs as one transaction with
  rollback.
- Drift compares only Edu's own block or keys, so lines outside it, or Codex rewriting
  `config.toml`, are no longer drift.
- Setup never overwrites a `statusLine`, agent or `mcpServers.edu` you set yourself; it says "Kept
  your own …".
- JSON configs keep their indentation and line endings; CRLF files get CRLF blocks. Every parse
  error names the file.
- `CODEX_HOME` and `PI_CODING_AGENT_DIR` are honoured.
- The Pi and OpenCode decks back off while `edu deck --json` fails (pause doubling up to one
  minute); the Claude Code deck waits up to five minutes.
- The package ships without source maps (1.16 MB to 0.50 MB packed). `bench`, `eval` and
  `experiment` load lazily, so `edu --version` no longer loads the MCP SDK.
- Check output is capped at the first 4 K and last 12 K characters per stream.
- `edu watch` shows `awaiting-approval` jobs, and a job's final status wins over its stream.
- CI: read-only token by default, pinned actions, Dependabot, job timeouts, Node 24 and 26 on
  Ubuntu.

### Fixed

- Creating a note no longer overwrites an existing file, including accepted canonical notes: a
  taken path gets `-2`, `-3`.
- One note with invalid frontmatter no longer breaks recall: it is quarantined and reported by
  `edu brain lint` (kind `unreadable`) and the brief. Numeric titles, ids and tags are read as text.
- Maintenance re-reads notes under the lock, so it no longer reverts concurrent edits.
  `rejectCanonical` takes the lock. A never-used note ages from its creation date.
- Control and bidi characters are stripped from titles and NUL bytes from bodies.
- A forged `session` in `edu_remember` is ignored.
- Sync: a real conflict no longer hides local work behind a branch; the local version is published
  beside upstream's as `<name>.conflict-<host>-<sha>.md`. Add/add conflicts are handled the same
  way; counter-only conflicts merge by maximum and newest date.
- Claude `is_error`, Codex `error.message`, OpenCode errors, empty output and exit 0 without a
  final result now count as failures, quoting what the CLI printed. Chat fails a turn that never
  ended.
- A crew worker that died no longer stays `running`; `--resume` accepts a run whose owner process
  is dead. Job updates take a lock, and a finished status never changes.
- Closing the terminal no longer orphans agents: Edu kills their process trees on SIGINT, SIGTERM,
  SIGHUP and exit (`taskkill /t /f` on Windows).
- Codex error messages are kept and OpenCode reasoning tokens are counted.
- Windows: file operations retry on EBUSY/EPERM; concurrent installs wait on
  `~/.edu-install.lock` (up to 120 s); `\\?\UNC\` paths compare correctly.
- Setup works when HOME or a config path goes through a symlink.
- A failed native plugin setup undoes its partial registration; registrations are recorded before
  they run.
- `edu uninstall --purge-brain` removes an empty brain folder instead of failing, and uninstall
  leaves no empty `~/.edu`.
- `scripts/smoke-install.sh` no longer waits on a terminal prompt.

### Security

- Release integrity: updaters accept only `https://github.com/EduardoMoraga/edu/releases/download/<tag>/`,
  verify `SHA256SUMS`, and install the verified local file. A 6.0+ release without `SHA256SUMS` is
  refused.
- Crew workers (`EDU_CREW_JOB`) can never approve crew gates or canonical notes, through MCP, the CLI
  or decision files. The Codex plugin forwards `EDU_CREW_JOB` to Edu's MCP server, so Codex workers
  run in worker mode.
- Agent CLIs receive an allowlisted environment instead of every secret in the parent's.
- The Claude Code Edu Deck starts `edu` by its argument list only (no `cmd /c` fallback) and passes
  only plain ids. Codex `notify` on Windows runs through Node instead of `cmd /c`, so message text
  cannot inject commands.
- MCP: workspaces and roots cannot create brains, an MCP server closes only sessions it opened or
  that live in its brain, error messages show paths relative to the brain and no session ids,
  and `waitSeconds` is capped at 600.
- Backup folders contain a `.gitignore` with `*`.
- hono and `@hono/node-server` updated for npm audit advisories. The remaining esbuild advisory (low
  severity, dev server only) needs tsup 9.

## [5.0.1] - 2026-11-08

### Fixed

- `edu setup` on Windows accepts the extended `\\?\C:\…` marketplace path Codex reports, instead of
  refusing a genuine Edu registration as a manual conflict.

## [5.0.0] - 2026-11-08

Memory that costs less context, finds more, and is safe to share between machines and agents.
[What changed and how it was measured](docs/edu-5.0.md)

### Added

- `edu bench`: retrieval, context-cost and brief-stability benchmarks; `edu bench activation` for a
  live agent.
- Bilingual ES/EN recall: light stemming, a term bridge and a fuzzy fallback.
- Compiled memory: `edu_remember` with `links` and `supersedes`, `0-index/catalog.md`,
  `0-index/log.md`, `edu brain lint` and `edu dream`.
- Safe sharing: hash-guarded writes (`expected_hash`), provenance on every note, secret redaction,
  `edu join` and `edu brain share`.
- `edu sync --install` on Windows (Task Scheduler).

### Changed

- The session brief is cache-stable, and MCP tool definitions are about 30% smaller.
- Recall and injection counts go to a machine-local exposure ledger instead of the notes.
- `edu create` proposes every extracted canonical note for approval.
- `edu setup --yes` configures every detected CLI.

## [4.1.0] - 2026-11-07

### Added

- `edu sync`: one Git sync for every machine. Generated files and counter-only conflicts resolve to
  upstream; a real conflict goes to a `sync-conflict/` branch. `--install` schedules it (systemd or
  launchd); `--status` and `edu doctor` show the last run.

### Fixed

- Current Codex plugins are accepted and the global brain resolves correctly.

## [4.0.0] - 2026-10-29

[What changed and how it was verified](docs/edu-4.0.md)

### Added

- `edu brain tidy`: a reviewable plan for empty sessions, stale hypotheses and broken import links;
  `--apply` runs it with a backup.

### Fixed

- Claude Code (`SessionEnd`) and Pi (`session_shutdown`) close the session note they opened at start.

## [3.0.0-rc.1] - 2026-10-26

Release candidate. [Migration and limits](docs/edu-3.0-migration.md)

- Bounded crew artifacts with paginated MCP retrieval, explicit builder/advisor/reviewer routing,
  run-local execution budgets, fresh-approval goal resume, an optional-integration preflight, and
  Windows reliability fixes.

## [2.1.0] - 2026-10-22

- Usage records keep whether a measurement is complete; reader scheduling respects capabilities.
- Declared skill bundles install with ownership checks and rollback.
- Experiments compare explicitly approved commands on frozen inputs.
- Upgrades from the published 0.10.2 and 2.0.0-rc.1 releases are verified in CI.

## [2.0.0-rc.1] - 2026-10-20

Release candidate.

- Bounded, actionable recall and context budgets; read-only briefs.
- Structured learning consolidation; verified credit kept apart from opinions.
- Session lessons over MCP and a memory-only MCP profile.
- Upgrades back up managed files; shared filesystem operations are serialized across processes.

There is no 1.x release: versions go from 0.10.2 to 2.0.0-rc.1.

## [0.1.0 – 0.10.2] - 2026-10-09 to 2026-10-11

Twenty-three tags in three days built the first public Edu:

- 0.1 to 0.6: the second brain with learned recall and importers, headless adapters for claude,
  codex, pi, opencode and agy, the live TUI, crew dispatch over MCP (headless or herdr panes),
  native plugins with `edu setup`, playbook-driven `edu run`, `edu vault`, `edu doctor --context`
  and `edu detach`, and the first Edu Decks for Claude Code, Pi and OpenCode.
- 0.7.0: self-maintaining memory. 0.8.1 and 0.9.1: Obsidian Bases. 0.9.2: fast maintenance and
  correct imports. 0.9.3: fast session start and Windows-safe writes. 0.9.4: Pi on Windows.
- 0.10.0: faithful Albert import, note lookup by id, alias or title, and `edu brief`. 0.10.1 and
  0.10.2: Windows fixes.

[6.0.0]: https://github.com/EduardoMoraga/edu/compare/v5.0.1...v6.0.0
[5.0.1]: https://github.com/EduardoMoraga/edu/releases/tag/v5.0.1
[5.0.0]: https://github.com/EduardoMoraga/edu/releases/tag/v5.0.0
[4.1.0]: https://github.com/EduardoMoraga/edu/releases/tag/v4.1.0
[4.0.0]: https://github.com/EduardoMoraga/edu/releases/tag/v4.0.0
[3.0.0-rc.1]: https://github.com/EduardoMoraga/edu/releases/tag/v3.0.0-rc.1
[2.1.0]: https://github.com/EduardoMoraga/edu/releases/tag/v2.1.0
[2.0.0-rc.1]: https://github.com/EduardoMoraga/edu/releases/tag/v2.0.0-rc.1
[0.1.0 – 0.10.2]: https://github.com/EduardoMoraga/edu/compare/v0.1.0...v0.10.2
