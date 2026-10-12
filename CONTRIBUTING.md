# Contributing

## Setup

- Use Node.js 22 or newer.
- Install dependencies with `npm ci`.
- Run `npm run build` before checking package behavior.

## Checks

Run the focused project checks before handing off changes:

```bash
npm run typecheck
npm test
npm run build
npm run smoke
```

CI runs the same checks on Ubuntu and macOS with Node 22.

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
