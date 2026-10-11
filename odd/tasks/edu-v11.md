# edu-v11 — Fast session-start brief and lock-tolerant writes

**Objective:** `edu hook session-start` must finish well inside the hosts' timeouts on a large imported brain (767 notes from an Albert import took 12.0 s on Windows 11, so Pi's 5 s spawn started without the brief), and brain writes must survive Windows file locks held by Obsidian, antivirus or other tools (`EPERM: operation not permitted, rename` in the chat TUI).
**Delivery:** branch perf/session-start (not pushed, not merged; dist/ left uncommitted).

## Measurements
Synthetic brain shaped like the Albert import (`src/test-support/synthetic-brain.ts`): 21 canonical, 227 episodic, 519 transitive (243 lessons, 150 decisions, 73 hypotheses, 53 commitments), ~1.5 KB bodies, 767 notes. Mac, `node dist/cli.js hook session-start`.

| Phase (before) | Time |
|---|---|
| Open workspace | ~1 ms |
| One full brain load (read + YAML parse of 767 files) | ~137 ms |
| Build the context pack | ~109 ms (one load) |
| `recordUse` for the 19 included notes | ~1788 ms (one full brain reload per note) |
| Auto-maintain | not on this path (only session close and run end) |

- Before: 1.97 s / 1.91 s end to end. A 6000-token brief (about 200 included notes) took ~65 s.
- After: 0.23–0.30 s end to end; the 6000-token brief is under 0.1 s in tests. A 1534-note brain takes 0.36 s (roughly linear).
- Brief output byte-identical before and after (`cmp` on the CLI output of two consecutive runs, and the snapshot test).

## Checklist
- [x] Profile and breakdown (table above): the cost was `brain.recordUse`, which called `find()` per id and reloaded the whole brain each time.
- [x] `recordUse` loads the brain once per batch (`src/brain/brain.ts`).
- [x] Per-process note cache keyed by path and validated by mtime, size and inode; `atomicWrite` evicts the path it writes (`src/brain/store.ts`).
- [x] `rankNotes` computes document frequency once per term instead of per document (was O(terms × n²)) (`src/brain/search.ts`); the pack's deferred list uses a Set (`src/context/pack.ts`).
- [x] Snapshot test of first/second/wide/query briefs and recall ranking, recorded on the old code and passing on the new (`src/context/session-start.perf.test.ts`, `src/context/__snapshots__/session-start-brief.txt`).
- [x] Perf regression test: 767-note brief under 3 s and each note file parsed exactly once.
- [x] Pi template: 15 s timeout and a single `ctx.ui.notify('Edu brief unavailable: …')` on failure; generator fallback extension matches (`templates/pi/edu.ts`, `scripts/build-plugins.ts`).
- [x] Claude Code and Codex plugin SessionStart hooks: timeout 10 s → 30 s, asserted in `scripts/build-plugins.test.ts`. The settings hook written by `edu install` for Claude (`src/adapters/claude.ts`) sets no timeout, so Claude's 60 s default applies.
- [x] `atomicWrite` retries the rename on EPERM/EBUSY/EACCES (10…400 ms backoff, ~1.8 s total), then copies the temp file over the target, always removes the temp file, and throws if nothing could land (`src/brain/store.ts`, `src/brain/atomic-write.test.ts`).
- [x] Read paths (`recall`, `recordUse`) skip rewriting a note already used in the same minute; wins, losses and recency semantics unchanged.

## Verification
- `npm run typecheck` clean; `npm test` 93 files, 698 passed / 1 skipped; `npm run build` ok; `node --experimental-strip-types scripts/build-plugins.ts --check` up to date.
