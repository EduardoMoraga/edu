# Edu 2.0 — release gates and implementation boundaries

Status: implementation in progress, NOT a published release. User requests fleet implementation, safe upgrades for existing installations, public personal distribution and private work distribution. Work repository URL, delivery-chain approval and stable release remain publication gates.

## Product contract

Experience -> persisted episode -> repeatable consolidation -> actionable retrieval -> explicit application -> externally checked outcome -> deduplicated feedback -> safe maintenance. Persistent memory is not model-weight training. No claim of general efficiency from unit tests or agent consensus.

- No silent/background paid model calls on update. Explicit LLM reflection remains opt-in; local deterministic consolidation may consume bounded structured evidence without inventing semantic lessons.
- Canonical standards and behavioral skills remain human-approved. Private work memory, credentials and configuration never enter the public repository or mirror.
- Old brains and integrations require tested, repeatable migration with preservation/backups of custom content; no automatic deletion of memory.
- New model-facing capabilities/what's-new output must describe actual version and limitations, not fabricated self-improvement.

## Shared interfaces for the fleet

Existing APIs remain source-compatible where possible. Lead owns integration and packaging. Brain owner may add optional `FeedbackContext { eventId: string; verified: boolean; evidence?: string[] }` as the third argument to `Brain.feedback`. Only trusted runtime callers with externally checked outcomes may set verified; MCP advisory feedback must not expose this authority. Separate exposure from confirmation; deduplicate evidence events. Legacy brains retain content and accepted/proven statuses, without retroactively inventing verified evidence.

Reflection owner may export `consolidatePending(brain, brainRoot, options?)`: bounded, local/no-LLM processing of queued structured intervention evidence with per-entry acknowledgement and retry safety. Existing `reflect` remains explicit model-assisted consolidation, with complete validation before mutation and idempotent resumable writes. Lead wires the consolidated API after worker completion; other workers must not invent competing signatures.

The orchestration owner removes duplicate support context and prepares result-linked feedback only for notes actually supplied AND explicitly cited/applied AND covered by completed deterministic verification. No blanket reward to every included note and no causal-efficiency claim.

## Ownership (shared checkout; no worker commits/build-generated files)

1. Reflection: src/reflect/* and its tests; no CLI/brain edits.
2. Actionable context: src/context/* and snapshots/tests; no search/brain edits.
3. Retrieval: src/brain/search.ts, resolve.ts and focused new retrieval tests; no brain.ts/learning.ts.
4. Credit/lifecycle: src/brain/brain.ts, learning.ts, frontmatter.ts and tests; UsageStats/FeedbackContext in contracts only.
5. Sessions/MCP: src/mcp/server.ts, src/cli/hooks.ts and tests; no core/reflect/template edits.
6. Pi/protocol: templates/pi/edu.ts, templates/EDU.md, templates/skills, templates/commands, src/adapters/common.ts and focused tests; no generated plugins.
7. Orchestration efficiency: src/orchestrator/run.ts and tests; no core/evidence edits.
8. Evidence correctness: src/evidence/*, src/cli/commands/evidence.ts and tests; preserve OutcomeLabel union.
9. Update/migration/capabilities: src/update/*, src/cli/commands/update.ts and tests, new src/release/*; no package/version/program/generated-plugin edits.
10. Evaluation: new src/eval/*, src/cli/commands/eval.ts and tests; CLI program registration coordinated with lead. No nested model launches.

Do not edit someone else's owned files without agreement. Workers may request integration changes in their reports. Use existing dependencies only, focused behavior tests, maxWorkers=1 or 2. Reproduce a failure before fixing it; don't merely grep implementation source in tests.

## Release gates

- Fresh install plus upgrade from 0.10.2, repeat update/migration, custom identity/brainDir/skills preserved, global + registered project brains, missing/broken project isolation, Unix and Windows path contracts.
- Diagnostic failures fixed as production regressions, full suite/typecheck/build/plugin generation/package-install smoke pass. Independent cross-vendor review, security/privacy inspection and coherent reviewable commit/PR slices.
- Eval reports distinguish native clean, Edu cold, static memory and adaptive memory; same model/harness comparisons, external correctness, all costs including acquisition/reflection and honest missing-data/insufficient-sample states.
- Actual LLM pilot requires controlled clean sessions; no fabricated benchmark, no extrapolation to inaccessible Gemini/Kimi.
- RC before stable publication is proposed, awaiting owner approval. Lead may set an internal `2.0.0-rc.1` package version to exercise the actual major-upgrade path in temporary installs; this is not publication or stable approval. No premature latest tag or npm publication.
- Verify exact remote identity/permissions/visibility before any publication. Never pull private work data into the personal public source. No force-pushes. Pull/rebase before every push.

Open decisions: work repository URL; PR-chain/RC approval; explicit policy for paid automatic reflection if requested later. The phrase 'best implementation' is a quality goal, not a guarantee of bug-free software or universal efficiency.
