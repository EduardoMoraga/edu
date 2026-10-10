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
- [ ] T1 auto-maintain core + hooks + throttle — route: delegated writer
- [ ] T2 deck fields + renderers — route: same writer
- [ ] T3 release v0.7.0 — route: lead

## Progress
