# Contributing

## Setup

- Use Node.js 22.19 or newer for development (the pinned Pi API contract requires it).
- Install dependencies with `npm ci`.
- Run `npm run build` before checking package behavior.

## Checks

Run the focused project checks before handing off changes. The Pi protocol tests execute the real
Pi loader without a model or credentials. Provide Pi 1.2.0 via `PI_PROTOCOL_ROOT` (the package root),
or install the test tool outside this checkout:

```bash
npm install --prefix /tmp/edu-pi-api --no-package-lock --no-fund --no-audit @earendil-works/pi-coding-agent@1.2.0
export PI_PROTOCOL_ROOT=/tmp/edu-pi-api/node_modules/@earendil-works/pi-coding-agent
npm run typecheck
npm test -- --maxWorkers=2
npm run build:plugins -- --check
npm run build
npm run smoke
```

On Windows, use a temporary prefix and set `$env:PI_PROTOCOL_ROOT` to that package directory.
This is a test-tool installation, not a production dependency. Missing Pi fails the contract tests;
it does not silently skip them. CI installs the pinned API in its temporary folder and runs the
checks on Ubuntu, macOS and Windows with Node 22. No test should launch a paid model.

### Windows workstations

The suite runs on Windows without Git Bash on `PATH`, without the symlink privilege and with a real
`~/.edu` next to the temp folder: test check commands go through `node -e`, directory links use
junctions and `EDU_CEILING_DIRECTORIES` keeps the brain search inside each test sandbox.

Two checks depend on the machine because they measure wall-clock time: `maintains a brain of about
1000 notes in under 2 seconds` and, occasionally, the session-start budget in
`src/context/session-start.perf.test.ts`. On managed workstations where antivirus or filter drivers
inspect every file open, reading 1000 small files alone can take more than 2 s (measured 2.6 s for
`stat` + `readFile` on a Cheil laptop, Node 24.19), so those tests can fail there while they pass on
CI runners.

## Module ownership

Respect the module ownership table in `docs/ARCHITECTURE.md` §3. Keep changes inside the module or path family owned by your role, and coordinate with the lead before changing shared contracts.

## Commits

Use Conventional Commits, for example `feat: add smoke install check` or `fix: preserve cli executable bit`.

## Git installs

`npm i -g github:EduardoMoraga/edu` runs the package `prepare` script. The build uses devDependencies such as `tsup` and `typescript`; npm makes those available during the git install build flow, so the CLI is built before the global `edu` binary is linked.
