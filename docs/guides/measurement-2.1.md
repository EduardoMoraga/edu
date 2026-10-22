# Measurement and host permissions in Edu 2.1

Edu keeps the public numeric `Usage` fields. A number alone does not establish a complete measurement. `known[field] === true` identifies an explicitly observed, complete field; false or absent means unknown or partial. Reported zero is distinct from a placeholder zero. Historical logs are preserved and unmarked usage remains uncertain.

Each actual engine invocation receives an invocation ID and purpose. Its usage observations receive stable IDs so persisted events can be replayed without adding them twice. Retries, planning repairs, review corrections, reflection, and selection are separate invocations when they actually execute. A call reporting no usage emits an unknown observation, including on failure. No selection or reflection call is automatically introduced by measurement.

`sumUsage` retains observed numeric amounts and propagates completeness independently for tokens, cache counts, and USD. It ignores fully duplicated observation IDs and rejects partially overlapping aggregates, which cannot be added safely without their constituent observations. `usageValue` returns null for incomplete measurements. Terminal displays show `unknown` or an explicitly marked partial amount; JSON evidence uses null for incomplete totals. Cache counts are subsets of normalized input, never added again to a token total.

Adapter mappings retain the original reported values in `raw`. Claude, Pi, and OpenCode mappings add separately reported cache input to their uncached input. Missing cache observations leave that normalized input incomplete. Codex input already includes cache. Antigravity input semantics remain unconfirmed and its input is marked unknown. These mappings are protocol interpretations, not proof of invoice accuracy or universal behavior across provider versions. Output is retained as reported. A reported engine USD amount is not automatically a provider-billed invoice; Edu never estimates missing billing or converts token counts to dollars.

Recorded evaluation trials keep their existing numeric cost format. Recorders exporting incomplete observations must supply `costs.known` with false for each incomplete input, output, acquisition, reflection, or billed-USD field. Older evaluation records without this map retain their explicit numeric recording contract. Incomplete trials remain in outcome denominators, but incomplete resource totals do not produce token or USD comparisons. Synthetic memory-suite results remain distinct from measured model experiments.

Explicit reflection stores an attempt ledger beside its validated output journal. Cached output reuses the same usage receipts and does not charge another invocation. Failed attempts stay in that ledger; an attempt without observations remains unknown. Estimated prompt-budget tokens are separate from reported usage. Reflection receipts are returned in the reflection report, not silently attributed to unrelated task episodes.

## Host permissions

Engines expose `capabilities.readonly`, its mechanism when supported, and limitations. The Claude adapter requests plan permission mode; Codex requests read-only mode. Pi, OpenCode, Antigravity, and custom engines without a capability declaration provide no Edu readonly-enforcement guarantee.

The orchestrator resolves the actual selected engine before grouping steps. Concurrent steps in a shared workspace require both an independent readonly role and an engine declaring readonly enforcement. Unsupported engines continue to work serially, with the limitation recorded in the episode package. Ordinary chat, extraction, review, and host integration flows remain available.

An embedding caller may set `requireReadonly: true` on `EngineRunRequest`; unsupported enforcement fails before the adapter executes. `requireSandbox: true` is rejected by every current engine. Host permission modes and prompts are not an Edu OS or network sandbox, and Edu does not claim they contain arbitrary shell commands.
