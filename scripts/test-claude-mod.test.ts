import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The Edu Deck's engine tests (templates/claude-mod/tests) need Claude Code's plugin test kit, so they
// run here only where the claude CLI is on PATH (CI has none: there this test is reported as skipped).
const windows = process.platform === 'win32';
const probe = spawnSync('claude', ['--version'], { encoding: 'utf8', shell: windows });
const claude = !probe.error && probe.status === 0;

describe('Edu Deck engine tests (claude plugin test)', () => {
  it.skipIf(!claude)('pass against the plugin generated from the current templates', () => {
    const home = mkdtempSync(join(tmpdir(), 'edu-deck-home-'));
    try {
      const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: join(home, '.claude'), EDU_HOME: join(home, '.edu') };
      const run = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', resolve('scripts/test-claude-mod.mjs')], { env, encoding: 'utf8', timeout: 170_000 });
      const output = `${run.stdout}\n${run.stderr}`;
      expect(run.status, output).toBe(0);
      expect(output).toMatch(/\b0 fail\b/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 180_000);
});
