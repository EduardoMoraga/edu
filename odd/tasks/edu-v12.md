# edu-v12 — Albert import fidelity, reference resolution, `edu brief`, native doctor

**Objective:** fix six bugs that agents found while auditing a real migration of a 767-note Albert vault on Windows.
**Delivery:** branch fix/albert-fidelity (not pushed, not merged; dist/ left uncommitted). Tests use synthetic fixtures only.

## Bugs
1. **IDs lost.** 517 imported notes got new Edu ids and lost their Albert correlative (L-025, D-010, C-017, H-001). Relations (`produjo`, `cerro`, `revierte`, `revertida_por`) and body wikilinks pointed nowhere.
2. **`edu_read` was exact-id only.** "D-010" (or a title) did not resolve.
3. **Commitment and other fields lost.** `dueno`, `para`, `kpi`, `alcance`, `resultado`, `estado: cerrado`, hypothesis `abierta_en` / `evidencia` / `cierra_con` / `acerto`, decision `decidido_por`, lesson `costo`, and unknown keys were dropped.
4. **Invalid YAML imported as an empty note**, with no warning.
5. **The contract said "use `edu brief`"**, but there was no CLI `edu brief`; only the MCP tool `edu_brief` and `edu hook session-start`.
6. **`edu doctor` reported Claude and Pi as not integrated** when Edu was installed natively (Claude plugin `edu@edu`, Pi package in `~/.pi/agent/settings.json`).

## Decisions
- **The Edu id embeds the correlative** when the Albert letter matches the Edu prefix: `D-010_x.md` → id and filename `D-010-<title-slug>`. Why: the correlative stays visible where people look (id, filename, Obsidian graph); ids stay unique when titles repeat; the id is deterministic, so re-import finds the same note. `A-` items become lessons (`L-`), so their id is not embedded (`L-<slug>`), but `legacy_id: A-003` and the alias are kept.
- **`legacy_id` + `aliases: [D-010, D-010_x]`** on every imported correlative note. Obsidian resolves `[[D-010]]` and `[[D-010_x]]` through aliases, including links from notes outside the brain.
- **Body wikilinks are rewritten** to the Edu filename stem with the original text as the label (`[[D-010]]` → `[[D-010-x|D-010]]`, `[[D-010_x|text]]` → `[[D-010-x|text]]`). Why: the links resolve without relying on alias support, and the reader sees the same text. Links to sessions that are not in the brain yet, and to notes outside the vault, are left unchanged.
- **Relations:** `produjo` / `cerro` / body wikilinks become `links` (Edu ids); `revierte` becomes `supersedes` on the newer decision; `revertida_por` becomes a new `superseded_by` field on the older one. The raw values stay under `albert:`, so a reference to a note missing from the vault (e.g. `D-999`) is not lost.
- **Imported history is written as-is** (`NewNote.historical`): a reverted decision is written `reverted`, and the newer one keeps `supersedes` without running Edu's live revert cascade, which requires the old decision to be active.
- **New `stakeholder` field** for Albert `para` (the contract had no "for" field). `kpi` / `alcance` / `resultado` and every key without a native Edu field go verbatim under `albert:` in the frontmatter (lossless) and are listed in a trailing `## Origen Albert` body section, so recall finds them. Keys that land unchanged in a native field (`titulo`, `fecha`, `actualizado`, `tags`, `dueno`, `para`, `plazo`, `fuente`, `resumen`, plus `abierta_en` when it became `created`) are not duplicated. Empty values (`[]`, `''`) are not copied.
- **Re-import idempotency** by `origin: albert:<path inside _ALBERT>`. Notes imported before origins existed are matched by source + tier + kind + title, and transitive ones get `origin`, `legacy_id` and `aliases` backfilled (closed sessions and accepted canonical notes are immutable, so they are only skipped).
- **Read resolution** lives in `src/brain/resolve.ts` and is exposed as `Brain.resolve()`. `Brain.read()` stays exact-id for internal callers. The order: exact id → legacy_id/alias → unique id prefix (a match ending on a word boundary wins, so `D-002` picks `D-002-x` over `D-0021-y`) → filename stem (Edu's or the Albert source's) → exact title, case- and accent-insensitive. The first step with any match decides; several matches return candidates (MCP: a non-error text listing them; CLI: the list and exit 1).
- **`edu brief`** reuses the hook's code path (`workspaceBrief`, 1500 tokens). It opens no session; with a query it appends up to 5 recall hits. The core contract text was shortened to stay under the 400-token core budget.
- **Doctor native detection** reads each CLI's own config files instead of spawning CLIs (fast, testable with a temp HOME): Claude `enabledPlugins` / `installed_plugins.json` (a plugin explicitly set to `false` is not counted), the Codex `[plugins."edu@…"]` table (unless `enabled = false`), Pi `packages` (a local path must exist, otherwise a note asks to rerun setup), OpenCode `plugins/edu.*` / `commands/edu-*.md`, and the Antigravity plugin folders. Manifest-based detection is unchanged.

## Checklist
- [x] Bug 4: raw text kept as the body, `import_warning: invalid-frontmatter`, `report.warnings`, CLI warning listing the file (`src/brain/import/shared.ts`, `src/brain/import/albert.ts`, `src/cli/commands/brain.ts`).
- [x] Bug 1: `legacyStem` / `createId` / `notePath` (`src/brain/store.ts`); two-pass importer with relations, wikilink rewrite, idempotency and backfill (`src/brain/import/albert.ts`); new NoteMeta fields `legacy_id`, `aliases`, `origin`, `albert`, `superseded_by` (`src/core/contracts.ts`).
- [x] Bug 3: owner/stakeholder/due, `cerrado` → delivered, `abierta_en` → created, `albert:` map and "Origen Albert" section.
- [x] Bug 2: `resolveReference` + `Brain.resolve`; MCP `edu_read`; new `edu brain read <ref> [--json]`.
- [x] Bug 5: `edu brief [--cwd] [--json] [query...]`; EDU.md, the brief skill and the brief command mention the CLI; plugins regenerated.
- [x] Bug 6: `src/doctor/native.ts`, wired into `diagnose()` (`native` field) and the doctor output.
- [x] Re-import idempotency test (second run: 0 imported, all skipped, same note count).
- [x] Docs: README, docs/README.es.md, docs/ARCHITECTURE.md.

## Evidence
- Tests: `src/brain/import/albert-fidelity.test.ts` (9), `src/brain/resolve.test.ts` (7), `src/doctor/native.test.ts` (6), plus new cases in `src/cli/brain.test.ts`, `src/cli/integrations.test.ts` and `src/mcp/server.test.ts`.
- `npm run typecheck` clean; `npm test` 96 files, 728 passed / 1 skipped; `node --experimental-strip-types scripts/build-plugins.ts --check` up to date; `npm run build` ok.
- Smoke test (built `dist/cli.js`, temp HOME/EDU_HOME, a synthetic vault of 22 notes: 3 canonical, 3 sessions with produjo/cerro, 5 lessons including one with broken YAML, 4 decisions with a revierte/revertida_por pair, 3 hypotheses, 4 commitments):
  - `edu brain import albert` → `Imported 22 note(s) · skipped 0 · warnings 1 · errors 0`, plus `warning: …/L-005_roto.md: invalid-frontmatter …`.
  - `edu brain read D-002` → `D-002-usar-colas · Usar colas · reverted`; frontmatter `superseded_by: D-004-usar-eventos`; D-004 has `supersedes: D-002-usar-colas`.
  - `edu brain read "usar EVENTOS"` → D-004 (title); `edu brain read L-00` → "ambiguous (prefix): 5 notes match" with the candidates, exit 1.
  - C-001 frontmatter: `status: overdue`, `owner: Ana`, `stakeholder: Equipo comercial`, `due: 2026-02-01`, `legacy_id: C-001`, `albert: {kpi, alcance, resultado, …}`.
  - Re-import → `Imported 0 note(s) · skipped 22`; 22 note files before and after.
  - `edu brief` prints the brief (exit 0); `edu brief tablero` appends `## Relevant to "tablero"` with `[[C-001-tablero-semanal]]`.
- `edu doctor` on the author's real machine (read-only) now reports claude, codex, pi, opencode and agy as integrated through their native installs.

## Not verified
- Windows: no run on Windows in this task. Paths inside `_ALBERT` are normalized to `/` for `origin`, and the doctor uses USERPROFILE on win32; both are covered only by unit logic, not by a Windows run.
- The real 767-note vault was not re-imported. A brain imported with the old code is upgraded only partly by a re-import: transitive notes get `legacy_id` / `aliases` / `origin` backfilled, but keep their old ids, relations and bodies (a fresh import gives the full result).
