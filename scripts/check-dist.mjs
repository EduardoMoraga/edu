#!/usr/bin/env node
// Fails when the built dist/ differs from the commit. `git status --porcelain` also reports untracked
// files, so a new chunk that was never committed counts (git diff alone misses it).
import { execFileSync } from 'node:child_process';

const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', 'dist'], { encoding: 'utf8' });
if (status.trim()) {
  process.stderr.write(`${status.trimEnd()}\ndist/ is stale: run npm run build and commit dist/\n`);
  process.exit(1);
}
console.log('dist/ matches the commit');
