# Feature: edu-v2 — plugin-first

**Objective:** Edu lives inside the CLI each person already uses (Claude Code, Codex, Pi, OpenCode,
Gemini/Antigravity; DeepSeek through OpenCode/Pi providers). Opening the favorite CLI gives Edu's
identity, second brain, slash commands and crew orchestration natively. One command sets it all up.

**Problem / why:** v0.1 led with its own terminal UI. User test (2026-10-09): the shell experience is
poor (truncated text, hard to type, no options panel) and misses the real goal — maximize each
person's favorite agent, like gentle-ai / Firstmate do, from inside that agent.

**Scope:**
- `edu setup` (and bare `edu` on first run): detect CLIs, install Edu globally into each one
  (native plugin/extension/package where the CLI has one; managed files otherwise), global brain,
  clear summary. Reversible (`edu uninstall`).
- Native packaging per CLI (formats verified in research R0): Claude Code plugin + marketplace in
  this repo; Codex prompts + skills + MCP; Pi package; OpenCode commands + agents + MCP;
  Gemini/agy extension.
- The same slash-command set everywhere: brief, recall, remember, reflect, crew, review, status.
- Crew orchestration from inside any CLI via MCP tools: `edu_crew_dispatch` (task → another CLI,
  headless or in a visible herdr pane), `edu_crew_status`, `edu_crew_result`; cross-vendor review.
- TUI demoted to optional mission control (`edu watch`): wrapped text (no truncation), multi-line
  composer, `/` options palette, Spanish auto-detected from the locale.

**Constraints:** formats must be verified against installed CLIs/docs, never guessed; installs
reversible; everything in v0.1 keeps working; Windows + macOS + Linux CI.

## Tasks

| ID | Task | Route | Owner | Status |
|---|---|---|---|---|
| R0 | Research native plugin formats per CLI + herdr agent API | delegated (explorer) | lead | 🔄 |
| P1 | Spec §16 plugin-first + contracts | inline (lead) | lead | ☐ |
| P2 | Crew MCP tools (dispatch headless / herdr pane, status, result, review) | delegated (mora → codex) | backend | ☐ |
| P3 | Native packaging: Claude plugin + marketplace, Codex, Pi package, OpenCode, Gemini/agy extension; `edu setup` | delegated (mora → codex) | backend | ☐ |
| P4 | Shared slash-command/prompt set + identity per CLI; README rewrite plugin-first (en/es) | delegated (mora → claude) | frontend | ☐ |
| P5 | Mission-control TUI fixes: wrapping, multi-line composer, `/` palette, es locale | delegated (mora → claude) | frontend | ☐ |
| P6 | In-CLI acceptance: real headless calls inside each CLI using Edu tools (pi), cross review (agy) | delegated | dev, helper | ☐ |
| P7 | Fix round, CI 3 OS, release v0.2.0 | lead | lead | ☐ |

## Acceptance
- On a clean HOME: `npm i -g …` + `edu setup` → each installed CLI shows Edu's commands and can call
  `edu_brief`/`edu_recall` (verified with a real headless call per CLI that is logged in).
- From Claude Code, `/edu:crew` dispatches a task to Codex and returns its result; with herdr present
  the worker is visible in a pane.
- Claude Code: `/plugin marketplace add EduardoMoraga/edu` + `/plugin install edu@edu` works.
- `edu watch` shows wrapped text, a usable composer and an options palette.
- `npm run check` green on Linux, macOS, Windows.

## Progress / evidence
- v0.1.1 shipped (composer focus + ctrl+c fix) after user report.

## Next step
R0 results → spec §16 → dispatch P2–P5.
