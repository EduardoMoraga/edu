# Declared skill bundles in Edu 2.1

A skill can remain a single `SKILL.md`. Legacy document-only installations are supported. A skill with helpers or resources declares exactly which files belong to it in YAML frontmatter:

```yaml
---
name: example
description: Run the example's local check.
bundle:
  files:
    - path: scripts/check.mjs
      # Optional SHA-256 of the exact UTF-8 helper bytes:
      # sha256: <64 lowercase hex characters>
    - path: resources/example.json
  references:
    - scripts/check.mjs
  requires:
    - node
  hosts:
    - codex
    - claude
  # Optional existing Edu note IDs, checked during proposal acceptance:
  # evidence: [L-example]
---
Run `node scripts/check.mjs` from this skill's directory.
```

Only `SKILL.md` and declared files are read and copied. Undeclared siblings, including private files, are not collected. Helper contents are not executed by validation or installation. Use an explicit interpreter command such as `node scripts/check.mjs`; installation does not grant executable permissions or install requirements. Missing commands and unsupported explicitly selected single hosts fail before installation writes. Multi-host plans skip unsupported hosts with plan/report notes while still validating bundle structure and requirements; compatible hosts receive the bundle.

For explicitly declared bundles, the validator checks portable relative paths, hashes when supplied, declared references and relative Markdown links, UTF-8, and bounds. Legacy document-only YAML, document size and prose links remain unchanged, including malformed historic YAML; new explicitly declared bundles and accepted proposals remain strict. Prose links include code-free Markdown only; fenced and inline code examples are ignored. Legacy links remain unchanged, including links to project documentation outside the skill; those targets are never read or copied. Paths use `/`, contain ordinary ASCII filename segments, and exclude traversal, absolute/drive paths, backslashes, Windows device names, case collisions and file/parent collisions. Each bundle has at most 64 files including `SKILL.md`, each resource is at most 256 KiB, `SKILL.md` is at most 64 KiB, and the total is at most 1 MiB. Caller-owned HOME/project/template anchors may be intentional symlink/junction aliases: containment uses their canonical directories. Descendant symlinks, special files and path escapes remain rejected. Unsupported custom skill directory/document paths are skipped individually with plan/report notes, preserved in place, and suppress any same-name builtin; template corruption and declared helper corruption still fail. An unsupported custom source directory suppresses all builtins because overrides cannot be inspected safely.

Structural validation establishes the declared inventory and byte identity. It does not establish that a helper is safe or correct. A declared requirement is an availability check, not permission to run a command. A hash is integrity evidence, not proof of authorship or trust. Metadata and local path checks are not an OS sandbox and cannot prevent every adversarial concurrent filesystem change.

## Managed installation and upgrades

The existing managed installer records every bundle file and its SHA-256 in its ownership manifest. It validates the complete planned bundle before writing, rechecks source hashes and containment when applying, and refuses unowned collisions even when the existing bytes match. Repeating an unchanged installation does not rewrite bundle files or its manifest.

An upgrade may add declared helpers to a bundle whose `SKILL.md` is already owned and unchanged, including legacy installations that tracked only the document. Newly declared paths still cannot replace custom files. Removed helpers are retired only while their bytes match the recorded ownership hash; edited and unrelated files remain intact. Native plugin upgrade provenance and cache guards remain in force.

An unowned collision requires explicit recovery. Review the new proposal, preserve the entire legacy skill directory in a user-selected backup **outside `skills/`**, and retain the old accepted proposal record. Then explicitly accept the reviewed proposal into the now-vacant name. Keep the backup until the new skill is verified. Alternatively, use a new reviewed skill name. Matching bytes do not prove ownership; Edu does not silently adopt them. Ordinary manifest-owned document upgrades continue through the managed installer.

Managed-file application records before-images, original modes, new files/directories, backups and manifest changes. A late failure rolls those changes back in-process. A rollback failure is reported explicitly. This is not crash-safe transactional storage, a global transaction across native host commands, or protection from arbitrary simultaneous filesystem writers.

The plugin generator copies the same declared inventory and preserves helper bytes rather than dropping helpers or changing their hashes through newline normalization. It checks source bundles before replacing generated trees. Generated plugins still require their normal host restart/reload after upgrade.

## Explicit proposal acceptance

Reflection can propose optional `files` (relative path to UTF-8 text), `evidence` (existing note IDs), `hashes` (relative path to SHA-256), and `checks` (`{id, ok, evidence}`) alongside the existing name, rationale and full skill content. Diff-only proposals remain reviewable and cannot be installed as complete skills.

Inspect the full proposal with `edu proposals list --json`. `edu proposals accept <id>` explicitly accepts a complete validated bundle into the brain's local `skills/<name>/` directory. It preserves evidence/check metadata and records computed hashes in the accepted proposal. Local bundle ownership lives in `skills/.edu-bundles.json`; a failure to persist the accepted decision rolls installation back. This does not automatically install the skill globally or activate it in an already running host.

`edu proposals reject <id>` changes only the proposal decision and installs no files. Reflection validates proposal structure, hashes and evidence without requiring its commands to exist on the reflecting machine. Acceptance/installation checks actual command availability; unavailable requirements leave the proposal reviewable and do not force another model call. Acceptance checks cited note IDs and supplied hashes. Recorded check results are declarations with provenance; they are not independently executed or silently promoted to verified learning wins. Existing memory ranking, note lifecycle and human approval remain unchanged.
