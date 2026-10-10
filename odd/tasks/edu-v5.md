# Feature: edu-v5 — a terminal worth looking at

**Objective:** Edu's standalone view becomes a beautiful, informative "mission control" and a real
conversation partner; and Claude Code users get the same live view as a mod pane inside Claude.

**Problem / why (user test 2026-10-10):** typing "Hola" in `edu` launched a full planning run (every
input is treated as a task; recall 0). The view is a plain list. References the user shared: a
constellation view (orchestrator center, agent cards around it, animated connectors, message bus
log, alert status bar) and Claude Flightdeck (context bar, permissions gate, agents with progress
bars, session log).

## Tasks
| ID | Task | Route | Owner | Status |
|---|---|---|---|---|
| U1 | Conversational home: chat with brain context; tasks detected → orchestrate; /run and /ask | delegated (mora → codex) | backend | ☐ |
| U2 | TUI redesign: constellation, message bus, deck panel, alert bar, theme | delegated (mora → claude) | frontend | ☐ |
| U3 | "Edu Deck" Claude Code mod pane (crew, context, memory, approvals) | lead (plugin engine in this session) | lead | ☐ |
| U4 | Real acceptance + release v0.5.0 | lead | lead | ☐ |
