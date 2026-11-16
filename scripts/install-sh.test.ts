import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const installer = resolve('scripts/install.sh');
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

/** Runs install.sh in dry-run mode with a fake Node 20 first on PATH (no network, no real HOME). */
async function runOldNode(env: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'edu-install-sh-')); roots.push(root);
  await mkdir(join(root, 'node20'));
  await writeFile(join(root, 'node20', 'node'), '#!/bin/sh\necho 20\n');
  await chmod(join(root, 'node20', 'node'), 0o755);
  return spawnSync('sh', [installer], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000,
    env: { PATH: `${join(root, 'node20')}:/usr/bin:/bin`, HOME: root, EDU_DRY_RUN: '1', EDU_LANG: 'en', ...env },
  });
}

// install.sh asks on /dev/tty, so a run from a terminal would wait for an answer without EDU_ASSUME_NO.
describe.skipIf(process.platform === 'win32')('install.sh questions', () => {
  it('declines without asking when EDU_ASSUME_NO=1', async () => {
    const result = await runOldNode({ EDU_ASSUME_NO: '1' });
    expect(result.signal, 'install.sh waited for an answer').toBeNull();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('nodejs.org');
    expect(result.stdout).not.toContain('[y/N]');
  });

  it('lets EDU_YES=1 win over EDU_ASSUME_NO=1', async () => {
    const result = await runOldNode({ EDU_ASSUME_NO: '1', EDU_YES: '1' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[dry-run] sh -c curl -fsSL https://fnm.vercel.app/install | bash');
  });
});
