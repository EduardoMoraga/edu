# Edu v0.1 — Cross-Review & Audit Report

**Auditor:** helper (Antigravity)  
**Date:** 2026-10-08  
**Scope:** `docs/ARCHITECTURE.md`, `src/`, `templates/`, `scripts/`, `.github/`  
**Verdict:** **`ship-with-fixes`**

---

## Executive Summary & Lead Observation

### Confirmation of Lead Observation
- **Observation:** In `edu demo`, the lead agent continues to show `● running` after the demo run completes.
- **Verdict:** **CONFIRMED**.
- **Root Cause & Evidence:**
  In [`src/engine/fake.ts:21-40`](../src/engine/fake.ts#L21-L40), `demoScript()` emits:
  1. `agent.spawn` for `lead-1` (`line 21`)
  2. `agent.status` `running` for `lead-1` (`line 22`)
  3. Subagents `explorer-1`, `reviewer-1`, and `builder-1` all receive matching `agent.end` events (`lines 27, 30, 39`)
  4. `run.end` is emitted at `line 40`.
  Crucially, **no `agent.end` event is ever emitted for `lead-1`**. In [`src/tui/state.ts:120-126`](../src/tui/state.ts#L120-L126), the `run.end` reducer handler updates `state.run`, but does not mutate or terminate any outstanding agent states. Because `lead-1` was never ended, its status remains `running` in `state.agents['lead-1']`, rendering the running glyph `●` indefinitely in the TUI agent tree.
- **Suggested Fix:**
  In `src/engine/fake.ts`, emit `{ type: 'agent.end', agentId: 'lead-1', ok: true, summary: 'Plan and delegation complete.', at }` before `run.end`.

---

## 1. Top Evidenced Findings (Ranked by Severity)

### Finding 1 (CRITICAL / DATA LOSS): `uninstall()` clobbers user edits outside managed blocks and merged keys on `--force`
- **Location:** [`src/adapters/installer.ts:280-287`](../src/adapters/installer.ts#L280-L287)
- **Failure Scenario:**
  When Edu installs managed blocks into user instructions (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) or merges keys into JSON/TOML configurations (`settings.json`, `.codex/config.toml`), it records a SHA-256 hash and creates a whole-file backup of the pre-installation state.
  If the user later modifies the file—for example, adding custom instructions outside Edu's managed block or adding custom hooks/settings to `settings.json`—and runs `edu uninstall --force` (or if drift is bypassed):
  ```ts
  if (action.backup) {
    const original = await readFile(action.backup);
    await writeFile(action.path, original);
  } else {
    await unlink(action.path).catch(...);
  }
  ```
  `uninstall()` unconditionally overwrites the entire file with the pre-install snapshot, erasing all user work created since installation. If the file did not exist prior to install (e.g. `CLAUDE.md`), `uninstall()` calls `unlink()` and deletes the file outright, destroying whatever content the user added post-install.
  *Note:* The codebase already implemented and unit-tested `removeManagedBlock` in [`src/adapters/blocks.ts:23`](../src/adapters/blocks.ts#L23), `unmergeJson` in [`src/adapters/merge.ts:81`](../src/adapters/merge.ts#L81), and `unmergeToml` in [`src/adapters/merge.ts:155`](../src/adapters/merge.ts#L155), but `installer.ts` never calls them.
- **Suggested Fix:**
  In `src/adapters/installer.ts:uninstall()`, apply granular inversion:
  - For `managed-block`: read the current target, call `removeManagedBlock(current)`, and write back. Only unlink if the file is empty and had no prior backup.
  - For `json-merge`: call `unmergeJson(current, action.jsonPatch)`.
  - For `toml-merge`: call `unmergeToml(current)`.
  - Only restore whole-file backups or unlink files for pure standalone templates owned exclusively by Edu (such as skill files under `.agents/skills/` or agents under `.claude/agents/`).

### Finding 2 (HIGH / SECURITY): Path traversal in canonical note writes via unvalidated `kind`
- **Location:** [`src/brain/brain.ts:103-109`](../src/brain/brain.ts#L103-L109), [`src/brain/store.ts:18`](../src/brain/store.ts#L18)
- **Failure Scenario:**
  When writing a canonical note through `brain.write(input)`, `validateStatus` at line 108 only validates `input.status` against allowed statuses for `'canonical'` (`'proposed'`). `input.kind` is never validated or sanitized against `CanonicalKind`.
  In `src/brain/store.ts:18`:
  ```ts
  if (meta.tier === 'canonical') return join(root, 'brain', TIER_DIRS.canonical, String(meta.kind ?? 'domain'), `${slugify(meta.title)}.md`);
  ```
  While `meta.title` is sanitized with `slugify()`, `meta.kind` is injected directly into `join()`. If a caller supplies `kind: '../../../../outside'`, the resolved path escapes `brain/1-canonical` and the brain root, allowing writes to arbitrary locations outside the project workspace.
- **Suggested Fix:**
  In `src/brain/brain.ts:write()`, validate that `meta.kind` belongs to the canonical kind whitelist:
  `['identity', 'standard', 'lexicon', 'domain', 'person', 'preference']` (as is done in `src/brain/import/shared.ts:48`), or apply `slugify(String(meta.kind))` before path construction.

### Finding 3 (HIGH / ROBUSTNESS & PORTABILITY): Deterministic checks crash on Windows (`sh` missing and negative PID)
- **Location:** [`src/evidence/registry.ts:75`](../src/evidence/registry.ts#L75), [`src/evidence/registry.ts:112`](../src/evidence/registry.ts#L112)
- **Failure Scenario:**
  1. Line 75 executes checks via `spawn('sh', ['-c', check.command], { cwd, detached: true, ... })`. On Windows without MSYS/Git Bash in PATH, `sh` does not exist and throws `ENOENT`.
  2. Line 112 calls `process.kill(-pid, signal)`. On Windows, negative PIDs are unsupported by Node.js/Windows kernel and throw `TypeError [ERR_INVALID_ARG_VALUE]: The argument 'pid' must be a positive integer`. Unlike `src/engine/process.ts:32-40`, `registry.ts` lacks Windows platform checks.
- **Suggested Fix:**
  In `src/evidence/registry.ts`:
  - Check `process.platform === 'win32'`. On Windows, execute via `cmd.exe /d /s /c` or PowerShell.
  - In `killProcessGroup`, use `child.kill(signal)` on Windows, reserving `process.kill(-pid, signal)` for non-Windows platforms.

### Finding 4 (MEDIUM / ROBUSTNESS): Unhandled promise rejections and rogue events on parallel step failure
- **Location:** [`src/orchestrator/run.ts:172`](../src/orchestrator/run.ts#L172)
- **Failure Scenario:**
  In `orchestrate()`, when up to 3 read-only, parallel-safe steps are executed concurrently via `Promise.all(batch.map(step => executeStep(step)))`:
  If one step throws an error or its engine process fails, `Promise.all` immediately rejects. The orchestrator's `catch (error)` block runs, emits an error event, and exits `orchestrate()`.
  However, the sibling concurrent promises in `batch` are not cancelled or awaited. They continue running as floating background promises. When they complete or throw, any rejection is unhandled by the process, and their delayed calls to `emit()` write events after `runs/<runId>.jsonl` has closed.
- **Suggested Fix:**
  Pass a per-batch `AbortController` to sibling steps. When any step rejects, abort the remaining steps in the batch and await `Promise.allSettled(outcomes)` before allowing `orchestrate()` to enter error teardown and episode packaging.

### Finding 5 (MEDIUM / SPEC DEVIATION): Orchestrator does not queue reflection
- **Location:** [`src/orchestrator/run.ts:267-273`](../src/orchestrator/run.ts#L267-L273)
- **Failure Scenario:**
  ARCHITECTURE.md §7 Step 6 specifies:
  > *"6. Learn — close the episodic session with a summary; queue reflection."*
  `closeEpisode` emits `brain.learn` with kind `'episode'`, but reflection is never queued, scheduled, or triggered anywhere in `src/orchestrator/`. Reflection only occurs if a user manually executes `edu reflect`.
- **Suggested Fix:**
  Add a post-run hook or emit a `reflection.queued` event in `finish()`, or invoke background reflection when configured.

### Finding 6 (MEDIUM / ROBUSTNESS): Non-atomic writes on `config.json` and harness registries
- **Location:** [`src/orchestrator/config.ts:35`](../src/orchestrator/config.ts#L35), [`src/evidence/registry.ts:49, 64`](../src/evidence/registry.ts#L49), [`src/evidence/package.ts:43`](../src/evidence/package.ts#L43)
- **Failure Scenario:**
  `src/brain/store.ts` correctly utilizes `atomicWrite` (writing to a UUID temp file and renaming). However, `saveConfig` (`config.json`), `saveChecks` (`checks.json`), and `saveTools` (`tools.json`) perform direct `writeFile()`. A crash or power loss during `saveConfig` corrupts `config.json`, rendering subsequent CLI commands unrunnable.
- **Suggested Fix:**
  Reuse `atomicWrite` from `src/brain/store.ts` (or extract it to `src/core/fs.ts`) for all configuration and registry writes.

### Finding 7 (LOW / ENGINE COMPATIBILITY): Positional `resume` argument in `buildCodexArgv`
- **Location:** [`src/engine/codex.ts:13`](../src/engine/codex.ts#L13)
- **Failure Scenario:**
  `buildCodexArgv` appends `['resume', req.resumeSessionId]` to `codex exec ...`. In OpenAI Codex CLI, `resume` is a top-level subcommand (`codex resume <thread-id>`), not an argument to `codex exec`. Passing `resume` as a positional argument causes Codex CLI to misinterpret positional parameters.
- **Suggested Fix:**
  Adjust command construction when resuming to use the proper Codex CLI invocation syntax.

### Finding 8 (LOW / EDGE CASE): `edu reflect` fails on empty brain without closed episodes
- **Location:** [`src/reflect/reflect.ts:22, 48`](../src/reflect/reflect.ts#L22-L48)
- **Failure Scenario:**
  If `edu reflect` is invoked in a newly initialized project with no closed episodes and `brainRoot` is not passed programmatically:
  Line 22 resolves `root` to `undefined`. If the model proposes a new skill, line 48 throws: `Cannot write skill proposals: provide brainRoot or at least one episodic note.`
- **Suggested Fix:**
  Fall back `root` to `process.cwd()` or the project primary brain root when `episodes.length === 0`.

---

## 2. Specification Compliance Matrix (§4–§13)

| Spec Section | Requirement | Status | Evidence / Notes |
|---|---|---|---|
| **§4. Brain** | `openBrain`, `list`, `read`, `write`, `update` | **Implemented** | `src/brain/brain.ts`, `src/brain/store.ts`. Full CRUD with frontmatter YAML serialization and lifecycle transitions. |
| **§4. Brain** | Atomic writes (temp file + rename) | **Implemented** | `src/brain/store.ts:28-33` (`atomicWrite`). |
| **§4. Brain** | Learned weight & BM25 recall | **Implemented** | `src/brain/learning.ts` (Laplace + 45-day half-life decay, floor 0.25), `src/brain/search.ts`. |
| **§4. Brain** | Lessons & commitments lifecycle, maintain() | **Implemented** | Candidate → proven (`wins ≥ 3`, `w ≥ 0.7`); retired (`losses ≥ 3`, `w < 0.35` or 180d); overdue commitments; proven → canonical proposals. |
| **§4. Brain** | Importers (Albert & MORAGENT) | **Implemented** | `src/brain/import/albert.ts`, `src/brain/import/moragent.ts`. Read-only, correct tier mappings. |
| **§4. Brain** | Canonical path safety | **Partial** | Security finding: `meta.kind` unvalidated in `brain.write()`. |
| **§5. Context Budget** | `estimateTokens` heuristic | **Implemented** | `src/context/tokens.ts`. Tested character/token ratio with CJK and code punctuation adjustments. |
| **§5. Context Budget** | `buildContext` 6-section priority & deferred list | **Implemented** | `src/context/pack.ts:27-98`. Correctly fills 1. Identity core, 2. Commitments/hypotheses, 3. Lessons, 4. Canonical, 5. Episodes, 6. Index pointer. |
| **§5. Context Budget** | `brief` (1500 tokens default) | **Implemented** | `src/context/brief.ts:5-7`. |
| **§6. Engines** | 5 CLI adapters (claude, codex, pi, opencode, agy) | **Implemented** | `src/engine/`. Autonomy mapping table in `autonomy.ts`. |
| **§6. Engines** | Process groups, UTF-8 streaming, line caps | **Implemented** | `src/engine/process.ts:9, 32-40, 97`. 1MB line cap, SIGTERM → SIGKILL escalation. |
| **§6. Engines** | Native JSONL mapping & fixtures | **Implemented** | Tested against 5 fixtures in `src/engine/fixtures/`. |
| **§6. Engines** | `FakeEngine` & `demoScript` | **Partial** | `src/engine/fake.ts`. Script missing `agent.end` for lead agent. |
| **§7. Orchestrator** | 6-step DAG pipeline (Brief, Plan, Approve, Execute, Review, Learn) | **Implemented** | `src/orchestrator/run.ts:31-305`. Approval gating, one repair round, review fix round, JSONL logging. |
| **§7. Orchestrator** | Reviewer diversity in crew mode | **Implemented** | `src/orchestrator/assign.ts:7-12`. Reviewer selects a distinct vendor from builder when available. |
| **§7. Orchestrator** | Queue reflection on learn | **Missing** | Spec deviation: orchestrator does not trigger or queue reflection. |
| **§8. Reflect** | `edu reflect` with Zod JSON validation | **Implemented** | `src/reflect/reflect.ts:9-16, 37`. Proposes L-, H-, feedback, skill diffs, and canonical proposals. |
| **§8. Reflect** | Proposals workflow (`list`, `accept`, `reject`) | **Implemented** | `src/reflect/proposals.ts`, `src/cli/commands/learn.ts:80-120`. |
| **§9. MCP Server** | Stdio server with 9 token-bounded tools | **Implemented** | `src/mcp/server.ts:57-118`. `edu_brief`, `edu_recall`, `edu_read`, `edu_remember`, `edu_feedback`, `edu_propose_canonical`, `edu_commitments`, `edu_session_open`, `edu_session_close`. |
| **§10. CLI Integrations** | Managed blocks, JSON/TOML merges, manifests, drift checks | **Implemented** | `src/adapters/installer.ts`, `src/adapters/merge.ts`, `src/adapters/blocks.ts`. |
| **§10. CLI Integrations** | Reversible uninstall | **Partial** | Critical finding: `uninstall()` restores whole files on `--force` rather than calling inverse unmerge/remove functions. |
| **§11. Identity** | `templates/EDU.md`, ASCII banner, theme tokens, statusline | **Implemented** | `templates/EDU.md`, `src/identity/banner.ts`, `src/identity/theme.ts`, `src/identity/statusline.ts`. |
| **§12. TUI** | Ink live view, agent tree, focus pane, approval card, brain strip | **Implemented** | `src/tui/App.tsx`, responsive narrow/wide modes, keyboard navigation, replay & demo. |
| **§13. CLI Commands** | Full command tree matching spec | **Implemented** | `src/cli/program.ts`. `edu`, `init`, `install`, `uninstall`, `doctor`, `run`, `ui`, `demo`, `brain`, `context`, `reflect`, `proposals`, `mcp`, `statusline`. |

---

## 3. Security Audit

1. **Path Traversal:**
   - **Brain IDs:** Safe. IDs are constructed via `slugify()` and regex prefixes; `brain.read(id)` scans existing files in memory rather than taking user-supplied strings directly into arbitrary filesystem lookups.
   - **Canonical Note Kind:** **Vulnerable**. As documented in Finding 2, unvalidated `meta.kind` in `brain.write()` allows writing outside the canonical folder.
   - **Brain Link:** Safe. `src/cli/link.ts:21-23` resolves target and link, and throws `ELINKCONFLICT` if an existing path points elsewhere.
   - **Imports:** Safe. `importAlbert` and `importMoragent` map canonical categories through a strict whitelist (`src/brain/import/shared.ts:48-50`).

2. **Shell Injection in Engine Argv:**
   - **Engines:** Safe. `src/engine/process.ts:57` uses `child_process.spawn(spec.command, spec.args, { shell: false })`. No user prompt, system prompt, or flag is passed to a shell.
   - **Harness Checks:** Safe from LLM manipulation. In `src/orchestrator/run.ts:404-414`, plan checks must match pre-registered checks from `.edu/harness/checks.json` verbatim; arbitrary shell injection via plan text is rejected.

3. **Unsafe Writes Outside Root/HOME in Installer:**
   - All paths in `src/adapters/paths.ts` resolve under `root` or `home`.
   - *Scope Leakage Notice:* In `project` scope, Codex's MCP (`~/.codex/config.toml`) and Pi's MCP (`~/.pi/agent/mcp.json`) write to `HOME` because those CLIs do not support project-level MCP files. This is documented in the spec and tracked via `shared-targets.json`.

4. **Secrets in Fixtures:**
   - Safe. Checked `src/engine/fixtures/` and templates; fixtures use synthetic sessions (`claude-demo-session`, etc.) and synthetic cost numbers. No API keys, personal tokens, or live credentials exist.

5. **Uninstall Clobbering User Files:**
   - **Vulnerable**. Documented in Finding 1. `uninstall()` on `--force` overwrites post-installation edits instead of inverting managed blocks or unmerging JSON/TOML keys.

---

## 4. Robustness & Platform Compatibility

1. **Crash Paths & Process Management:**
   - Process group termination in `src/engine/process.ts` is resilient with 250ms escalation from `SIGTERM` to `SIGKILL`.
   - Process group cleanup in `src/evidence/registry.ts:112` crashes on Windows due to negative PID usage.
2. **Unhandled Promise Rejections:**
   - Parallel step execution in `src/orchestrator/run.ts:172` leaves sibling steps running unmonitored if one fails.
3. **Non-Atomic Writes:**
   - Brain notes use atomic write. `config.json`, `checks.json`, and `tools.json` do not.
4. **Windows Pathing:**
   - Windows path backslashes in regex matching in `src/evidence/entropy.ts:32` (`/(?:^|\/)(?:debug|scratch|tmp)[^/]*\.(?:js|ts|sh|py)$/i`) will miss residue files with Windows path separators `\`.

---

## 5. Product & First-Run Experience Gaps

1. **First-Run without CLIs:**
   - When launched with no coding CLIs installed, `edu` cleanly detects this and suggests `edu demo`.
   - Running `edu run` or typing a goal into the home composer displays a clear error: `No supported coding CLI found on PATH. Install one, or try: edu demo`.
2. **Help Text & i18n:**
   - All commands feature bilingual help text (`en` default, `es` via `--lang es` or `EDU_LANG=es`).
   - Group headings in `edu --help` neatly partition commands into `Get started`, `Work`, `Brain`, and `Integrations`.

---

## 6. Final Verdict & Top 5 Must-Fix Items

### Verdict: **`ship-with-fixes`**
The core architecture is solid, clean, and passes all 328 unit tests, typechecks, and packaging builds. However, the data loss risk in `uninstall` and the broken demo state require resolution prior to public v0.1 release.

### Top 5 Must-Fix Items:
1. **Fix `uninstall()` in [`src/adapters/installer.ts:280-287`](../src/adapters/installer.ts#L280-L287):** Use `removeManagedBlock`, `unmergeJson`, and `unmergeToml` during uninstallation rather than overwriting whole files from pre-install backups on `--force`.
2. **Fix `demoScript()` in [`src/engine/fake.ts:40`](../src/engine/fake.ts#L40):** Emit `{ type: 'agent.end', agentId: 'lead-1', ok: true, summary: 'Plan and delegation complete.', at }` so the lead agent does not remain `● running` in `edu demo`.
3. **Fix Canonical Path Traversal in [`src/brain/brain.ts:108`](../src/brain/brain.ts#L108):** Whitelist/slugify `input.kind` for canonical notes to prevent `join()` directory traversal.
4. **Fix Windows Check Execution in [`src/evidence/registry.ts:75, 112`](../src/evidence/registry.ts#L75):** Avoid spawning `sh` and using negative PIDs on Windows (`win32`).
5. **Fix Parallel Step Error Handling in [`src/orchestrator/run.ts:172`](../src/orchestrator/run.ts#L172):** Cancel and settle sibling background tasks when a parallel step fails to prevent unhandled promise rejections and post-run stream writes.
