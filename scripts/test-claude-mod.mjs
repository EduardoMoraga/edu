#!/usr/bin/env node
// Runs the Edu Deck's engine tests (templates/claude-mod/tests) with Claude Code's own plugin test kit.
// The Claude Code plugin is generated from the current templates into a temporary folder, so the tests
// see the source as it is now (not a stale checked-in plugins/ copy), nothing is written into the
// checkout and the installed Edu plugin is never touched. Needs the `claude` CLI on PATH, and Node with
// type stripping (`node --experimental-strip-types`, the default from Node 22.18).
//
//   --if-available   exit 0 with a note when the claude CLI is not on PATH (npm test uses this)
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const optional = process.argv.includes('--if-available');
const windows = process.platform === 'win32';
// The arguments are fixed words and paths made here; `shell` only lets Windows find claude.cmd.
const claude = (args, options = {}) => spawnSync('claude', args, { stdio: 'inherit', shell: windows, ...options });

const probe = spawnSync('claude', ['--version'], { encoding: 'utf8', shell: windows });
if (probe.error || probe.status !== 0) {
  console.error('The claude CLI is not available: the Edu Deck engine tests need it.');
  process.exit(optional ? 0 : 1);
}

const work = mkdtempSync(join(tmpdir(), 'edu-deck-test-'));
try {
  const source = join(work, 'source');
  cpSync(join(root, 'templates'), join(source, 'templates'), { recursive: true });
  for (const file of ['package.json', 'THIRD_PARTY_NOTICES.md']) cpSync(join(root, file), join(source, file));
  const { buildPlugins } = await import(pathToFileURL(join(root, 'scripts', 'build-plugins.ts')).href);
  await buildPlugins(source);
  const plugin = join(work, 'edu');
  cpSync(join(source, 'plugins', 'claude-code'), plugin, { recursive: true });
  cpSync(join(root, 'templates', 'claude-mod', 'tests'), join(plugin, 'tests'), { recursive: true });
  const validate = claude(['plugin', 'validate', plugin]);
  if (validate.status !== 0) process.exitCode = validate.status ?? 1;
  else process.exitCode = claude(['plugin', 'test', plugin]).status ?? 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
