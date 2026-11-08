# Edu 5.0.0

Memory that costs less context, finds more across Spanish and English, is safe to share between local
and cloud agents, and installs in one command. The plan and its sources are in
[EDU-5.0-PLAN.md](EDU-5.0-PLAN.md). The rule was measure first, change one thing, keep what improves.

## What changed

| Area | 4.1 | 5.0 |
|---|---|---|
| Measurement | Rule-based eval suite only | `edu bench`: retrieval (recall@k, MRR per class, `--corpus`), context cost, brief stability; `edu bench activation` for live agents |
| Recall | BM25, 8 synonym groups | ES/EN stemming, ~490 ES↔EN concept groups, typo fallback, query coverage, title and kind cues; `alt` rephrasings fused with RRF |
| Recall side effects | Rewrote the frontmatter of every hit (git churn, sync conflicts) | Writes only `.edu-local/usage.json`, a local file that is never synced |
| Brief | Order moved with recency; differed after any recall | Content-only order; byte-identical after a recall; points to `0-index/catalog.md` |
| MCP tool definitions | 3701 tokens (19 tools) | 2609 tokens, same names, with the new `links`, `supersedes`, `session` and `alt` params |
| Writing | Append a note | `edu_remember` links related notes, reports possible contradictions with a `supersedes` hint, redacts secrets, records host, agent and session |
| Index | `INDEX.md` | Plus `catalog.md` (one line per note, missing pages) and append-only `log.md` |
| Health | `edu brain tidy` | Plus `edu brain lint` (orphans, missing pages, contradictions, stale claims, duplicates) and `edu dream` (batch consolidation plan with evidence and prevalence) |
| Concurrency | Locks | Plus hash-guarded updates: `edu_read` shows the hash, `expected_hash` refuses a stale write |
| Ingest (`edu create`) | Auto-accepted notes the model called `verified` | Every note becomes a proposal |
| Sharing | `edu sync` with a repository set up by hand | `edu join <repo>` (machine or cloud sandbox), `edu brain share`, union merge of `log.md`, Windows scheduler |
| Install | Per-host differences; refused when the package moved | `edu setup --yes` prints a table per host; every host gets the brief through a hook; plugins are re-registered after a Node upgrade moves the package; `edu uninstall` restores configs byte for byte |

## Retrieval results

Two corpora:
- **Built-in:** 120 notes and 60 queries, written along with the bench.
- **Held-out:** 100 notes and 80 queries, written independently and never seen during tuning. It is
  `docs/evals/edu-5.0-heldout-corpus.json`. Each query's `alt` is a translation of the query written
  without looking at the notes, which is what an agent does before searching.

| Corpus | Metric | 4.1 | 5.0 | 5.0 with `alt` |
|---|---|---|---|---|
| Built-in | R@1 / R@10 / MRR | 60.0% / 81.7% / 0.668 | 85.0% / 98.3% / 0.900 | — |
| Held-out, all | R@1 / R@10 / MRR | 32.5% / 56.3% / 0.412 | 48.8% / 76.3% / 0.592 | 51.3% / 85.0% / 0.628 |
| Held-out, ES query → EN note | R@10 / MRR | 31.3% / 0.092 | 56.3% / 0.434 | 87.5% / 0.612 |
| Held-out, EN query → ES note | R@10 / MRR | 25.0% / 0.113 | 68.8% / 0.464 | 81.3% / 0.596 |

Raw results are in `docs/evals/edu-5.0-*.json`. Retrieval is still lexical: on the held-out set,
about half of the hard queries put the target below rank 1. Embeddings stay optional future work. Use
them only if this benchmark shows they would pay for a dependency.

## Context results

| | 4.1 | 5.0 |
|---|---|---|
| Brief tokens (budget 1500) | 1499 | 1499 |
| Brief after a recall | Different | Byte-identical |
| Brief across two session starts | Differs only in the session-id line | Same; 98.8% of whole lines shared |
| MCP tool definitions, full profile | 3701 | 2609 |
| MCP tool definitions, memory profile | 2451 | 1756 |

## Live agents

`scripts/agent-matrix.sh` seeds a project with an active decision, a rejected option and a stale
hypothesis, then asks each CLI for the current decision, its evidence, the rejected option, the stale
note and the next safe step. A deterministic grader scores the answer 0–5.

| Agent | How it reached Edu | Activation | Write with provenance |
|---|---|---|---|
| Claude Code 2.1 | Plugin (hook + MCP) | 5/5 | `agent: claude-code` |
| Codex 0.167 | Plugin (hook + MCP) | 5/5 | `agent: codex` |
| OpenCode 2.2 | Managed files (plugin + MCP) | 5/5 | `agent: opencode` |
| GitHub Copilot CLI | MCP only, no integration | 5/5 | Recorded by client name |
| Pi 1.5 | Package (extension + MCP) | Brief, MCP discovery and a real `edu_recall` call checked through Pi with a stub model | — |
| Antigravity 1.5 | Plugin | `agy plugin validate --strict`; SessionStart hook output checked | — |

Pi and Antigravity were not run with a real model: on this machine Pi's OpenAI login fails with
`invalid_grant`, and agy asks for a new login. Run `scripts/agent-matrix.sh` after logging in to
complete the matrix. Cursor Agent, Devin and omp are installed but not logged in.

## Verification

| Check | Result |
|---|---|
| `npm run typecheck` | Clean |
| Full suite (Linux, Node 26) | 1602 passed, 2 skipped |
| `npm run build:plugins -- --check` | Up to date |
| `scripts/install-matrix.sh` | Passes locally (`--local`) and in CI in node:22-bookworm-slim and node:24-alpine containers |
| Real upgrade from 4.1 | All five hosts re-registered to 5.0 after a Node relocation |

## Limits

- The ES↔EN bridge is a curated table, not a translator. Phrases ("base de datos") are not matched as
  units. `alt` covers what the table misses, at the cost of the agent writing one more line.
- Contradiction, stale-claim and recurring-topic detection in `lint` and `dream` are lexical
  heuristics. They are labelled "possible" and never applied without review.
- The MCP server knows the session it opened. A session opened by a host hook is recorded only when the
  agent passes `session` to `edu_remember`.
- Moving a global note into one project (`edu brain share --to project`) hides it from other projects.
