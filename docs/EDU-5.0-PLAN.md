# Edu 5.0 plan

Goal: make Edu's memory measurably more efficient (tokens, context, retrieval quality), safe to share
between local and cloud agents, and installable in one command. Grounded in a review of Karpathy's
LLM Wiki gist, three talks on agent memory (harness/loop engineering; MongoDB agent memory; Anthropic
"dreaming"), Karpathy's "How I use LLMs", and twelve open-source second-brain / memory projects.

Principle: measure first, change one thing, keep what improves (Karpathy autoresearch).

## Phase 0 — Baseline (`edu bench`)
- Retrieval benchmark: deterministic bilingual (ES/EN) corpus with competing notes; keyword,
  paraphrase and cross-language queries; recall@k and MRR.
- Context cost: brief tokens, MCP tool-definition tokens, brief byte-stability across sessions.
- Activation test for live agents: seeded decision, rejected option and stale note; the agent must
  cite the decision and flag the stale note.

## Phase 1 — Quick wins
- Cache-stable brief: volatile lines (session id, timestamps) moved after a stable prefix; prefix hash.
- Exposure counters (recall hits) leave note frontmatter for a local, unsynced ledger; feedback
  (wins/losses) stays in the note. Removes git churn and sync conflicts.
- `edu_remember` accepts `links` and `supersedes`.
- Ingest never auto-accepts canonical notes; everything goes through approval.
- Sync treats the English dashboard as generated.
- Secrets are redacted before any note is written.
- Leaner MCP tool descriptions.

## Phase 2 — Compiled memory
- Compile on write: a new note is linked to related notes and possible contradictions are reported.
- `0-index/index.md` catalog (one line per note) and append-only `0-index/log.md`.
- `edu brain lint`: contradictions, stale claims, orphans, missing pages.
- `edu dream`: batch, scheduled consolidation over recent sessions from every host; outputs
  proposals with evidence and prevalence; nothing is applied without approval.

## Phase 3 — Sharing
- Hash-guarded writes (`expected_hash`): conflict instead of a lost update.
- Provenance on every note: host, agent, session.
- `edu join <repo>`: one command to attach a machine or cloud sandbox to the shared brain.
- `edu brain share <id>`: move a note from the project brain to the shared global brain.

## Phase 4 — Retrieval and install
- Bilingual retrieval: light ES/EN stemming, ES↔EN term bridge, fuzzy fallback; no new runtime
  dependency, no server.
- One-command install for every detected CLI and an exact uninstall; container install matrix.

## Verification
- Unit tests for every change; full suite green.
- `edu bench` before/after numbers in `docs/edu-5.0.md`.
- Live activation test with every installed agent CLI.
- Independent cross-vendor review until no open findings.
