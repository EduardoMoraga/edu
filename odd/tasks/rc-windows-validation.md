# RC Windows validation

## Objective
Publish the authorized Edu 2.0.0-rc.1 candidate to EduardoMoraga/edu after cross-platform validation.

## Problem and scope
GitHub CI run 39416775153 passes Linux but reports four Windows failures in setup upgrade fixtures and the cross-process file-lock test. Diagnose and correct the failing contract without weakening production safety checks or skipping tests.

## Constraints
- Preserve all unrelated changes and existing release package behavior.
- English artifacts and Conventional Commits; no AI attribution.
- No private-repository operations in this task.
- Engram mirror unavailable in this runtime; synchronization pending.

## Tasks
- [x] W1: Diagnose Windows CI failures, correct supported test fixtures or report any required production fix, run focused checks, commit the coherent correction, and rerun the cross-platform matrix.
- [x] W2: Investigate the macOS concurrency-test failure in corrected CI 39417671185 and remove any timing dependency while preserving concurrency and dependency-order assertions. Production changes require separate diagnosis.
- [x] W3: Correct the Windows ESM preload specifier in scripts/smoke-upgrade.mjs and preserve the complete legacy-upgrade smoke contract.

## Route and authorization
W1 uses delegated direct execution because diagnosis prepares edits in two non-trivial test files. The user authorized RC publication and the preceding multi-agent implementation. Initial allowed surfaces: src/platform/file-lock.test.ts and src/setup/upgrade.test.ts. Forecast: approximately 100 authored changed lines; delivery strategy ask-on-risk, below the current task budget.

## Acceptance and checks
- Preserve the purpose and assertions of all four failing cases.
- Use observed Windows CI failure as RED evidence; Linux alone cannot establish Windows GREEN.
- Focused command: npx vitest run src/platform/file-lock.test.ts src/setup/upgrade.test.ts --maxWorkers=1.
- Typecheck: npm run typecheck.
- Structural check: git diff --check.
- Full cross-platform CI must pass before RC publication.

## Evidence and next step
Original candidate commit: 859eac16557307a78824158d6c73aac1035cdd7b. Windows failure log: /tmp/edu-v2-public-release/windows-failed.log. Native gentle-ai assessment tooling is unavailable in this environment; independent verification required after writer self-checks.

The lock test passed an absolute Windows drive path to an ESM import instead of a file URL. Three upgrade tests used a development checkout that correctly failed the Windows installed-package guard before reaching their intended assertions. The correction uses a file URL and temporary installed-package fixtures, exercises both platform branches, and retains all assertions. No production or packaged files changed.

Writer verification: focused tests 24 passed; typecheck exit 0; diff check exit 0. Parent structural readback and repeated diff check passed. Independent verification and corrected cross-platform CI pending. Original CI passed Linux and macOS completely and failed Windows (four tests).

W1 correction commit: 7c184d4b5c1bbb0a82ac0f8518aaa4fbf8414c81. Independent verifier observed 24 passing focused tests and no severe issue; production safeguards unchanged. Corrected matrix 39417671185 reported a macOS failure in the pre-existing orchestrator DAG concurrency test (expected peak 2, observed 1); W2 is delegated direct because test diagnosis prepares the edit. Additional forecast approximately 50 lines, still below the per-task delivery budget. Log: /tmp/edu-v2-public-release/macos-job.log.

W2 diagnosis: a fixed 20 ms sleep assumed both reader engines entered within that window, despite awaited persisted events before engine entry. A controlled callback delay reproduced the exact failed assertion while orchestration succeeded. The test now requires both readers to enter a Promise barrier before either can finish. All existing concurrency and dependency-order assertions remain. Writer checks: 26 focused tests passed, typecheck exit 0, diff check exit 0. No production changes. Independent verification and native macOS confirmation pending.

W2 commit: 91d84ab3bd02c0beb727ba8d610712a58fcd4f63. Independent verification passed 26 tests and found no severe issue. W3 native RED evidence: Windows in run 39417671185 passed the full test suite, build and fresh install, then the smoke script passed an absolute drive path to node --import and failed ERR_UNSUPPORTED_ESM_URL_SCHEME before the legacy updater ran. Log: /tmp/edu-v2-public-release/corrected-failed.log. W3 uses delegated direct preparation/edit of one smoke script, forecast under 20 lines. The release package remains unchanged.

W3 writer changed only the preload specifier to pathToFileURL(fixture).href. Full Linux upgrade smoke passed against published 0.10.2 and the audited RC tarball; node --check and git diff --check passed. Five preserved files, custom pointer, repeatable migration, and one native fixture refresh were verified. Independent readback and final native matrix pending.

## Final outcome

W3 commit: d1e124c7035a2e627c37e01645af636341bae2f8. Independent verification passed and found no severe issue. Parent repeated node syntax and diff checks. All three corrections change test/smoke fixtures only; packaged files are identical to the original audited candidate. Native review assessment remains unavailable; no review receipt is claimed.

Final CI https://github.com/EduardoMoraga/edu/actions/runs/39418508693 passed Linux, macOS and Windows on d1e124c, including the full suite, typecheck, generated files, build, fresh install, upgrade from published 0.10.2, platform installers and MCP smoke. Earlier failures and their corrections are retained above rather than hidden by reruns.

Published https://github.com/EduardoMoraga/edu/releases/tag/v2.0.0-rc.1 as a prerelease targeting that exact CI commit. Both the package and SHA256SUMS were downloaded from the published release and verified: 45a5f921e65f766aefc6021d1faa8b3af22a2812d8fc2007cc88e12475a7b573. Stable latest remains v0.10.2. Install the RC explicitly with edu update v2.0.0-rc.1, then restart the host and MCP server.

Scope completed: personal GitHub RC publication. Main was not merged. Private mirror access and chained PR strategy/size exceptions remain outside this completed publication task. Native host reload and efficiency claims still require separate evidence. Engram and Edu tools remain unavailable in this runtime, so the memory mirror and session-close synchronization are pending; this committed document preserves the session outcome.
