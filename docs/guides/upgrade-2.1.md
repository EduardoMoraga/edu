# Install and upgrade Edu 2.1

Edu 2.1 keeps existing brains, identities, notes, custom skills and brain pointers. It adds explicit usage completeness, declared skill bundles and optional trusted-command experiments. Experiments do not run during installation or upgrade.

## Install from a source checkout

Use Node.js 22.19 or newer for this development/build workflow:

```bash
git clone https://github.com/EduardoMoraga/edu.git
cd edu
npm ci --include=dev
npm run build:plugins -- --check
npm run build
npm install --global --install-links .
edu setup --yes
edu --version
edu capabilities --json
```

The version should be `2.1.0`. `--install-links` installs a package copy, so the global CLI does not depend on keeping the checkout or its development dependencies. Building requires development dependencies; do not use `npm ci --omit=dev` for a source build. For an existing checkout, update it to the published `main` or `v2.1.0` without discarding local work, then run the build/install/setup commands above.

The existing one-line installers in the README use the stable GitHub release. Their package contains built output and needs no source build.

## Update an existing installation

```bash
edu update --check
edu update
edu --version
edu capabilities --json
```

The release checks exercise both actual published updaters, from `0.10.2` and `2.0.0-rc.1`. They use isolated homes and synthetic custom files, not personal brains. Migration backs up managed content and checks native plugin provenance before requesting a host refresh. Repeated setup/migration must preserve custom content and avoid unnecessary refreshes and backups.

A manually edited or unrecognized native cache is a conflict. Edu preserves it and reports an incomplete upgrade rather than blessing its bytes or overwriting it. Do not remove ownership manifests or reset caches to suppress that report. Preserve the reported backup and inspect the conflict. npm installation itself is not transactional: after any failure, check `edu --version` before retrying setup or migration.

## Reload coding hosts

Restart Claude Code, Codex, Pi, OpenCode or Antigravity after updating. An already running host or MCP process may retain the old tools, instructions or plugin code even when the installed binary is current. `edu capabilities --json` describes the binary being executed; it does not prove every existing host session has reloaded.

## Compatibility details

Historical usage records without explicit measurements remain unknown. Numeric observations are preserved; incomplete totals are not presented as measured zero. See [measurement](measurement-2.1.md).

Document-only skills remain supported. Declared helpers use ownership and containment checks; an unowned collision is preserved and reported. Legacy/custom skills that cannot safely be copied are reported individually. See [skill bundles and recovery](skills-2.1.md).

Experiments require approval of exact trusted commands and frozen inputs. Their disposable workspace copies do not isolate the OS or network, invoke models automatically or activate candidates. See [experiments](experiments-2.1.md).
