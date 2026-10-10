# edu-v7 — Self-maintaining memory

**Objective:** the brain prunes, promotes and re-indexes itself without the user running `edu brain maintain`.
**Why:** verified gap: `maintain()` (src/brain/brain.ts:174) is only called from the CLI (src/cli/commands/brain.ts:109), so lessons never get promoted/retired and 0-index Bases go stale.
**Delivery:** ask-on-risk · forecast ~300 lines · branch feat/auto-maintain.

## Acceptance
- Maintenance runs automatically, best-effort and never failing the caller, after: session close (MCP edu_session_close + CLI/hook session close paths), end of every orchestrated run (src/orchestrator/run.ts).
- Throttled: at most once per 10 minutes per brain (stamp in `.edu/state/maintain.json` with lastRun + last report summary); `edu brain maintain` always forces.
- No LLM, fast; canonical promotion stays a *proposal* (human approves).
- `edu deck --json` gains `maintenance: { lastRun: number|null, promoted, retired, overdue }` and `brain.toApprove` (proposed canonical count); Pi, OpenCode and Claude deck renderers show "N to approve" when > 0 and overdue commitments when > 0.
- Tests for throttle, hooks, deck fields.

## Tasks
- [x] T1 auto-maintain core + hooks + throttle — route: delegated writer (ca3c9a1)
- [x] T2 deck fields + renderers — route: same writer (789cbc0)
- [x] T3 release v0.7.0 — route: lead

## Progress

### 2026-10-10 — T1 + T2 (delegated writer)

**T1 — `feat(brain): auto-maintain after session close and run end` (ca3c9a1)**
- `src/brain/auto-maintain.ts`: `autoMaintain(brain, root, { now, force })` → `{ ran: true, report, state } | { ran: false, reason }`; never throws. Throttle 10 min per brain via `<root>/state/maintain.json` = `{ lastRun, promoted, retired, overdue, changed }` (counts of that run), written with `atomicWrite`. A corrupt stamp reads as absent.
- Wired after: MCP `edu_session_close` (both the exact-id and fallback paths), `edu hook session-end`, `edu hook codex-notify`, and `orchestrate()` finish (after the episode is closed/learned and the episode package is built; root = `dirname(runsDir)` = primary brain root).
- `edu brain maintain` calls `autoMaintain(..., { force: true })`, so it always runs and writes the stamp; a failure still exits non-zero.
- Tests: `src/brain/auto-maintain.test.ts` (stamp + index, throttle/force, never-throws), `src/cli/integrations.test.ts` (hooks write stamp + INDEX, throttle across hooks, CLI force), `src/mcp/server.test.ts` (close → overdue flagged, stamp, INDEX, throttled second close), `src/orchestrator/orchestrator.test.ts` (close → maintain order, stamp, failing maintain does not fail the run).

**T2 — `feat(deck): surface proposals to approve, overdue commitments and maintenance` (789cbc0)**
- `DeckSnapshot.brain.toApprove` (canonical notes with `status: proposed`) and `DeckSnapshot.maintenance = { lastRun: number|null, promoted, retired, overdue }`. `lastRun/promoted/retired` come from the stamp; `overdue` is the count of commitments **currently** `status: overdue` (the stamp's `overdue` is only newly flagged in that run and would drop to 0 on the next run).
- Pi: header stats line adds `N to approve` (warning) and `N overdue` (error) right after brain stats, only when > 0; overlay adds an upkeep row with `maintained Xm ago` (+ promoted/retired when > 0). OpenCode: footer stats + sidebar badges; `/edu-deck` dialog adds an `Upkeep` line. Claude mod: counts proposals and overdue `C-*` notes from frontmatter with `$.fs`, reads `.edu/state/maintain.json`, shows badges in the BRAIN line and `maintained Xm ago` in the footer line. All quiet at 0 and tolerant of older snapshots.
- Tests: `src/cli/commands/deck.test.ts` (new fields, corrupt stamp → `lastRun: null`, human output quiet at 0).

**Verification**
- `npm run typecheck` clean; `npm test` 80 files, 603 passed / 1 skipped; `node --experimental-strip-types scripts/build-plugins.ts --check` → "Plugin output is up to date."
- Renderers (not typechecked by tsc) rendered through stub harnesses: Pi header at 60/140 cols and overlay at 30/84 cols never exceed width and show nothing extra at 0; OpenCode dialog shows `Upkeep  maintained 5m ago · 1 promoted · 2 to approve · 3 overdue` and omits it at 0; Claude refresh produces `toApprove: 1`, `maintenance.overdue: 1` matching `edu deck`.
- Smoke on a copy of `~/Edu/marca-personal/.edu` (tmp dir, after `npm run build`): no `state/` before; `edu hook session-end` exit 0 → `state/maintain.json` written and `0-index/INDEX.md` regenerated (new `Generated:` stamp, new session listed); `edu deck --json` → `brain.toApprove: 1`, `maintenance.lastRun` set; `edu hook codex-notify` within 10 min left `lastRun` unchanged (throttled); `edu brain maintain` (0.1 s) advanced `lastRun`. `~/Edu` untouched (no `state/`, original `Generated:` line unchanged).
- Not verified live: Pi/OpenCode/Claude inside their real TUIs; MCP close and orchestrated run on the real copy (covered by unit tests only).
- T3 released v0.7.0 (CI green 3 OS, tag v0.7.0); installed globally; setup re-run; forced maintain on marca-personal, edu, price-traking; deck shows "1 to approve" in marca-personal.
