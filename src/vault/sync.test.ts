import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendLog } from '../brain/catalog.js';
import { logLockDir } from '../brain/note-lock.js';
import { CHEIL_REMOTE } from '../profile/profile.js';
import { conflictBranches, ensureRepoFiles, isAppendOnly, isEmptySession, isGenerated, mergeAppendOnly, mergeCounters, remoteUrl, syncBrain, trackedConflictCopies, withoutCounters } from './sync.js';

const env = { ...process.env, GIT_AUTHOR_NAME: 'Edu', GIT_AUTHOR_EMAIL: 'edu@example.com', GIT_COMMITTER_NAME: 'Edu', GIT_COMMITTER_EMAIL: 'edu@example.com', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();

const note = (body: string, uses = 1) => `---\nid: D-x\ntitle: X\nupdated: 2026-11-0${uses}T00:00:00Z\nusage:\n  uses: ${uses}\n  lastUsed: 2026-11-0${uses}T00:00:00Z\n---\n\n${body}\n`;

let root: string;
let a: { vault: string; home: string };
let b: { vault: string; home: string };

function machine(name: string) {
  const vault = join(root, name, 'Edu');
  git(root, 'clone', '-q', join(root, 'remote.git'), vault);
  const home = join(root, name, '.edu');
  mkdirSync(home, { recursive: true });
  symlinkSync(join(vault, '01-CONOCIMIENTO'), join(home, 'brain'), 'junction');
  return { vault, home };
}
const write = (m: { vault: string }, path: string, text: string) => {
  mkdirSync(join(m.vault, path, '..'), { recursive: true });
  writeFileSync(join(m.vault, path), text);
};
const read = (m: { vault: string }, path: string) => readFileSync(join(m.vault, path), 'utf8');
const sync = (m: { home: string }, host: string, cloud = false) => syncBrain({ eduHome: m.home, host, cloud, env });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'edu-sync-'));
  env.GIT_CONFIG_GLOBAL = join(root, 'gitconfig');
  writeFileSync(env.GIT_CONFIG_GLOBAL, '');
  git(root, 'init', '-q', '--bare', '-b', 'main', 'remote.git');
  const seed = join(root, 'seed');
  git(root, 'init', '-q', '-b', 'main', seed);
  mkdirSync(join(seed, '01-CONOCIMIENTO', '0-index'), { recursive: true });
  mkdirSync(join(seed, '01-CONOCIMIENTO', '1-canonical'), { recursive: true });
  writeFileSync(join(seed, '01-CONOCIMIENTO', '0-index', 'INDEX.md'), 'Generated: 0\n');
  writeFileSync(join(seed, '01-CONOCIMIENTO', '1-canonical', 'D-x.md'), note('first'));
  git(seed, 'add', '-A');
  git(seed, 'commit', '-qm', 'seed');
  git(seed, 'push', '-q', join(root, 'remote.git'), 'main');
  a = machine('a');
  b = machine('b');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('edu sync', () => {
  it('publishes one machine\'s edit to the other', async () => {
    write(a, '01-CONOCIMIENTO/1-canonical/D-y.md', note('new'));
    expect((await sync(a, 'a')).state).toBe('ok');
    expect((await sync(b, 'b')).state).toBe('ok');
    expect(read(b, '01-CONOCIMIENTO/1-canonical/D-y.md')).toContain('new');
    expect(git(b.vault, 'log', '-1', '--format=%s')).toMatch(/^chore: auto-sync from a /);
  });

  it('never stops on a generated index: upstream wins', async () => {
    write(a, '01-CONOCIMIENTO/0-index/INDEX.md', 'Generated: A\n');
    write(a, '01-CONOCIMIENTO/1-canonical/D-a.md', note('from a'));
    await sync(a, 'a');
    write(b, '01-CONOCIMIENTO/0-index/INDEX.md', 'Generated: B\n');
    write(b, '01-CONOCIMIENTO/1-canonical/D-b.md', note('from b'));
    const result = await sync(b, 'b');
    expect(result.state).toBe('ok');
    expect(result.resolved).toEqual(['01-CONOCIMIENTO/0-index/INDEX.md']);
    expect(read(b, '01-CONOCIMIENTO/0-index/INDEX.md')).toBe('Generated: A\n');
    expect(read(b, '01-CONOCIMIENTO/1-canonical/D-a.md')).toContain('from a');
    expect(git(b.vault, 'status', '-sb')).toBe('## main...origin/main');
  });

  it('merges the largest usage counters and latest dates', async () => {
    write(a, '01-CONOCIMIENTO/1-canonical/D-x.md', note('first', 2));
    await sync(a, 'a');
    write(b, '01-CONOCIMIENTO/1-canonical/D-x.md', note('first', 3));
    const result = await sync(b, 'b');
    expect(result.state).toBe('ok');
    expect(read(b, '01-CONOCIMIENTO/1-canonical/D-x.md')).toBe(note('first', 3));
    expect(git(b.vault, 'show', 'origin/main:01-CONOCIMIENTO/1-canonical/D-x.md')).toContain('uses: 3');
  });

  it('names a conflict copy after the file when the note id is not text', async () => {
    const odd = (body: string) => `---\nid:\n  nested: true\ntitle: X\n---\n\n${body}\n`;
    write(a, '01-CONOCIMIENTO/1-canonical/D-x.md', odd('edited on a'));
    await sync(a, 'a');
    write(b, '01-CONOCIMIENTO/1-canonical/D-x.md', odd('edited on b'));
    const result = await sync(b, 'b');
    expect(result.state).toBe('conflict');
    const copy = read(b, result.conflictCopies![0]!.local);
    expect(copy).toContain('conflict_of: 01-CONOCIMIENTO/1-canonical/D-x');
    expect(copy).not.toContain('[object Object]');
  });

  it('publishes both versions of a real conflict and every unrelated local note', async () => {
    write(a, '01-CONOCIMIENTO/1-canonical/D-x.md', note('edited on a'));
    await sync(a, 'a');
    write(b, '01-CONOCIMIENTO/1-canonical/D-local.md', note('only on b'));
    git(b.vault, 'add', '-A');
    git(b.vault, 'commit', '-qm', 'local note before the conflict');
    write(b, '01-CONOCIMIENTO/1-canonical/D-x.md', note('edited on b'));
    const result = await sync(b, 'b');
    expect(result.state).toBe('conflict');
    expect(result.branch).toMatch(/^sync-conflict\/b-[0-9a-f]+$/);
    expect(git(b.vault, 'ls-remote', '--heads', 'origin', result.branch!)).not.toBe('');
    expect(git(b.vault, 'show', `${result.branch}:01-CONOCIMIENTO/1-canonical/D-x.md`)).toContain('edited on b');
    expect(read(b, '01-CONOCIMIENTO/1-canonical/D-x.md')).toContain('edited on a');
    expect(result.conflictCopies).toHaveLength(1);
    const copy = result.conflictCopies![0]!.local;
    expect(copy).toMatch(/D-x\.conflict-b-[0-9a-f]+\.md$/);
    expect(read(b, copy)).toContain('edited on b');
    expect(read(b, copy)).toContain('conflict_of: D-x');
    expect(read(b, copy)).toMatch(/id: D-x-conflict-b-[0-9a-f]+/);
    expect(read(b, '01-CONOCIMIENTO/1-canonical/D-local.md')).toContain('only on b');
    expect(git(b.vault, 'show', `origin/main:${copy}`)).toContain('edited on b');
    expect(git(b.vault, 'status', '-sb')).toBe('## main...origin/main');
    write(b, '01-CONOCIMIENTO/1-canonical/D-z.md', note('later'));
    expect((await sync(b, 'b')).state).toBe('ok');
    expect((await sync(a, 'a')).state).toBe('ok');
    expect(read(a, '01-CONOCIMIENTO/1-canonical/D-z.md')).toContain('later');
    expect(read(a, copy)).toContain('edited on b');
    expect(await trackedConflictCopies(b.vault, env)).toEqual([{ path: '01-CONOCIMIENTO/1-canonical/D-x.md', local: copy }]);
  });

  it('keeps both notes when two machines add the same title and path', async () => {
    const path = '01-CONOCIMIENTO/1-canonical/D-new.md';
    write(a, path, note('new from a'));
    write(b, path, note('new from b'));
    await sync(a, 'a');
    const result = await sync(b, 'b');
    expect(result.state).toBe('conflict');
    expect(read(b, path)).toContain('new from a');
    const copy = result.conflictCopies![0]!.local;
    expect(read(b, copy)).toContain('new from b');
    expect(git(b.vault, 'show', `origin/main:${copy}`)).toContain('new from b');
  });

  it('resolves a generated-file conflict in the same rebase as a real note conflict', async () => {
    const index = '01-CONOCIMIENTO/0-index/INDEX.md';
    write(a, index, 'Generated: A\n');
    write(a, '01-CONOCIMIENTO/1-canonical/D-x.md', note('from a'));
    await sync(a, 'a');
    write(b, index, 'Generated: B\n');
    write(b, '01-CONOCIMIENTO/1-canonical/D-x.md', note('from b'));
    const result = await sync(b, 'b');
    expect(result.state).toBe('conflict');
    expect(result.resolved).toContain(index);
    expect(result.conflictCopies).toHaveLength(1);
    expect(read(b, index)).toBe('Generated: A\n');
    expect(read(b, result.conflictCopies![0]!.local)).toContain('from b');
  });

  it('keeps a non-note file conflict visible too', async () => {
    write(a, 'README.txt', 'upstream\n');
    await sync(a, 'a');
    await sync(b, 'b');
    write(a, 'README.txt', 'upstream edit\n');
    await sync(a, 'a');
    write(b, 'README.txt', 'local edit\n');
    const result = await sync(b, 'b');
    expect(result.state).toBe('conflict');
    expect(read(b, 'README.txt')).toBe('upstream edit\n');
    expect(read(b, result.conflictCopies![0]!.local)).toBe('local edit\n');
  });

  it('keeps counters, bases and empty sessions local in cloud mode', async () => {
    write(b, '01-CONOCIMIENTO/1-canonical/D-x.md', note('first', 4));
    write(b, '01-CONOCIMIENTO/0-index/Conocimiento.base', 'views: []\n');
    write(b, '01-CONOCIMIENTO/2-episodic/s1.md', '---\nid: s1\n---\n\nClaude Code session abc ended (other).\nTranscript: /tmp/x.jsonl\n');
    write(b, '01-CONOCIMIENTO/2-episodic/s2.md', '---\nid: s2\n---\n\nFixed the sync.\n');
    expect((await sync(b, 'cloud-b', true)).state).toBe('ok');
    const published = git(b.vault, 'ls-tree', '-r', '--name-only', 'origin/main');
    expect(published).toContain('01-CONOCIMIENTO/2-episodic/s2.md');
    expect(published).not.toContain('s1.md');
    expect(published).not.toContain('Conocimiento.base');
    expect(git(b.vault, 'show', 'origin/main:01-CONOCIMIENTO/1-canonical/D-x.md')).toBe(note('first').trim());
  });

  it('reports a missing remote as offline without losing the commit', async () => {
    git(a.vault, 'remote', 'set-url', 'origin', join(root, 'missing.git'));
    write(a, '01-CONOCIMIENTO/1-canonical/D-y.md', note('offline'));
    const result = await sync(a, 'a');
    expect(result.state).toBe('offline');
    expect(git(a.vault, 'log', '-1', '--format=%s')).toMatch(/auto-sync from a/);
  });

  it('merges concurrent appends to the append-only log from two clones', async () => {
    const log = '01-CONOCIMIENTO/0-index/log.md';
    write(a, log, '# Log\n\n## [2026-11-01 09:00] seed\n');
    await sync(a, 'a');
    await sync(b, 'b');
    write(a, log, '# Log\n\n## [2026-11-01 09:00] seed\n\n## [2026-11-02 11:00] from a\n');
    write(b, log, '# Log\n\n## [2026-11-01 09:00] seed\n\n## [2026-11-02 10:30] from b\n- detail b\n');
    await sync(a, 'a');
    const result = await sync(b, 'b');
    expect(result.state).toBe('ok');
    expect(result.merged).toEqual([log]);
    const merged = '# Log\n\n## [2026-11-01 09:00] seed\n\n## [2026-11-02 10:30] from b\n- detail b\n\n## [2026-11-02 11:00] from a\n';
    expect(read(b, log)).toBe(merged);
    expect((await sync(a, 'a')).state).toBe('ok');
    expect(read(a, log)).toBe(merged);
  });

  it('treats the English dashboard and the catalog as generated', async () => {
    write(a, '00-START/Dashboard.md', 'A\n');
    write(a, '01-CONOCIMIENTO/0-index/catalog.md', 'catalog A\n');
    await sync(a, 'a');
    await sync(b, 'b');
    write(a, '00-START/Dashboard.md', 'A2\n');
    write(a, '01-CONOCIMIENTO/0-index/catalog.md', 'catalog A2\n');
    await sync(a, 'a');
    write(b, '00-START/Dashboard.md', 'B2\n');
    write(b, '01-CONOCIMIENTO/0-index/catalog.md', 'catalog B2\n');
    const result = await sync(b, 'b');
    expect(result.state).toBe('ok');
    expect(result.resolved.sort()).toEqual(['00-START/Dashboard.md', '01-CONOCIMIENTO/0-index/catalog.md']);
    expect(read(b, '00-START/Dashboard.md')).toBe('A2\n');
  });

  it('ignores the local exposure ledger, once', async () => {
    write(a, '01-CONOCIMIENTO/.edu-local/exposure.json', '{}\n');
    expect((await sync(a, 'a')).state).toBe('ok');
    expect((await sync(a, 'a')).state).toBe('ok');
    expect(read(a, '.gitignore').split('\n').filter(line => line === '.edu-local/')).toHaveLength(1);
    expect(git(a.vault, 'ls-tree', '-r', '--name-only', 'origin/main')).not.toContain('.edu-local');
  });

  it.skipIf(process.platform === 'win32')('refuses a repository .gitignore that links outside the vault', async () => {
    const sentinel = join(root, 'outside.txt');
    writeFileSync(sentinel, 'do not touch\n');
    symlinkSync(sentinel, join(a.vault, '.gitignore'));
    git(a.vault, 'add', '-A');
    git(a.vault, 'commit', '-qm', 'malicious');
    git(a.vault, 'push', '-q', 'origin', 'main');
    const c = machine('c');
    write(c, '01-CONOCIMIENTO/1-canonical/D-c.md', note('from c'));
    const result = await sync(c, 'c');
    expect(result.state).toBe('error');
    expect(result.message).toMatch(/symbolic link/);
    expect(readFileSync(sentinel, 'utf8')).toBe('do not touch\n');
  });

  describe('a log append racing the merge', () => {
    const log = '01-CONOCIMIENTO/0-index/log.md';
    const diverge = async () => {
      write(a, log, '# Log\n\n## [2026-11-01 09:00] seed\n');
      await sync(a, 'a');
      await sync(b, 'b');
      write(a, log, '# Log\n\n## [2026-11-01 09:00] seed\n## [2026-11-02 11:00] from a\n');
      await sync(a, 'a');
      write(b, log, '# Log\n\n## [2026-11-01 09:00] seed\n## [2026-11-02 10:30] from b\n');
    };

    it('waits for the sync: a brain writer appending mid-merge keeps its line', async () => {
      await diverge();
      const brain = join(b.home, 'brain');
      let pending: Promise<void> | undefined;
      const result = await syncBrain({ eduHome: b.home, host: 'b', env, hooks: { beforeAppendOnlyWrite: async () => {
        pending = appendLog(brain, { op: 'write', id: 'N-race', title: 'raced the merge', at: new Date('2026-11-03T08:00:00Z') });
        // Holding the log lock, the writer waits for the sync; without it, it appends now and the merge overwrites it.
        if (!existsSync(logLockDir(realpathSync(brain)))) await pending;
      } } });
      await pending;
      expect(result.state).toBe('ok');
      expect(result.merged).toEqual([log]);
      const text = read(b, log);
      expect(text).toContain('from a');
      expect(text).toContain('from b');
      expect(text).toContain('N-race');
    });

    it('keeps a line that reached the working tree during the merge', async () => {
      await diverge();
      const result = await syncBrain({ eduHome: b.home, host: 'b', env, hooks: { beforeAppendOnlyWrite: async () => {
        appendFileSync(join(b.vault, log), '## [2026-11-03 09:00] direct append\n');
      } } });
      expect(result.state).toBe('ok');
      expect(read(b, log)).toBe('# Log\n\n## [2026-11-01 09:00] seed\n## [2026-11-02 10:30] from b\n## [2026-11-02 11:00] from a\n## [2026-11-03 09:00] direct append\n');
    });
  });

  it('runs no git rm when nothing under .edu-local is tracked', async () => {
    const trace = join(root, 'trace.txt');
    await ensureRepoFiles(a.vault, { ...env, GIT_TRACE: trace });
    expect(readFileSync(trace, 'utf8')).not.toMatch(/git rm\b|'rm'/);
    write(a, '01-CONOCIMIENTO/.edu-local/usage.json', '{}\n');
    git(a.vault, 'add', '-f', '--', '01-CONOCIMIENTO/.edu-local/usage.json');
    expect(await ensureRepoFiles(a.vault, env)).toContain('.edu-local/ (no longer tracked)');
    expect(git(a.vault, 'ls-files', '--', '01-CONOCIMIENTO/.edu-local')).toBe('');
  });

  it('lists conflict branches and redacts the remote', async () => {
    write(a, '01-CONOCIMIENTO/1-canonical/D-x.md', note('edited on a'));
    await sync(a, 'a');
    write(b, '01-CONOCIMIENTO/1-canonical/D-x.md', note('edited on b'));
    const result = await sync(b, 'b');
    expect(await conflictBranches(b.vault, env)).toEqual([result.branch]);
    git(b.vault, 'remote', 'set-url', 'origin', 'https://user:s3cretT0ken@example.invalid/x/edu-vault.git');
    expect(await remoteUrl(b.vault, env)).toBe('https://***@example.invalid/x/edu-vault.git');
    const offline = await sync(b, 'b');
    expect(offline.state).toBe('offline');
    expect(offline.message).not.toContain('s3cretT0ken');
  });
});

describe('profile isolation', () => {
  const published = () => git(join(root, 'remote.git'), 'rev-parse', 'main');

  it('refuses a personal sync whose origin is cheil-vault and does not push', async () => {
    const before = published();
    git(a.vault, 'remote', 'set-url', 'origin', 'https://github.com/EduardoMCheil/cheil-vault.git');
    write(a, '01-CONOCIMIENTO/1-canonical/D-z.md', note('leak'));
    git(a.vault, 'add', '-A');
    const result = await sync(a, 'a');
    expect(result.state).toBe('error');
    expect(result.message).toContain('cheil profile');
    expect(published()).toBe(before);
    expect(git(a.vault, 'log', '-1', '--format=%s')).toBe('seed');
  });

  it('refuses a personal sync when a staged path resolves under C:\\Cheil', async () => {
    const before = published();
    write(a, '01-CONOCIMIENTO/1-canonical/D-z.md', note('leak'));
    git(a.vault, 'add', '-A');
    const result = await syncBrain({
      eduHome: a.home, host: 'a', env,
      resolvePath: async () => 'C:\\Cheil\\_CONOCIMIENTO\\D-z.md',
    });
    expect(result.state).toBe('error');
    expect(result.message).toContain('D-z.md');
    expect(published()).toBe(before);
    expect(git(a.vault, 'log', '-1', '--format=%s')).toBe('seed');
  });

  it('refuses a cheil sync whose origin is edu-vault and does not push', async () => {
    writeFileSync(join(a.home, 'profile.json'), JSON.stringify({
      id: 'cheil', home: a.home, brain: join(a.home, 'brain'), remote: CHEIL_REMOTE,
    }));
    const before = published();
    git(a.vault, 'remote', 'set-url', 'origin', 'git@github.com:EduardoMoraga/edu-vault.git');
    write(a, '01-CONOCIMIENTO/1-canonical/D-z.md', note('leak'));
    const result = await sync(a, 'a');
    expect(result.state).toBe('error');
    expect(result.message).toContain('personal profile');
    expect(published()).toBe(before);
    expect(git(a.vault, 'log', '-1', '--format=%s')).toBe('seed');
  });

  it('refuses a cheil sync when a conflicted path resolves outside the cheil vault', async () => {
    writeFileSync(join(b.home, 'profile.json'), JSON.stringify({
      id: 'cheil', home: b.home, brain: join(b.home, 'brain'), remote: CHEIL_REMOTE,
    }));
    write(a, '01-CONOCIMIENTO/1-canonical/D-x.md', note('from a'));
    await sync(a, 'a');
    write(b, '01-CONOCIMIENTO/1-canonical/D-x.md', note('from b'));
    git(b.vault, 'commit', '-am', 'local');
    let conflicted = false;
    try { git(b.vault, 'pull', '--no-rebase', 'origin', 'main'); }
    catch { conflicted = true; }
    expect(conflicted).toBe(true);
    const before = published();
    const result = await syncBrain({
      eduHome: b.home, host: 'b', env,
      resolvePath: async file => file.endsWith('D-x.md') ? 'C:\\Users\\edu\\notes\\D-x.md' : file,
    });
    expect(result.state).toBe('error');
    expect(result.message).toContain('D-x.md');
    expect(published()).toBe(before);
  });
});

describe('sync helpers', () => {
  it('recognizes generated files', () => {
    expect(isGenerated('01-CONOCIMIENTO/0-index/INDEX.md')).toBe(true);
    expect(isGenerated('00-INICIO/Panel.md')).toBe(true);
    expect(isGenerated('00-START/Dashboard.md')).toBe(true);
    expect(isGenerated('vault/00-START/Dashboard.md')).toBe(true);
    expect(isGenerated('notes/00-START/Dashboard.md.bak')).toBe(false);
    expect(isGenerated('01-CONOCIMIENTO/0-index/catalog.md')).toBe(true);
    expect(isGenerated('01-CONOCIMIENTO/0-index/log.md')).toBe(false);
    expect(isAppendOnly('01-CONOCIMIENTO/0-index/log.md')).toBe(true);
    expect(isGenerated('x/Conocimiento.base')).toBe(true);
    expect(isGenerated('01-CONOCIMIENTO/1-canonical/D-x.md')).toBe(false);
  });
  it('unions append-only logs: deduped, chronological, upstream first on ties', () => {
    const upstream = '# Log\n\n## [2026-11-02 10:00] u1\n## [2026-11-03 10:00] same\n';
    const local = '# Log\n\n## [2026-11-01 08:00] l0\n## [2026-11-03 10:00] same\n## [2026-11-03 10:00] tie\n';
    expect(mergeAppendOnly(upstream, local))
      .toBe('# Log\n\n## [2026-11-01 08:00] l0\n## [2026-11-02 10:00] u1\n## [2026-11-03 10:00] same\n## [2026-11-03 10:00] tie\n');
  });
  it('ignores only frontmatter counters', () => {
    expect(withoutCounters(note('a', 1))).toBe(withoutCounters(note('a', 2)));
    expect(withoutCounters(note('a'))).not.toBe(withoutCounters(note('b')));
    expect(withoutCounters('no frontmatter\nupdated: 1')).toBe('no frontmatter\nupdated: 1');
    expect(withoutCounters(note('a', 1).replace(/\n/g, '\r\n'))).toBe(withoutCounters(note('a', 2)));
  });
  it('combines all usage counters by max and dates by latest', () => {
    const up = '---\nid: D-x\nupdated: 2026-11-02T00:00:00Z\nusage:\n  uses: 9\n  wins: 1\n  losses: 5\n  lastUsed: 2026-11-01T00:00:00Z\n---\n\nSame\n';
    const mine = '---\nid: D-x\nupdated: 2026-11-01T00:00:00Z\nusage:\n  uses: 3\n  wins: 4\n  losses: 2\n  lastUsed: 2026-11-03T00:00:00Z\n---\n\nSame\n';
    expect(withoutCounters(up)).toBe(withoutCounters(mine.replace(/\n/g, '\r\n')));
    const merged = mergeCounters(up, mine);
    expect(merged).toContain('uses: 9');
    expect(merged).toContain('wins: 4');
    expect(merged).toContain('losses: 5');
    expect(merged).toContain('lastUsed: 2026-11-03T00:00:00Z');
    expect(merged).toContain('updated: 2026-11-02T00:00:00Z');
  });
  it('spots session notes with no content', () => {
    expect(isEmptySession('---\nid: s\n---\n\nPi session x ended (exit).\n')).toBe(true);
    expect(isEmptySession('---\nid: s\n---\n\nReal summary.\n')).toBe(false);
  });
});
