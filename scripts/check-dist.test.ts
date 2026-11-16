import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = resolve('scripts/check-dist.mjs');
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

// No user or system git config (hooks, signing): only the throwaway repository.
const gitEnv = (root: string) => ({ ...process.env, HOME: root, GIT_CONFIG_GLOBAL: join(root, 'no-gitconfig'), GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Edu', GIT_AUTHOR_EMAIL: 'edu@example.com', GIT_COMMITTER_NAME: 'Edu', GIT_COMMITTER_EMAIL: 'edu@example.com' });

async function repo() {
  const root = await mkdtemp(join(tmpdir(), 'edu-check-dist-')); roots.push(root);
  const env = gitEnv(root);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, env, stdio: 'pipe' });
  git('init', '-q');
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist', 'cli.js'), 'built\n');
  git('add', '.');
  git('commit', '-qm', 'dist');
  return root;
}
const check = (cwd: string) => spawnSync(process.execPath, [script], { cwd, env: gitEnv(cwd), encoding: 'utf8' });

describe('check-dist', () => {
  it('passes when dist/ matches the commit', async () => {
    expect(check(await repo()).status).toBe(0);
  });

  it('fails on a modified chunk', async () => {
    const root = await repo();
    await writeFile(join(root, 'dist', 'cli.js'), 'rebuilt\n');
    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('dist/cli.js');
  });

  it('fails on an untracked chunk that git diff would miss', async () => {
    const root = await repo();
    await mkdir(join(root, 'dist', 'nested'));
    await writeFile(join(root, 'dist', 'nested', 'chunk-NEW.js'), 'new\n');
    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('dist/nested/chunk-NEW.js');
  });
});
