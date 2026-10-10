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
- [ ] T1 Bases generator: localized set, orchestrator vs workspace scope, formulas, display names, views, cleanup of legacy files — delegated writer
- [ ] T2 Dashboard note generation — same writer
- [ ] T3 live verification in Obsidian (screenshots) + migrate 03-LAB brains — lead
- [ ] T4 release v0.9.0 via edu update — lead

## Progress
