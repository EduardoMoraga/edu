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
- [ ] W1: Diagnose Windows CI failures, correct supported test fixtures or report any required production fix, run focused checks, commit the coherent correction, and rerun the cross-platform matrix.

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
