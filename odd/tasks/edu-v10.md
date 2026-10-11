# edu-v10 — Import and maintenance fixes from a real Albert migration

**Objective:** migrating a real 767-note Albert vault on Windows must not flood canonical proposals, must register the workspace brain where it actually lives, and must accept the Albert path the user naturally passes.
**Delivery:** branch fix/import-maintain (not pushed, not merged; dist/ left uncommitted).

## Bugs
1. `brain.maintain()` proposed every lesson that was already `proven` (243 proposals after the import) and reloaded the whole brain twice per note (quadratic, about 20 minutes).
2. `edu init` registered `.edu/brain` in `~/.edu/projects.json` before `brainDir` was applied, and re-registering returned the stale entry unchanged.
3. `edu brain import albert <path>` only accepted the folder above `_ALBERT`; passing `_ALBERT` itself looked for `_ALBERT/_ALBERT` and imported nothing.

## Checklist
- [x] B1 maintain proposes only lessons promoted to `proven` by this run; reject records and existing proposals still dedupe; notes loaded once per run with a Set of proposal links and a Map of accepted standards by title (`src/brain/brain.ts`, `src/brain/brain.maintain.test.ts`)
- [x] B2 `readProjects` resolves each `brain` from the workspace's current `.edu/config.json` (stored field kept for compatibility; missing `.edu/` or invalid `brainDir` keep the stored value); `registerProject` updates a stale existing entry; new `refreshProjects` rewrites stale paths and runs at the start of `migrateWorkspaces` (`src/vault/registry.ts`, `src/update/migrate.ts`, tests)
- [x] B3 `resolveAlbertRoot` accepts the parent of `_ALBERT`, `_ALBERT` itself, or a folder holding `1-CANONICO`/`2-EPISODICO`/`3-TRANSITIVO` directly, and throws a message naming both layouts otherwise; the CLI resolves the path against the working directory (`src/brain/import/albert.ts`, `src/cli/commands/brain.ts`, tests)

## Evidence
- Tests written first and seen failing: maintain (3 of 4 failing, two by timeout), registry (3 of 4), migrate (1), Albert (2), CLI relative `_ALBERT` import (1).
- `npm run typecheck` clean; `npx vitest run src/brain src/vault src/workspace src/update src/cli` 229 passed / 1 skipped; `npm test` 691 passed / 1 skipped; `npm run build` ok.
- Performance: a 1000-note brain (750 proven lessons plus 250 decisions) maintains in under 2 s in the test suite; `overlayNotes` is called the same number of times (at most 2) for 10 and for 200 notes.
- Smoke (temp `EDU_HOME` and `HOME`, synthetic vault with 200 proven lessons and 50 decisions): `edu brain import albert ../src/_ALBERT` imported 250 notes, 0 errors, in 3.27 s; `edu brain maintain --json` reported 0 changed and 0 promoted in 0.17 s; `edu brain proposals --json` returned `[]`; the index lists 250 notes.
