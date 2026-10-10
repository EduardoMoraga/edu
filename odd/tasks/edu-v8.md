# edu-v8 — Self-contained workspaces, one-command install/update, Telegram via Hermes

**Objective:** a friend installs Edu with one line, points it at a document, and gets a self-contained, Obsidian-ready workspace whose agent (e.g. "Albert") knows their operation; Edu updates itself; Eduardo chats with his workspaces from Telegram through Hermes.
**User goal (/goal):** everything installed and operational on Eduardo's MacBook.
**Delivery:** ask-on-risk; three slices (P1 → P2 → P3), each its own commit set on feat/v08-workspaces; release v0.8.0 at the end.

## Design decisions (lead)
- Workspace = the unit. `edu create <docs...> --name <Agent> [--dir] [--cli] [--lang] [--no-llm]` creates `<parent>/<slug>/`:
  - `00-INICIO/` (README / Home: what this is, how to use, agent name)
  - `01-CONOCIMIENTO/` = the brain, visible (canonical / episodic / transitive / index + `fuentes/` with the original documents)
  - `02-ENTREGABLES/`, `03-LAB/`, `04-PROYECTOS/`, `05-ARCHIVO/`
  - `.edu/` (config with `brainDir`, identity name, playbooks, runs, state)
  - `.obsidian/` (minimal config; the workspace folder itself is the vault; ignores `.edu`)
  Folder names follow the language (es: names above; en: 00-START, 01-KNOWLEDGE, 02-DELIVERABLES, 03-LAB, 04-PROJECTS, 05-ARCHIVE).
- Extraction: the person's installed CLI headless (claude/codex/pi/opencode, first available or `--cli`) reads the documents and returns structured JSON (identity, canonical notes, glossary, playbooks). Facts stated in the source → canonical `accepted` band `verified` with source; interpretations → `proposed`. `--no-llm` = deterministic split by headings (tests + offline).
- Inputs: .md .txt .docx .pdf (docx via a small dependency; pdf via `pdftotext` if present else a JS fallback). Never modifies sources.
- No separate EduVault: each workspace is its own vault. Code repos keep the hidden `.edu` brain.
- `edu update`: latest GitHub release → install → `edu setup --yes` → migrate registered workspaces → what's new.
- One-line installer (scripts/install.sh / install.ps1 exist): installs Node if missing, Edu, setup; prints `edu create` next step.
- Hermes: `edu connect hermes` adds `mcp_servers.edu` to ~/.hermes/config.yaml (comment-preserving), `edu mcp --project <name|path>`/EDU_PROJECT plus MCP tools to list/switch registered workspaces, so Telegram can pick "albert". Crew dispatch from Hermes works headless and, when a herdr server is reachable, in a visible pane.

## Tasks
- [ ] P1a brain dir configurable + workspace layout + `edu create --no-llm` + registry + Obsidian config — route: delegated writer
- [ ] P1b LLM extraction (headless CLI) + docx/pdf readers — route: same writer
- [ ] P1c migrate this Mac: ~/Edu/marca-personal to the new layout, retire ~/EduVault (backup) — route: lead, live
- [ ] P2 `edu update` + installer one-liner refresh — route: delegated writer
- [ ] P3 `edu connect hermes`, `edu mcp --project`, project tools, remove dead engram MCP from Hermes — route: delegated writer
- [ ] P4 release v0.8.0, install, live check: create a workspace from a real doc, open Obsidian, Claude answers as the agent, Telegram → Hermes → Edu recall + crew dispatch — route: lead

## Progress
