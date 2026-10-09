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

## Module ownership

Respect the module ownership table in `docs/ARCHITECTURE.md` §3. Keep changes inside the module or path family owned by your role, and coordinate with the lead before changing shared contracts.

## Commits

Use Conventional Commits, for example `feat: add smoke install check` or `fix: preserve cli executable bit`.

## Git installs

`npm i -g github:EduardoMoraga/edu` runs the package `prepare` script. The build uses devDependencies such as `tsup` and `typescript`; npm makes those available during the git install build flow, so the CLI is built before the global `edu` binary is linked.
