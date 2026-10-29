# Edu 4.0.0

Two changes on top of the 3.0 candidate. Both come from a real brain of about 1,400 notes, where nine
days of use had left 178 empty open sessions and 82 open hypotheses that filled a third of the brief.

## Sessions close themselves

Session start opens an episode for Claude Code and Pi. Until 4.0 only an explicit `edu_session_close`
filled it, so every session the agent did not close stayed as an empty `open-session` note.

| Host | Before | 4.0 |
|---|---|---|
| Claude Code | Plugin registered `SessionStart` only | Plugin also registers `SessionEnd` → `edu hook session-end` |
| Pi | `session_shutdown` cancelled children only | `session_shutdown` first runs `edu hook session-end` for every episode its brief opened (10 s bound) |
| `edu hook session-end` | Always attributed to Claude | Reads `source: "pi"` like session start, so it closes the episode Pi opened |

An episode the agent already closed is never overwritten. A failed close leaves the episode open,
as before. Codex has no session-end event; it keeps recording turns through `notify`.

## `edu brain tidy`

Maintenance promotes and retires lessons, flags overdue commitments and rebuilds the index. Tidy
covers what it never touched, in two steps:

```bash
edu brain tidy                 # read-only: writes .edu/state/tidy-plan.json and prints it
edu brain tidy --apply         # applies the saved plan; edit the file first to drop entries
edu brain tidy --apply --only hypotheses
edu brain tidy --stale-days 45 # threshold for hypotheses (default 30)
```

| Finds | Applies |
|---|---|
| Sessions still open with no body, older than 24 hours and not linked from any note | Deletes them (`discardEmptySession`, re-checked under the root lock) |
| Hypotheses `open` for more than `--stale-days`, counted from creation | `status: no-evidence` through the lifecycle |
| Broken `[[links]]` written with the original file name of exactly one imported note (`origin`) | Adds that name to the note's `aliases` |
| The same links when the target is an accepted canonical note or a closed episode | Nothing: listed under `manual`, because those notes are immutable |

Every file is copied to `.edu/backups/tidy-<timestamp>/` before it changes. A plan made for another
brain is refused, and an entry that changed since planning is skipped with its reason.

### Limits

- A stale hypothesis becomes `no-evidence`, never `confirmed` or `refuted`. Those need evidence that
  a script does not have; review the plan and delete what is still alive.
- Age is measured from `created`, because `updated` moves each time a note is injected into context.
- Broken links with no single known target are counted, not changed: under the brain's convention a
  broken link marks a note still to write.
- Tidy only reads and writes the project brain, never the global one.

## Verification

Windows 11, Node 24.19, on 2026-10-29.

| Check | Result |
|---|---|
| `npm run typecheck` | Clean |
| New tests: `src/brain/tidy.test.ts` (5), tidy CLI (1), Pi session-end hook (1), Pi shutdown protocol (2), plugin hooks (2) | Pass |
| Full suite | 1,347 passed, 17 failed, 4 skipped |
| The 17 failures | 12 `EPERM` on `symlink` (Windows without developer mode); 5 timing tests (1,000-note maintain under 2 s, experiment timeouts and cancels, a cross-process lock). The same tests fail on the 3.0 baseline on this machine |
| `edu brain tidy` on the real brain, plan only | 4 stale hypotheses, 0 empty sessions, 0 aliases, 26 links left unresolved |

The Pi protocol tests need an installed Pi: `PI_PROTOCOL_ROOT=<npm root -g>/@earendil-works/pi-coding-agent`.
Linux and macOS were not run for this release.
