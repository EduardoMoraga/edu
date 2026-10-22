# Edu 2.1 delivery

Implement the accepted Harness2 audit recommendations as a compatible, installable release. Ship source to EduardoMoraga/edu main and publish GitHub stable 2.1.0 only after independent review and cross-platform validation. The owner explicitly requests unattended implementation, fixes, testing and publication.

## Scope

- A: Preserve usage completeness from parsers through aggregation/rendering; expose effective autonomy capabilities and avoid treating unsupported readonly adapters as enforced concurrent readers.
- B: Validate and install skill bundles with their helpers, containment and ownership checks; preserve custom files and explicit human acceptance.
- C: Provide opt-in bounded baseline/candidate experiments, execution-linked evidence and reproducible manifests. Require explicit trust before executing supplied commands; disposable directories are workspace copies, never an OS/network sandbox. No background paid model calls or automatic activation of a proposed harness.
- D: Release 2.1.0 with accurate capabilities, documentation, committed generated outputs, fresh installs and upgrades from published 0.10.2 and 2.0.0-rc.1.

## Progress

- [x] A — usage and autonomy regression tests, compatible implementation, focused verification.
- [ ] B — bundle behavioral regressions, managed installation/removal/custom preservation, focused verification.
- [ ] C — experiment CLI, input/check integrity, bounds/cancellation/fallback/reuse tests and documentation.
- [ ] D — independent review, full checks, package inspection, Linux/macOS/Windows CI, verified main push and stable release/download check.

## Requirements

Use existing dependencies and patterns. No private memory, credentials, generated backups or work-only data may enter the release. Keep conventional commits without attribution. Do not weaken tests or silently skip required checks. A failing check requires diagnosis and a correction, not reruns until lucky. Existing opt-in private-vault tests may retain their documented missing-fixture skip.

Installation must preserve user identity, custom skills, brain paths and notes. Confirm version/capabilities from the installed package. Support source installation and real old-updater execution against the new package; do not require the owner to create tokens or run validation steps.

## Verification

Use observable failing regressions before behavior fixes when feasible. Run focused tests per work unit. At closure run typecheck, full tests with bounded workers, plugin generation/checks, build, package privacy/version inspection, fresh-install smoke and both published-version upgrade smokes. CI must pass on Linux/macOS/Windows for the release commit before publishing.

The no-mistakes and gentle-ai executables and Edu memory tools are unavailable in this runtime. Independent Cloudroom reviewers and real checks will supply evidence; no native review receipt or memory synchronization is claimed. This document retains recovery state.

## Current evidence

Starting source: a7b57e632cb9750375ca7983b07b43c286fa6d48, package 2.0.0-rc.1. Public main was ab405fa (0.10.2). GitHub authorization includes repo/workflow. Existing audit: audit/harness2-comparison-2026-10-22.md. No implementation checks have been claimed yet.

Baseline typecheck passed. The initial Node25 test run reported 1,020 passes, five failures and one opt-in private-vault skip; all five failures were traced to verifier-injected EDU_HOME or inherited caller-detection variables. A clean isolated Node22.23.3 ARM64 run of seven relevant OpenCode cases passed with setup/installer sources unchanged. Do not relax upgrade guards based on those environmental failures. Use isolated HOME, unset EDU_HOME and caller variables for subsequent verification. Existing CI-pinned Pi1.2.0 fixture: /tmp/edu-v2-pi-api/node_modules/@earendil-works/pi-coding-agent.

Published upgrade fixtures downloaded and verified: 0.10.2 SHA256 0cc31fa000265bd2a4cdba32fa76b558fd741b9d47442954d8f8a9b44fa12fbc; 2.0.0-rc.1 SHA256 45a5f921e65f766aefc6021d1faa8b3af22a2812d8fc2007cc88e12475a7b573. Packages reside under /tmp/edu-2.1-release/baseline-*.

Release preparation found the native plugin refresh baseline must recognize the checksum-verified published RC tree as well as 0.10.2. D must add immutable version-keyed Claude/Codex provenance where required, preserving complete-tree equality, Windows localized-byte checks, backups and pre/post-mutation verification. Never trust hashes read from the installed cache. Parameterize smoke-upgrade with the expected old package version and separately read plugin versions; execute each real updater. Add a fresh source-install smoke that builds in a clean exported source directory, installs to an isolated prefix with install-links, then renames the source and verifies the installed CLI/MCP still work. Keep baseline packages separate from installer asset globs.

A self-verification: observable REDs for missing usage and unsupported-readonly overlap; final 421 tests in 51 files passed on Node22.23.3 ARM64 with isolated HOME and sanitized caller variables. Typecheck and diff check passed. Numeric Usage fields remain compatible, with additive knownness/raw fields, invocation identity/purpose and replay deduplication. Historical unmarked usage remains unknown; incomplete evaluation means can be null. Independent review and full release validation remain under D. Logs: /tmp/edu-2.1-A/.
