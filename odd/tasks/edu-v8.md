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
- [x] P1a brain dir configurable + workspace layout + `edu create --no-llm` + registry + Obsidian config — route: delegated writer
- [x] P1b LLM extraction (headless CLI) + docx/pdf readers — route: same writer
- [ ] P1c migrate this Mac: ~/Edu/marca-personal to the new layout, retire ~/EduVault (backup) — route: lead, live
- [ ] P2 `edu update` + installer one-liner refresh — route: delegated writer
- [ ] P3 `edu connect hermes`, `edu mcp --project`, project tools, remove dead engram MCP from Hermes — route: delegated writer
- [ ] P4 release v0.8.0, install, live check: create a workspace from a real doc, open Obsidian, Claude answers as the agent, Telegram → Hermes → Edu recall + crew dispatch — route: lead

## Progress

### 2026-10-10 — P1a + P1b (delegated writer)
Commits: `f7fed4c` feat(brain): configurable brain directory and workspace agent identity · `601ed7e` feat(create): build self-contained workspaces from documents · `a345832` docs(create).
- **Resolver.** `src/brain/location.ts`: `brainPath(loc)`, `withBrainDir()`, `resolveBrainDir()` (relative to the workspace root, must stay inside it, default `<.edu>/brain`). `resolveBrainLocations` fills `brainDir` from `.edu/config.json`; store, index + `.base` folders, `init`, deck, registry, vault links, `edu brain link`/doctor and the Claude Deck mod (`$.fs` reads `brainDir` from `.edu/config.json`) all go through it. Pi/OpenCode decks read `edu deck --json`, so they follow. The auto-maintain stamp stays in `.edu/state/` (not brain data).
- **Identity.** `identity: {name, role?, tone?, summary?}` in config; `identityName()` prefers it; the brief/identity core opens with "You are **Albert**, this workspace's agent, powered by Edu…".
- **`edu create`** (`src/workspace/*`, `src/cli/commands/create.ts`): layout es/en, sources copied to `01-…/fuentes|sources`, README home, `.obsidian/{app,appearance,workspace}.json` (ignores `.edu/`, opens the README), root AGENTS.md/CLAUDE.md managed block, registry. Non-empty target refused without `--yes`. `--add` ingests into the nearest workspace; title collisions get a `(source)` suffix.
- **Readers.** .md/.txt; .docx by reading the ZIP central directory + `zlib.inflateRawSync` (no dependency; mammoth would add 8 packages for HTML we don't use); .pdf via `pdftotext`, else `unpdf@^1.8.1` (zero deps); clear errors for missing reader / scanned PDF.
- **LLM extraction.** First of claude, codex, pi, opencode (or `--cli`) through the crew engines (stdin prompt, readonly autonomy, empty temp cwd). zod schema, one retry with the error, chunks of 24k chars merged with title/playbook/term dedupe, fallback to the heading split with a warning. verified → canonical accepted; inferred → proposed. Playbooks → `.edu/playbooks/<slug>.md` (valid for `loadPlaybook`); glossary → one lexicon note. Tests use FakeEngine/injected runners only.

Verification (all on this branch):
- `npm run typecheck` ✓ · `npm test` → 84 files, 625 passed, 1 skipped · `build-plugins.ts --check` → up to date · `npm run build` ✓.
- E2E in `/tmp/edu-e2e-IhpH` with `EDU_HOME` pointing at a temp registry (real `~/.edu/projects.json` untouched):
  - `create operacion.md equipo.docx (python-docx) --name Albert --no-llm --yes` → 8 accepted notes, sources copied, sha1 of inputs unchanged.
  - `create operacion.md --name Albert --cli claude` (real claude, 38 s) → 9 accepted, 0 proposed, 4 glossary terms, 1 playbook (`visita-sala`); identity role/tone/summary filled by claude. Registry reported the slug conflict honestly (same temp registry).
  - `deck --json --cwd <ws>` → `{"identity":"Albert","brain":{"present":true,"canonical":8,…}}`.
  - `hook session-start` → "You are **Albert**, this workspace's agent, powered by Edu."
  - PDF: `pdftotext` path and the `unpdf` fallback (PATH without poppler) both produced workspaces.
- Not verified: an interactive claude/codex session opening the workspace (depends on the installed plugin/hook; covered by the hook output above), Obsidian actually honoring `workspace.json` on first open, Windows paths.

