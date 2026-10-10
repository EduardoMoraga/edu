# edu-v6 — Edu Deck everywhere (Pi + OpenCode)

**Objective:** Pi and OpenCode get the same Edu identity and live Deck the Claude Code mod has.
**Why:** user wants Pi and OpenCode as powerful as Claude with Edu ("que sea superador").
**Delivery strategy:** ask-on-risk · forecast ~900 authored lines → single feature branch, one PR-sized slice per task.

## Contract — `edu deck [--json] [--cwd <dir>]` (version 1)
```json
{ "version": 1, "project": { "name": "edu", "root": "/abs" }, "identity": "Edu",
  "brain": { "present": true, "canonical": 9, "proposed": 1, "episodic": 4, "transitive": 3, "lessons": 7 },
  "spec": { "name": "x", "requirements": 5, "checks": 3 } | null,
  "jobs": [ { "id": "abcd1234", "cli": "codex", "task": "…", "status": "running", "mode": "pane", "startedAt": 0, "endedAt": null, "tokens": 0 } ],
  "approvals": 0,
  "recent": [ { "title": "…", "tier": "canonical", "at": 0 } ],
  "updatedAt": 0 }
```
Context % / cost / model come from the host CLI, never from this command. Must run in <300 ms, no LLM, never throws (no brain → present:false, zeros).

## Tasks
- [x] T1 `edu deck` data command + tests — route: delegated (Codex, pane)
- [x] T2 Pi experience: EDU header, deck widget, footer, `/edu-deck` overlay, `edu` theme — route: delegated (Claude writer)
- [x] T3 OpenCode experience: logo slot, sidebar deck, `edu` theme; setup writes tui.json plugin + theme — route: delegated (Claude writer)
- [x] T4 detach: OpenCode tui.json plugin entries (gentle-logo) — route: same writer as T3
- [ ] T5 live verification in Pi and OpenCode (herdr), release v0.6.0

## Progress
- T1 done by Codex (pane): commit 176767a; verified `edu deck --json` in ~/Edu/marca-personal (~0.1s). Codex saw crew.test.ts fail only inside a Codex session (env-dependent); recheck in full suite.
- T2 Pi: 7dbde14 + tagline d3785ca. Live in herdr: header EDU + stats, footer (ctx 3%, ↑2.4k, $0.019 after a prompt), /edu-deck overlay, recall answered with real profile.
- T3 OpenCode: 7d17fb4, ported to OpenCode 2 contract fed64c4 (server {id,setup,server}; TUI dir plugins/edu-deck/tui.tsx; home.footer.status + sidebar.content + /edu-deck). Live: status line and /edu-deck dialog render with real data.
- T4 detach: a7ceb28; live removed gentle-logo from tui.json (backup detach-2026-10-10T21-15-50-155Z-e866c83e).
- Fix found live: Pi/OpenCode YAML frontmatter with ': ' (8a… fix(plugins) commit) + test.
- Open: T6 Pi skill collisions, stale OpenCode 1.x leftovers, cli.json detach — delegated writer.
