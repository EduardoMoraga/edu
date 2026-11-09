import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { captureContext, out, runCli, type Captured } from '../testkit.js';

const gitEnv = { GIT_AUTHOR_NAME: 'Edu', GIT_AUTHOR_EMAIL: 'edu@example.com', GIT_COMMITTER_NAME: 'Edu', GIT_COMMITTER_EMAIL: 'edu@example.com', GIT_CONFIG_NOSYSTEM: '1' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: { ...process.env, ...gitEnv }, encoding: 'utf8' }).trim();

const captures: Captured[] = [];
afterEach(() => { for (const c of captures.splice(0)) rmSync(join(c.dirs.cwd, '..'), { recursive: true, force: true }); });

async function setup(): Promise<{ c: Captured; remote: string }> {
  const c = await captureContext({ env: { PATH: process.env.PATH, ...gitEnv } });
  captures.push(c);
  const base = join(c.dirs.cwd, '..');
  const remote = join(base, 'remote.git');
  git(base, 'init', '-q', '--bare', '-b', 'main', remote);
  const seed = join(base, 'seed');
  git(base, 'init', '-q', '-b', 'main', seed);
  mkdirSync(join(seed, '1-canonical'), { recursive: true });
  writeFileSync(join(seed, '1-canonical', 'D-x.md'), 'x\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-qm', 'seed');
  git(seed, 'push', '-q', remote, 'main');
  return { c, remote };
}

it('joins, re-joins idempotently and reports sync status', async () => {
  const { c, remote } = await setup();
  await runCli(c, ['join', remote, '--host', 'cli']);
  expect(c.exitCode).toBeUndefined();
  expect(out(c)).toContain('cloned the shared brain');
  expect(out(c)).toMatch(/Sync: ok/);
  c.stdout.length = 0;
  await runCli(c, ['join', remote, '--host', 'cli', '--json']);
  const report = JSON.parse(out(c));
  expect(report.action).toBe('already-joined');
  expect(report.sync.state).toBe('ok');
  c.stdout.length = 0;
  await runCli(c, ['sync', '--status', '--json']);
  const status = JSON.parse(out(c));
  expect(status.last.state).toBe('ok');
  expect(status.remote).toBe(remote);
  expect(status.conflictBranches).toEqual([]);
  expect(typeof status.scheduler.installed).toBe('boolean');
  c.stdout.length = 0;
  await runCli(c, ['sync', '--status']);
  expect(out(c)).toContain(`Remote: ${remote}`);
  expect(out(c)).toContain('Open sync-conflict branches: 0');
});

it('never prints a token from the repository URL', async () => {
  const { c } = await setup();
  await runCli(c, ['join', 'https://edu:ghp_s3cretT0kenValue@127.0.0.1:9/me/edu-vault.git', '--host', 'cli']);
  expect(c.exitCode).toBe(1);
  const printed = [...c.stdout, ...c.stderr].join('\n');
  expect(printed).not.toContain('ghp_s3cretT0kenValue');
  expect(printed).toContain('https://127.0.0.1:9/me/edu-vault.git');
});
