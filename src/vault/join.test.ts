import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { joinBrain, localCopyName } from './join.js';

const env = { ...process.env, GIT_AUTHOR_NAME: 'Edu', GIT_AUTHOR_EMAIL: 'edu@example.com', GIT_COMMITTER_NAME: 'Edu', GIT_COMMITTER_EMAIL: 'edu@example.com', GIT_CONFIG_NOSYSTEM: '1' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
const put = (dir: string, path: string, text: string) => {
  mkdirSync(join(dir, path, '..'), { recursive: true });
  writeFileSync(join(dir, path), text);
};
const read = (dir: string, path: string) => readFileSync(join(dir, path), 'utf8');

let root: string;
let remote: string;
let eduHome: string;

/** A bare remote seeded with `files` (the brain at the repository root, or under `subdir`). */
function seed(files: Record<string, string>): void {
  const work = join(root, 'seed');
  git(root, 'init', '-q', '-b', 'main', work);
  for (const [path, text] of Object.entries(files)) put(work, path, text);
  git(work, 'add', '-A');
  git(work, 'commit', '-qm', 'seed');
  git(work, 'push', '-q', remote, 'main');
}
const published = () => git(root, '--git-dir', remote, 'ls-tree', '-r', '--name-only', 'main');
const remoteFile = (path: string) => git(root, '--git-dir', remote, 'show', `main:${path}`);

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'edu-join-')));
  remote = join(root, 'remote.git');
  git(root, 'init', '-q', '--bare', '-b', 'main', remote);
  eduHome = join(root, 'home', '.edu');
  mkdirSync(eduHome, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('edu join', () => {
  it('clones the shared brain on a fresh machine and syncs', async () => {
    seed({ '1-canonical/D-remote.md': 'remote note\n', '0-index/INDEX.md': 'index\n' });
    const report = await joinBrain({ url: remote, eduHome, host: 'fresh', env });
    expect(report.action).toBe('cloned');
    expect(report.brain).toBe(join(eduHome, 'brain'));
    expect(read(report.brain, '1-canonical/D-remote.md')).toBe('remote note\n');
    expect(report.sync?.state).toBe('ok');
    expect(remoteFile('.gitignore')).toContain('.edu-local/');
  });

  it('links the brain to a subfolder of a repository cloned at --path', async () => {
    seed({ '01-CONOCIMIENTO/1-canonical/D-remote.md': 'remote note\n', 'README.md': 'vault\n' });
    const repo = join(root, 'home', 'Edu');
    const report = await joinBrain({ url: remote, eduHome, path: repo, subdir: '01-CONOCIMIENTO', host: 'laptop', env });
    expect(report.action).toBe('cloned');
    expect(lstatSync(join(eduHome, 'brain')).isSymbolicLink()).toBe(true);
    expect(read(join(eduHome, 'brain'), '1-canonical/D-remote.md')).toBe('remote note\n');
    expect(report.sync?.state).toBe('ok');
  });

  it('starts an empty remote from this machine', async () => {
    const report = await joinBrain({ url: remote, eduHome, host: 'first', env });
    expect(report.action).toBe('cloned');
    expect(report.sync?.state).toBe('ok');
    expect(published()).toContain('.gitignore');
  });

  it('merges an existing non-Git brain in place and keeps both versions of a clash', async () => {
    seed({
      '1-canonical/D-remote.md': 'remote note\n', '1-canonical/D-both.md': 'remote version\n',
      '0-index/INDEX.md': 'remote index\n', '0-index/log.md': '# Log\n\n## [2026-11-01 09:00] remote\n',
    });
    const brain = join(eduHome, 'brain');
    put(brain, '1-canonical/D-local.md', 'local note\n');
    put(brain, '1-canonical/D-both.md', 'local version\n');
    put(brain, '0-index/INDEX.md', 'local index\n');
    put(brain, '0-index/log.md', '# Log\n\n## [2026-11-02 09:00] local\n');
    put(brain, '.edu-local/exposure.json', '{}\n');
    const report = await joinBrain({ url: remote, eduHome, host: 'sandbox', env });
    expect(report.action).toBe('merged');
    expect(report.added).toContain('1-canonical/D-local.md');
    expect(report.keptBoth).toEqual([{ path: '1-canonical/D-both.md', local: '1-canonical/D-both.local-sandbox.md' }]);
    expect(report.sync?.state).toBe('ok');
    expect(read(brain, '1-canonical/D-remote.md')).toBe('remote note\n');
    expect(read(brain, '1-canonical/D-local.md')).toBe('local note\n');
    expect(read(brain, '1-canonical/D-both.md')).toBe('remote version\n');
    expect(read(brain, '1-canonical/D-both.local-sandbox.md')).toBe('local version\n');
    expect(read(brain, '0-index/INDEX.md')).toBe('remote index\n');
    expect(read(brain, '0-index/log.md')).toBe('# Log\n\n## [2026-11-01 09:00] remote\n## [2026-11-02 09:00] local\n');
    expect(read(brain, '.edu-local/exposure.json')).toBe('{}\n');
    const files = published();
    expect(files).toContain('1-canonical/D-local.md');
    expect(files).toContain('1-canonical/D-both.local-sandbox.md');
    expect(files).not.toContain('.edu-local');
  });

  it('brings a non-Git brain into a clone with a subfolder and keeps the old folder', async () => {
    seed({ '01-CONOCIMIENTO/1-canonical/D-remote.md': 'remote note\n', '01-CONOCIMIENTO/1-canonical/D-both.md': 'remote version\n' });
    const brain = join(eduHome, 'brain');
    put(brain, '1-canonical/D-local.md', 'local note\n');
    put(brain, '1-canonical/D-both.md', 'local version\n');
    const report = await joinBrain({ url: remote, eduHome, subdir: '01-CONOCIMIENTO', host: 'cloud', env, now: () => new Date('2026-11-08T10:00:00Z') });
    expect(report.action).toBe('imported');
    expect(report.repo).toBe(join(eduHome, 'vault'));
    expect(report.backup && read(report.backup, '1-canonical/D-local.md')).toBe('local note\n');
    expect(lstatSync(brain).isSymbolicLink()).toBe(true);
    expect(read(brain, '1-canonical/D-local.md')).toBe('local note\n');
    expect(read(brain, '1-canonical/D-both.local-cloud.md')).toBe('local version\n');
    expect(report.sync?.state).toBe('ok');
    expect(published()).toContain('01-CONOCIMIENTO/1-canonical/D-local.md');
  });

  it('is idempotent: a second join only syncs', async () => {
    seed({ '1-canonical/D-remote.md': 'remote note\n' });
    await joinBrain({ url: remote, eduHome, host: 'again', env });
    const head = git(join(eduHome, 'brain'), 'rev-parse', 'HEAD');
    const second = await joinBrain({ url: `${remote}/`, eduHome, host: 'again', env });
    expect(second.action).toBe('already-joined');
    expect(second.sync?.state).toBe('ok');
    expect(git(join(eduHome, 'brain'), 'rev-parse', 'HEAD')).toBe(head);
    expect(read(join(eduHome, 'brain'), '.gitignore').match(/\.edu-local\//g)).toHaveLength(1);
  });

  it('refuses a brain already linked to another remote', async () => {
    seed({ 'a.md': 'a\n' });
    await joinBrain({ url: remote, eduHome, host: 'x', env });
    const other = join(root, 'other.git');
    git(root, 'init', '-q', '--bare', '-b', 'main', other);
    await expect(joinBrain({ url: other, eduHome, host: 'x', env })).rejects.toThrow(/already linked to/);
  });

  it('never prints credentials from the URL', async () => {
    const url = 'https://edu:ghp_s3cretT0kenValue@127.0.0.1:9/x/edu-vault.git';
    const error = await joinBrain({ url, eduHome, host: 'x', env }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('ghp_s3cretT0kenValue');
    expect((error as Error).message).toContain('127.0.0.1');
    expect(existsSync(join(eduHome, 'brain', '.git'))).toBe(false);
  });

  it('never stores credentials from the URL as the remote', async () => {
    for (const [url, secret] of [
      ['https://edu:ghp_s3cretT0kenValue@127.0.0.1:9/x/edu-vault.git', 'ghp_s3cretT0kenValue'],
      ['https://127.0.0.1:9/x/edu-vault.git?access_token=abc123', 'abc123'],
    ] as const) {
      const home = join(root, `home-${secret}`, '.edu');
      put(join(home, 'brain'), '1-canonical/D-local.md', 'local note\n');
      const error = await joinBrain({ url, eduHome: home, host: 'x', env }).catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(secret);
      const config = join(home, 'brain', '.git', 'config');
      expect(existsSync(config)).toBe(true);
      expect(readFileSync(config, 'utf8')).toContain('127.0.0.1:9/x/edu-vault.git');
      expect(readFileSync(config, 'utf8')).not.toContain(secret);
    }
  });

  it('never overwrites a conflict copy the remote already has', async () => {
    seed({ '1-canonical/D-both.md': 'remote version\n', '1-canonical/D-both.local-sandbox.md': 'an older copy from another sandbox\n' });
    const brain = join(eduHome, 'brain');
    put(brain, '1-canonical/D-both.md', 'local version\n');
    const report = await joinBrain({ url: remote, eduHome, host: 'sandbox', env, sync: false });
    expect(report.keptBoth).toEqual([{ path: '1-canonical/D-both.md', local: '1-canonical/D-both.local-sandbox-2.md' }]);
    expect(read(brain, '1-canonical/D-both.local-sandbox.md')).toBe('an older copy from another sandbox\n');
    expect(read(brain, '1-canonical/D-both.local-sandbox-2.md')).toBe('local version\n');
    expect(remoteFile('1-canonical/D-both.local-sandbox.md')).toBe('an older copy from another sandbox');
  });

  it('reuses a conflict copy the remote already has with the same content', async () => {
    seed({ '1-canonical/D-both.md': 'remote version\n', '1-canonical/D-both.local-sandbox.md': 'local version\n' });
    const brain = join(eduHome, 'brain');
    put(brain, '1-canonical/D-both.md', 'local version\n');
    const report = await joinBrain({ url: remote, eduHome, host: 'sandbox', env, sync: false });
    expect(report.keptBoth).toEqual([{ path: '1-canonical/D-both.md', local: '1-canonical/D-both.local-sandbox.md' }]);
    expect(existsSync(join(brain, '1-canonical/D-both.local-sandbox-2.md'))).toBe(false);
  });

  it('never overwrites a conflict copy when importing into a clone', async () => {
    seed({
      '01-CONOCIMIENTO/1-canonical/D-both.md': 'remote version\n',
      '01-CONOCIMIENTO/1-canonical/D-both.local-cloud.md': 'an older copy\n',
    });
    put(join(eduHome, 'brain'), '1-canonical/D-both.md', 'local version\n');
    const report = await joinBrain({ url: remote, eduHome, subdir: '01-CONOCIMIENTO', host: 'cloud', env, sync: false });
    expect(report.keptBoth).toEqual([{ path: '1-canonical/D-both.md', local: '1-canonical/D-both.local-cloud-2.md' }]);
    expect(read(report.brain, '1-canonical/D-both.local-cloud.md')).toBe('an older copy\n');
    expect(read(report.brain, '1-canonical/D-both.local-cloud-2.md')).toBe('local version\n');
  });

  it.skipIf(process.platform === 'win32')('refuses to import through a folder the remote made a symbolic link', async () => {
    const outside = join(root, 'outside');
    mkdirSync(outside);
    const work = join(root, 'seed');
    git(root, 'init', '-q', '-b', 'main', work);
    put(work, '01-CONOCIMIENTO/README.md', 'vault\n');
    symlinkSync(outside, join(work, '01-CONOCIMIENTO', '1-canonical'));
    git(work, 'add', '-A');
    git(work, 'commit', '-qm', 'malicious');
    git(work, 'push', '-q', remote, 'main');
    put(join(eduHome, 'brain'), '1-canonical/D-local.md', 'local note\n');
    await expect(joinBrain({ url: remote, eduHome, subdir: '01-CONOCIMIENTO', host: 'cloud', env, sync: false })).rejects.toThrow(/symbolic link/);
    expect(readdirSync(outside)).toEqual([]);
  });

  it('gives a sandbox without a Git identity one for this repository', async () => {
    seed({ 'a.md': 'a\n' });
    const bare = { ...process.env, HOME: join(root, 'home'), GIT_CONFIG_GLOBAL: join(root, 'none'), GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.useConfigOnly', GIT_CONFIG_VALUE_0: 'true' };
    for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL']) delete bare[key];
    put(join(eduHome, 'brain'), 'local.md', 'local\n');
    const report = await joinBrain({ url: remote, eduHome, host: 'grok', env: bare });
    expect(report.setup.join('\n')).toContain('Edu (grok)');
    expect(report.sync?.state).toBe('ok');
    expect(published()).toContain('local.md');
  });
});

describe('join helpers', () => {
  it('names the kept local copy', () => {
    expect(localCopyName('1-canonical/D-x.md', 'cloud-a')).toBe('1-canonical/D-x.local-cloud-a.md');
    expect(localCopyName('README', 'h')).toBe('README.local-h');
  });
});
