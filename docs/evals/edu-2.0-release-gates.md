# Edu 2.0: evidence required before stable publication

Status: candidate implementation, not a claim of general efficiency. The personal source is public; the work mirror must be positively identified and verified private before publishing there. Private memory and local backups are not release assets.

## Assumptions and evidence

| Assumption | Evidence / gate |
|---|---|
| More stored context automatically improves agents | Rejected: use bounded, actionable retrieval and explicit read. Large-brain timing and budget regressions are required. |
| Exposing or citing a note proves causal benefit | Rejected: exposure, declared application and externally checked outcome are separate signals. Verified feedback is operational support, not causal attribution. |
| Three model opinions justify `proven` | Rejected: advisory feedback cannot promote new lessons. Runtime verified events require unique IDs and actual deterministic outcome evidence. |
| Updating all existing clients is equivalent to fresh install | Rejected: the old 0.10.2 updater invokes the NEW setup before migration. The new setup boundary must itself preserve/back up legacy content. |
| A local lock is correct because one-process tests pass | Rejected: test real child processes and different-summary concurrent closes. |
| Unit test success demonstrates cheaper LLM operation | Rejected: measure matched, externally evaluated trajectories with complete provider usage; missing costs stay missing. |
| A work email uniquely identifies the private target | Unverified: exact repository URL and privacy/permission checks are publication blockers. |

## Research informing the design

- Anthropic, [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents): just-in-time references, structured notes and compaction; choose the smallest high-signal context rather than adding memory indiscriminately. Over-aggressive compaction can lose details. These are design principles, not proof of Edu's performance.
- OpenAI, [Trace grading](https://developers.openai.com/api/docs/guides/trace-grading): inspect and evaluate end-to-end behavior, not only the final answer or agent verdict. Edu's local evaluation format is provider-independent.
- MCP, [Tool annotations as risk vocabulary](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/): annotations are hints, not authorization. The external MCP feedback surface must not grant internal verified-feedback authority.

Read during this implementation. No private user data was sent as search input. Research does not replace real measurements on available models.

## Gates

1. **Behavioral regressions:** reproduction before fixes; no weakened safety tests, no passing by increasing context limits or silently skipping failures.
2. **Independent review:** opposite-vendor review; fix confirmed data-loss/concurrency defects and re-review the fixed boundary. Agent consensus is not an efficiency benchmark.
3. **Automated validation:** full suite, typecheck, generated plugin check, build, package inspection, fresh-install smoke and legacy-upgrade smoke; Windows/macOS execution must be confirmed by CI, not inferred from Linux.
4. **Update:** repeatable backup/checkpoint, custom identity/brainDir/skills preserved, global and registered projects covered, partial migration not reported as success, no paid model call enabled by upgrade. Restart hosts/MCP to replace old tools and loaded instructions.
5. **LLM evaluation:** clean native, cold Edu, static memory and adaptive memory; same model/provider/harness and matched tasks/repetitions. Include acquisition, consolidation, failures, retries, cache and human help. Report insufficient sample or missing usage, not savings. Deterministic fixtures with abstaining baselines are not native model benchmarks.
6. **Publication:** owner approval for delivery/RC strategy; exact reviewed commit and green CI; verify work remote is private; no private brains, credentials or work-only artifacts in public source. Never force-push.

## Limits that must remain user-visible

Memory does not train model weights. Externally supported feedback does not prove a memory caused success. Structured local consolidation can record observed interventions, not invent a reliable remedy from arbitrary transcript text. Model-assisted reflection remains explicit and bounded. Human acceptance is still required for canonical standards and behavioral skills. No universal guarantee of speed, accuracy, cost or absence of defects.

A stable 2.0 release cannot be justified solely by these unit tests or this document. RC delivery and real model pilots are separate decisions; no latest/stable publication while material gates remain open.
