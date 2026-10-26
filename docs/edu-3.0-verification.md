# Edu 3.0.0-rc.1 verification

This release candidate adds bounded Crew artifacts, configurable run routing and budgets, resumable terminal goals, optional integration checks, worker memory guards, and Windows reliability fixes. The code and generated distribution files are versioned together.

## Verification

The candidate source passed type checking, build, plugin generation checks, focused runtime tests, and a three-platform CI run on Windows, macOS, and Ubuntu before this public snapshot was prepared. The original CI record belongs to a private repository and is not a public verification link. The public repository's CI run for this commit is the source to check before publishing a release.

## Current limits

- Edu 3.0.0-rc.1 is a candidate. Updating a checkout does not update a globally installed Edu binary.
- Run budgets cover invocations Edu controls; they do not cap a CLI's own tools, tokens, or child agents.
- Crew artifacts filter common credentials before persistence, but the filter cannot guarantee removal of all private content.
- Resume replans a terminal goal in the same workspace with fresh approvals; it does not replay prior writes or recover an active run after a crash.
- Optional integrations are inspected only. No external package is installed or enabled automatically.

See the migration guide for installation and upgrade behavior.
