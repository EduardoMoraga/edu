# Contributing

## Setup

- Use Node.js 22.19 or newer for development (the pinned Pi API contract requires it).
- Install dependencies with `npm ci`.
- Run `npm run build` before checking package behavior.

## Tests

Vitest runs three projects (`vitest.config.ts`):

| Project | What it holds |
|---|---|
| `unit` | Every `*.test.ts(x)` under `src/`, `test/`, `scripts/` and `templates/`, except the contracts. |
| `contracts` | `src/adapters/pi-protocol.test.ts`: the real Pi loader, without a model or credentials. |
| `perf` | The files with wall-clock budgets. Their behaviour also runs in `unit`; the budgets (`expectWithinBudget`) assert only here, with `EDU_PERF=1` and two retries. |

| Script | Runs | Who runs it |
|---|---|---|
| `npm test` | `unit` and `contracts` | You, before every hand-off; CI on macOS and Windows |
| `npm run test:perf` | `perf` | CI on Linux; you, when you touch a file listed in `PERF` |
| `npm run test:all` | All three projects | You, before a release |
| `npm run test:coverage` | `unit` and `contracts` with v8 coverage and the ratchet | CI on Linux |
| `npm run test:deck` | The Edu Deck engine tests with `claude plugin test` | You, when you change `templates/claude-mod/`; needs the `claude` CLI |
| `npm run test:watch` | `unit` and `contracts` in watch mode | You |

- **Coverage ratchet:** lines 91, statements 86, functions 88, branches 76 (just under the measured
  baseline). Raise them when coverage grows; never lower them.
- **Edu Deck tests:** `test:deck` builds the Claude Code plugin from `templates/` into a temporary
  folder, so it tests the current source and never touches your installed plugin. `npm test` runs
  it too when `claude` is on `PATH` and reports it as skipped otherwise (CI has no `claude`).
- **No test launches a paid model.** Tests use temporary folders, never your real `HOME`, and no
  fixed sleeps.

### Pi contract tests (`PI_PROTOCOL_ROOT`)

The contract tests load the real Pi 1.2.0. Install it outside the checkout and point
`PI_PROTOCOL_ROOT` at the package root:

```bash
npm install --prefix /tmp/edu-pi-api --no-package-lock --no-fund --no-audit @earendil-works/pi-coding-agent@1.2.0
export PI_PROTOCOL_ROOT=/tmp/edu-pi-api/node_modules/@earendil-works/pi-coding-agent
```

On Windows, use a temporary prefix and set `$env:PI_PROTOCOL_ROOT`. This is a test tool, not a
production dependency.

- Without `PI_PROTOCOL_ROOT` and without an installed Pi, the contract tests skip and say so on
  stderr.
- A `PI_PROTOCOL_ROOT` that points at the wrong folder fails them.
- CI installs Pi 1.2.0 in a temporary folder, so they always run there.

### Before handing off

```bash
npm run typecheck
npm run lint
npm test -- --maxWorkers=2
npm run build:plugins -- --check
npm run build
npm run smoke
```

`npm run check` runs the typecheck, the lint, the tests and the build in one go. The lint
(`eslint.config.js`) is type-aware and looks only for bugs: unhandled promises, error handling that a
returned promise skips, and core correctness rules. CI runs these on Ubuntu,
macOS and Windows with Node 22, and the tests on Ubuntu with Node 24 and 26.

### Windows workstations

The suite runs on Windows without Git Bash on `PATH`, without the symlink privilege and with a real
`~/.edu` next to the temp folder: test check commands go through `node -e`, directory links use
junctions and `EDU_CEILING_DIRECTORIES` keeps the brain search inside each test sandbox.

Wall-clock budgets, such as `maintains a brain of about 1000 notes in under 2 seconds` and the
session-start budget in `src/context/session-start.perf.test.ts`, assert only in `npm run test:perf`.
On managed workstations where antivirus or filter drivers inspect every file open, reading 1000
small files alone can take more than 2 s (measured 2.6 s for `stat` + `readFile` on a managed
laptop, Node 24.19), so `test:perf` can fail there while it passes on CI runners. `npm test` is not
affected.

## Generated files: `dist/` and `plugins/`

Both are generated and committed. Never edit them by hand.

| Path | Source | Regenerate | Check |
|---|---|---|---|
| `dist/` | `src/` | `npm run build` (tsup) | `npm run check:dist` (fails on changed or untracked files) |
| `plugins/`, `.claude-plugin/`, `.agents/plugins/` | `templates/` and `package.json` | `npm run build:plugins` | `npm run build:plugins -- --check` |

Edit `templates/`, then regenerate. Commit `dist/` and `plugins/` together with the source change
that produced them.

## Module boundaries

Respect the layer model and the allowed-dependency table in `docs/ARCHITECTURE.md` §3. The data lives
in `src/test-support/architecture.ts`, and `src/test-support/architecture.test.ts` fails on a forbidden
import, a module cycle or an import of `src/cli` from outside the CLI. When a new dependency is right,
add it there and paste the rendered tables into the doc (the doc test says what changed).

## Commits

Use Conventional Commits, for example `feat: add smoke install check` or `fix: preserve cli executable bit`.

## Releases

The version lives only in `package.json`. The CLI, the capabilities report, the MCP server and the
plugin manifests read it from there, and a test fails when a plugin manifest disagrees.

1. Set `version` in `package.json`, run `npm run build:plugins` and `npm run build`, update
   `CHANGELOG.md`, and commit.
2. Tag the commit `v<version>` and push the tag.
3. The release workflow (`.github/workflows/release.yml`) then:
   - checks that the tag matches `package.json`;
   - runs `npm run check` with the pinned Pi, and checks that the committed `dist/` and `plugins/`
     match a fresh build;
   - packs `edu-agent-<version>.tgz`, copies it to `edu-agent.tgz`, and writes `SHA256SUMS`
     (`<sha256>  <file>`, the `sha256sum` format);
   - attests build provenance for both packages;
   - publishes the GitHub release with the three files. A version with a `-` is a prerelease.

Re-running the workflow is safe: files already published with the same digest are left alone, an
interrupted draft is completed, and a published file is never replaced with different bytes.

`edu update`, `install.sh` and `install.ps1` install a 6.0 or newer release only when its package
matches `SHA256SUMS`. To check provenance yourself:
`gh attestation verify edu-agent.tgz --repo EduardoMoraga/edu`.

## Git installs

For a source checkout, build explicitly before installing a package copy:

```bash
npm ci --include=dev
npm run build:plugins -- --check
npm run build
npm install --global --install-links .
```

The package uses `prepack`, not `prepare`. Its build needs development dependencies such as `tsup`.
`--install-links` copies the package instead of linking the global CLI to the checkout. CI verifies
this workflow from the exact committed source, moves that source away, then checks the installed
version, help, capabilities and MCP handshake on Linux, macOS and Windows.

Release validation also runs the real published 0.10.2 and 2.0.0-rc.1 updaters against the built
candidate. These checks preserve synthetic custom memory, skills, configuration and brain pointers;
they never inspect a personal brain or execute a paid model.
