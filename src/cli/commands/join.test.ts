import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { PERSONAL_REMOTE } from '../../profile/profile.js';
import { captureContext, err, out, runCli, type Captured } from '../../test-support/cli.js';

const gitEnv = { GIT_AUTHOR_NAME: 'Edu', GIT_AUTHOR_EMAIL: 'edu@example.com', GIT_COMMITTER_NAME: 'Edu', GIT_COMMITTER_EMAIL: 'edu@example.com', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: { ...process.env, ...gitEnv }, encoding: 'utf8' }).trim();

const captures: Captured[] = [];
afterEach(() => { for (const c of captures.splice(0)) rmSync(join(c.dirs.cwd, '..'), { recursive: true, force: true }); });

async function setup(): Promise<{ c: Captured; remote: string }> {
  const c = await captureContext({ env: { PATH: process.env.PATH, ...gitEnv } });
  captures.push(c);
  const base = join(c.dirs.cwd, '..');
  gitEnv.GIT_CONFIG_GLOBAL = join(base, 'gitconfig');
  c.ctx.env.GIT_CONFIG_GLOBAL = gitEnv.GIT_CONFIG_GLOBAL;
  writeFileSync(gitEnv.GIT_CONFIG_GLOBAL, '');
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

it.skipIf(process.platform !== 'darwin' && process.platform !== 'linux')('reports a legacy scheduler in sync status without removing it', async () => {
  const { c, remote } = await setup();
  await runCli(c, ['join', remote, '--host', 'cli']);
  const vault = realpathSync(join(c.dirs.eduHome, 'brain'));
  const dir = process.platform === 'darwin' ? join(c.dirs.home, 'Library', 'LaunchAgents') : join(c.dirs.home, '.config', 'systemd', 'user');
  mkdirSync(dir, { recursive: true });
  const legacy = join(dir, process.platform === 'darwin' ? 'old-vault.plist' : 'old.service');
  writeFileSync(legacy, process.platform === 'darwin'
    ? `<plist><dict><key>ProgramArguments</key><array><string>${vault}/scripts/sync</string></array></dict></plist>`
    : `[Service]\nExecStart=${vault}/scripts/sync\n`);
  c.stdout.length = 0;
  await runCli(c, ['sync', '--status', '--json']);
  expect(JSON.parse(out(c)).scheduler.legacy).toEqual([legacy]);
  expect(readFileSync(legacy, 'utf8')).toContain(vault);
});

it('explains which vault each profile joins', async () => {
  const c = await captureContext();
  captures.push(c);
  const exit = await runCli(c, ['join', '--help']);
  expect(exit?.code).toBe('commander.helpDisplayed');
  const help = out(c);
  expect(help).toContain('--profile');
  expect(help).toContain('EduardoMoraga/edu-vault');
  expect(help).toContain('EduardoMCheil/cheil-vault');
  expect(help).toContain('01-CONOCIMIENTO');
  expect(help).toContain('_CONOCIMIENTO');
  expect(help).toContain('C:\\Cheil');
  expect(help).toContain('EduSync');
});

it('joins a personal profile and does not join it again', async () => {
  const { c, remote } = await setup();
  const seed = join(c.dirs.cwd, '..', 'seed');
  mkdirSync(join(seed, '01-CONOCIMIENTO'), { recursive: true });
  writeFileSync(join(seed, '01-CONOCIMIENTO', 'note.md'), 'from vault\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-qm', 'subdir');
  git(seed, 'push', '-q', remote, 'main');
  mkdirSync(join(c.dirs.eduHome, 'brain'), { recursive: true });
  writeFileSync(join(c.dirs.eduHome, 'brain', 'local.md'), 'local\n');
  await runCli(c, ['join', remote, '--profile', 'personal', '--subdir', '01-CONOCIMIENTO', '--host', 'cli']);
  expect(c.exitCode).toBeUndefined();
  expect(out(c)).toContain('profile: personal');
  expect(readFileSync(join(c.dirs.eduHome, 'brain', 'local.md'), 'utf8')).toBe('local\n');
  expect(readFileSync(join(c.dirs.eduHome, 'brain', 'note.md'), 'utf8')).toBe('from vault\n');
  expect(lstatSync(join(c.dirs.eduHome, 'brain')).isSymbolicLink()).toBe(true);
  if (process.platform === 'win32') {
    const listing = execFileSync('cmd.exe', ['/d', '/s', '/c', `dir /AL "${c.dirs.eduHome}"`], { encoding: 'utf8', windowsVerbatimArguments: true });
    expect(listing).toContain('<JUNCTION>');
    expect(listing).not.toContain('<SYMLINKD>');
  }
  const saved = JSON.parse(readFileSync(join(c.dirs.eduHome, 'profile.json'), 'utf8')) as { id: string; remote: string };
  expect(saved).toMatchObject({ id: 'personal', remote: PERSONAL_REMOTE });
  c.stdout.length = 0;
  await runCli(c, ['join', remote, '--profile', 'personal', '--subdir', '01-CONOCIMIENTO', '--host', 'cli', '--json']);
  expect(c.exitCode).toBeUndefined();
  expect(JSON.parse(out(c)).action).toBe('already-joined');
});

it('refuses a cheil join of the personal vault, a mismatched home, and --install', async () => {
  const { c, remote } = await setup();
  const cheilRoot = existsSync('C:\\Cheil');
  await runCli(c, ['join', 'https://user:s3cret@github.com/EduardoMoraga/edu-vault.git', '--profile', 'cheil']);
  expect(c.exitCode).toBe(1);
  expect(err(c)).toContain('EduardoMCheil/cheil-vault');
  expect(err(c)).not.toContain('s3cret');
  expect(existsSync(join(c.dirs.eduHome, 'brain'))).toBe(false);
  expect(existsSync('C:\\Cheil')).toBe(cheilRoot);

  mkdirSync(c.dirs.eduHome, { recursive: true });
  writeFileSync(join(c.dirs.eduHome, 'profile.json'), JSON.stringify({
    id: 'personal', home: c.dirs.eduHome, brain: join(c.dirs.eduHome, 'brain'), remote: PERSONAL_REMOTE,
  }));
  c.stderr.length = 0;
  await runCli(c, ['join', remote, '--profile', 'cheil', '--subdir', '_CONOCIMIENTO']);
  expect(c.exitCode).toBe(1);
  expect(err(c)).toContain('personal profile');
  expect(JSON.parse(readFileSync(join(c.dirs.eduHome, 'profile.json'), 'utf8')).id).toBe('personal');
  expect(existsSync('C:\\Cheil')).toBe(cheilRoot);

  c.stderr.length = 0;
  await runCli(c, ['join', 'https://github.com/EduardoMCheil/cheil-vault.git', '--profile', 'work']);
  expect(c.exitCode).toBe(1);
  expect(err(c)).toContain('personal or cheil');

  c.stderr.length = 0;
  await runCli(c, ['join', 'https://github.com/EduardoMCheil/cheil-vault.git', '--profile', 'cheil', '--install', '--subdir', '_CONOCIMIENTO']);
  expect(c.exitCode).toBe(1);
  expect(err(c)).toContain('EduSync');
  expect(existsSync(join(c.dirs.eduHome, 'brain'))).toBe(false);
  expect(existsSync(join(c.dirs.eduHome, 'edu-sync.cmd'))).toBe(false);
  expect(existsSync(join(c.dirs.home, '.config', 'systemd', 'user', 'edu-sync.service'))).toBe(false);
  expect(existsSync('C:\\Cheil')).toBe(cheilRoot);
});

it('never prints a token from the repository URL', async () => {
  const { c } = await setup();
  await runCli(c, ['join', 'https://edu:ghp_s3cretT0kenValue@127.0.0.1:9/me/edu-vault.git', '--host', 'cli']);
  expect(c.exitCode).toBe(1);
  const printed = [...c.stdout, ...c.stderr].join('\n');
  expect(printed).not.toContain('ghp_s3cretT0kenValue');
  expect(printed).toContain('https://127.0.0.1:9/me/edu-vault.git');
});
