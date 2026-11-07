import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isEmptySession, isGenerated, syncBrain, withoutCounters } from './sync.js';

const env = { ...process.env, GIT_AUTHOR_NAME: 'Edu', GIT_AUTHOR_EMAIL: 'edu@example.com', GIT_COMMITTER_NAME: 'Edu', GIT_COMMITTER_EMAIL: 'edu@example.com', GIT_CONFIG_NOSYSTEM: '1' };
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

  it('takes upstream when both sides changed only usage counters', async () => {
    write(a, '01-CONOCIMIENTO/1-canonical/D-x.md', note('first', 2));
    await sync(a, 'a');
    write(b, '01-CONOCIMIENTO/1-canonical/D-x.md', note('first', 3));
    const result = await sync(b, 'b');
    expect(result.state).toBe('ok');
    expect(read(b, '01-CONOCIMIENTO/1-canonical/D-x.md')).toBe(note('first', 2));
  });

  it('moves a real conflict to a branch and keeps syncing', async () => {
    write(a, '01-CONOCIMIENTO/1-canonical/D-x.md', note('edited on a'));
    await sync(a, 'a');
    write(b, '01-CONOCIMIENTO/1-canonical/D-x.md', note('edited on b'));
    const result = await sync(b, 'b');
    expect(result.state).toBe('conflict');
    expect(result.branch).toMatch(/^sync-conflict\/b-[0-9a-f]+$/);
    expect(git(b.vault, 'ls-remote', '--heads', 'origin', result.branch!)).not.toBe('');
    expect(git(b.vault, 'show', `${result.branch}:01-CONOCIMIENTO/1-canonical/D-x.md`)).toContain('edited on b');
    expect(read(b, '01-CONOCIMIENTO/1-canonical/D-x.md')).toContain('edited on a');
    write(b, '01-CONOCIMIENTO/1-canonical/D-z.md', note('later'));
    expect((await sync(b, 'b')).state).toBe('ok');
    expect((await sync(a, 'a')).state).toBe('ok');
    expect(read(a, '01-CONOCIMIENTO/1-canonical/D-z.md')).toContain('later');
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
});

describe('sync helpers', () => {
  it('recognizes generated files', () => {
    expect(isGenerated('01-CONOCIMIENTO/0-index/INDEX.md')).toBe(true);
    expect(isGenerated('00-INICIO/Panel.md')).toBe(true);
    expect(isGenerated('x/Conocimiento.base')).toBe(true);
    expect(isGenerated('01-CONOCIMIENTO/1-canonical/D-x.md')).toBe(false);
  });
  it('ignores only frontmatter counters', () => {
    expect(withoutCounters(note('a', 1))).toBe(withoutCounters(note('a', 2)));
    expect(withoutCounters(note('a'))).not.toBe(withoutCounters(note('b')));
    expect(withoutCounters('no frontmatter\nupdated: 1')).toBe('no frontmatter\nupdated: 1');
  });
  it('spots session notes with no content', () => {
    expect(isEmptySession('---\nid: s\n---\n\nPi session x ended (exit).\n')).toBe(true);
    expect(isEmptySession('---\nid: s\n---\n\nReal summary.\n')).toBe(false);
  });
});
