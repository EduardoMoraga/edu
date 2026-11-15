#!/usr/bin/env node
// Runs the Edu Deck's engine tests (templates/claude-mod/tests) with Claude Code's own plugin test kit,
// against a temporary copy of the generated plugins/claude-code, so nothing is written into the
// checked-in plugin and the installed Edu plugin is never touched. Needs the `claude` CLI on PATH.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const optional = process.argv.includes('--if-available');
const windows = process.platform === 'win32';
const run = (args, options = {}) => spawnSync('claude', args, { stdio: 'inherit', shell: windows, ...options });

const probe = spawnSync('claude', ['--version'], { encoding: 'utf8', shell: windows });
if (probe.error || probe.status !== 0) {
  console.error('The claude CLI is not available: the Edu Deck engine tests need it.');
  process.exit(optional ? 0 : 1);
}

const work = mkdtempSync(join(tmpdir(), 'edu-deck-test-'));
const plugin = join(work, 'edu');
try {
  cpSync(join(root, 'plugins', 'claude-code'), plugin, { recursive: true });
  cpSync(join(root, 'templates', 'claude-mod', 'tests'), join(plugin, 'tests'), { recursive: true });
  const validate = run(['plugin', 'validate', plugin]);
  if (validate.status !== 0) process.exitCode = validate.status ?? 1;
  else {
    const tests = run(['plugin', 'test', plugin]);
    process.exitCode = tests.status ?? 1;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
