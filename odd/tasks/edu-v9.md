# edu-v9 — Professional Obsidian knowledge views (orchestrator Bases)

**Objective:** Obsidian shows Edu's knowledge like a first-class product: the root brain gives an orchestrator view across every workspace in the vault (with a project column), each workspace shows only its own, everything is localized, and a Home dashboard ties it together.
**User request:** "implementa todo lo que tengas que implementar para que esto quede profesional y de primer nivel".
**Delivery:** branch feat/orchestrator-bases → v0.9.0.

## Design (lead)
- Base set per brain (file names localized by workspace lang; es shown, en in parens): Conocimiento (Knowledge: canonical; views Todo / Por aprobar), Decisiones (Decisions), Lecciones (Lessons), Hipótesis (Hypotheses), Compromisos (Commitments; views Pendientes / Atrasados), Sesiones (Sessions). Old English-named .base files from earlier versions are removed on rebuild.
- Scope: a brain that sits at the vault's top level (e.g. ~/Edu/01-CONOCIMIENTO, the global brain) is the *orchestrator* brain → its Bases filter by kind only within the vault and add a `proyecto` formula column (global vs workspace name from the path). Any other brain filters by its own vault-relative folder (current behavior).
- Columns use display names in the workspace language (`properties.<p>.displayName`), sensible sort (updated desc / due asc).
- Root `00-INICIO/Panel.md` (es) / `Dashboard.md` (en) generated next to the orchestrator brain's vault root only if missing or Edu-owned (marker), embedding the Bases (`![[Conocimiento.base#Por aprobar]]` etc.) and linking each registered workspace.
- Code repos under 03-LAB keep working; the lead migrates their brains to a visible, git-excluded `01-CONOCIMIENTO` so they appear in the orchestrator view.

## Tasks
- [x] T1 Bases generator: localized set, orchestrator vs workspace scope, formulas, display names, views, cleanup of legacy files — delegated writer
- [x] T2 Dashboard note generation — same writer
- [ ] T3 live verification in Obsidian (screenshots) + migrate 03-LAB brains — lead
- [ ] T4 release v0.9.0 via edu update — lead

## Progress
- T1+T2 (writer): `src/brain/bases.ts` (pure: localized Base set, project formula, dashboard text, `generated_by: edu` marker) and `src/brain/views.ts` (IO: writes Bases, deletes legacy `Lessons/Commitments/Hypotheses/Sessions.base` and the other-language set only, writes the dashboard for the orchestrator brain only when missing or Edu-owned, removes the other-language Edu-owned dashboard). `vaultPlacement()` added to `location.ts`; `readWorkspaceSettings` now reads `lang`; `openBrain(locations, { projects })` injects the registry.
  - Syntax evidence: https://obsidian.md/help/bases/syntax (filters and/or/not, formulas, `properties.<p>.displayName`, view `filters`/`order`/`groupBy`, `list[0]`, `obj.prop`), https://obsidian.md/help/bases/functions (`file.path`, `file.inFolder`, `string.startsWith/contains/split`, `list.reverse`, `if`, `file.asLink`), https://obsidian.md/help/bases/views (`![[File.base#View]]`). Per-view `sort: [{property, direction}]` is not in the help pages; confirmed in the installed Obsidian 1.14.4 view parser (`case"sort"` accepts `{property|column, direction: ASC|DESC}`). Dot-folders: the same bundle treats any path segment starting with `.` as hidden.
  - Verification: `npm run typecheck` clean; `npx vitest run src/brain src/workspace src/vault` 73 passed / 1 skipped; `npm test` 677 passed / 1 skipped; `npm run build` ok; real run on a copy (`/tmp/edu-v9-*`, temp HOME, rewritten projects.json): global brain → 6 localized Bases (orchestrator filters `file.path.contains("/<tier>/")` + kind, `proyecto` column) and `00-INICIO/Panel.md` linking marca-personal, edu, price-traking; `04-PROYECTOS/marca-personal` → folder-scoped Bases, no dashboard; en↔es switch leaves only the current set and one dashboard. Real ~/Edu and ~/.edu untouched.
  - For the lead: `~/.edu/config.json` has `lang: "en"`, so the real global brain will get the English set and `00-START/Dashboard.md`; set `lang: "es"` there for `00-INICIO/Panel.md`. Not verified: rendering inside the Obsidian UI (T3).
