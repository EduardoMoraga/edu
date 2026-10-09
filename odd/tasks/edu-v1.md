# Feature: edu-v1

**Objective:** Ship Edu v0.1 — an installable, LLM-agnostic agentic harness (identity, self-improving
second brain, context budget, orchestrator solo→crew, live TUI) — to github.com/EduardoMoraga/edu.

**Problem / why:** Existing harnesses (gentle-ai, Firstmate, MORAGENT, Albert) each solve a slice and
stack badly (overlapping memories, competing orchestrators, bloated instructions). Edu is one clean
product taking the best of each. Spec: `docs/ARCHITECTURE.md`.

**Constraints:** TypeScript, Node ≥22, ESM; files-first brain; reversible installs; single-LLM first;
instructions < 1.5k tokens; workers stay in their module paths; lead commits.

**Delivery strategy:** auto-chain on `main` of a new repo (initial product build; no prior base).
Work-unit commits per integrated wave.

## Tasks

| ID | Task | Route | Owner | Status |
|---|---|---|---|---|
| E0 | Scaffold, contracts, spec, CI-less check | inline (lead, spec work) | lead | ✅ |
| E1 | Brain core: store, frontmatter, lifecycles, recall+learned weight, maintain, index, importers | delegated (mora → codex) | backend | ✅ |
| E2 | Engines: 5 CLI adapters, stream normalization, FakeEngine, fixtures | delegated (mora → codex) | backend | ✅ |
| E3 | Identity + TUI (Ink) against EduEvent, demo/replay | delegated (mora → claude) | frontend | ✅ |
| E4 | Tooling: CI (macOS+Linux), smoke-install script, packaging | delegated (mora → pi) | dev | ✅ |
| E5 | Context budget + MCP server | delegated (mora → codex) | backend | 🔄 |
| E6 | CLI integrations installer/uninstaller + hooks | delegated (mora → codex) | backend | 🔄 |
| E7 | Orchestrator (solo/crew, approvals) + reflect | delegated (mora → codex) | backend | 🔄 |
| E8 | CLI commands wiring + README/docs | delegated (mora → claude) | frontend | ☐ |
| E9 | Audit: cross review (agy) + independent verification (pi); fix round | delegated | helper, dev | ☐ |
| E11 | Evidence layer (episode packages, H3 workflow, ladder H0–H3, AVSR/M-HIR metrics) per arXiv:2605.13357 | delegated (mora → codex) | backend | ☐ |
| E10 | Publish: GitHub repo, push, tag v0.1.0 | inline | lead | ☐ |

Waves: W1 = E1, E2, E3, E4 (parallel, disjoint paths) · W2 = E5, E6, E7, E8 · W2b = E11 (after E7) · W3 = E8, E9 · W4 = E10.

## Acceptance
See `docs/ARCHITECTURE.md` §14.

## Progress / evidence
- E0: `npm run check` green (typecheck, 2 tests, build). Crew smoke: codex ✓, agy ✓, pi ✓ after
  upgrading pi 0.85.1 → 0.99.2 (gentle-pi extension requires ≥0.99.1).

- W1 (T-0004..T-0007): brain 17 tests, engines 37, identity+tui 116, tooling smoke ✓. Lead verification:
  typecheck clean, 172/172 tests, build ok, `scripts/smoke-install.sh` passed. Commits d286987, bd0913b,
  e15d0b9, 676d9f3; contract change 8e8627e (context.usage event, usage = delta) per frontend request.
- W2 dispatched: T-0008 (E5), T-0009 (E6), T-0010 (E7), all Codex in parallel on disjoint paths.

## Next step
Integrate W2, then E8 (CLI wiring + README) and audits.
