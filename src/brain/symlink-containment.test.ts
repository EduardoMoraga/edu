import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openBrain } from './brain.js';
import { appendLog } from './catalog.js';
import { resetLedgerCache } from './ledger.js';
import { atomicWrite, resetNoteCache } from './store.js';

// Symlinks need privileges on Windows; the containment logic is the same there (junctions report as links).
const posix = process.platform !== 'win32';
const dirs: string[] = [];
async function temp() { const path = await mkdtemp(join(tmpdir(), 'edu-symlink-')); dirs.push(path); return path; }
let warnings: string[] = [];
beforeEach(() => {
  warnings = [];
  vi.spyOn(process, 'emitWarning').mockImplementation(((message: string | Error) => { warnings.push(String(message)); }) as typeof process.emitWarning);
});
afterEach(async () => {
  vi.restoreAllMocks(); resetNoteCache(); resetLedgerCache();
  await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

/** A project brain plus an external folder holding a sentinel file. */
async function fixture() {
  const base = await temp();
  const root = join(base, 'project', '.edu');
  const brainDir = join(root, 'brain');
  const outside = join(base, 'outside');
  await mkdir(outside, { recursive: true });
  const sentinel = join(outside, 'sentinel.txt');
  await writeFile(sentinel, 'SENTINEL\n');
  const brain = openBrain([{ scope: 'project', root }]);
  await brain.init({ scope: 'project', root });
  return { base, root, brainDir, outside, sentinel, brain };
}

describe.runIf(posix)('brain writes never follow symbolic links out of the brain', () => {
  it('skips a log.md that is a symlink to an external file (remote-controlled log)', async () => {
    const { brainDir, sentinel, brain } = await fixture();
    await symlink(sentinel, join(brainDir, '0-index', 'log.md'));
    const { note } = await brain.remember({ tier: 'transitive', kind: 'lesson', title: 'Injected external append', body: 'Review test' });
    expect(await readFile(note.path, 'utf8')).toContain('Review test');
    expect(await readFile(sentinel, 'utf8')).toBe('SENTINEL\n');
    expect(warnings.some(w => /log\.md.*symbolic link/.test(w))).toBe(true);
    await appendLog(brainDir, { op: 'write', id: 'x', title: 'direct append' });
    expect(await readFile(sentinel, 'utf8')).toBe('SENTINEL\n');
  });

  it('skips catalog, INDEX, views and log when 0-index is a symlink to an external folder', async () => {
    const { brainDir, outside, brain } = await fixture();
    await rm(join(brainDir, '0-index'), { recursive: true });
    await symlink(outside, join(brainDir, '0-index'));
    await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Kept inside', body: 'body' });
    await brain.rebuildIndex();
    expect(await readdir(outside)).toEqual(['sentinel.txt']);
    expect(warnings.some(w => /0-index is a symbolic link/.test(w))).toBe(true);
  });

  it('leaves a symlinked catalog.md in place instead of writing it', async () => {
    const { brainDir, sentinel, brain } = await fixture();
    const catalog = join(brainDir, '0-index', 'catalog.md');
    await symlink(sentinel, catalog);
    await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Catalog change', body: 'body' });
    expect((await lstat(catalog)).isSymbolicLink()).toBe(true);
    expect(await readFile(sentinel, 'utf8')).toBe('SENTINEL\n');
  });

  it('refuses a note write whose folder is a symlink out of the brain', async () => {
    const { brainDir, outside, brain } = await fixture();
    await rm(join(brainDir, '3-transitive'), { recursive: true });
    await symlink(outside, join(brainDir, '3-transitive'));
    await expect(brain.write({ tier: 'transitive', kind: 'lesson', title: 'Escapes', body: 'body' })).rejects.toThrow(/3-transitive is a symbolic link/);
    expect(await readdir(outside)).toEqual(['sentinel.txt']);
  });

  it('refuses to overwrite a note file that is itself a symlink', async () => {
    const { brainDir, sentinel, brain } = await fixture();
    await symlink(sentinel, join(brainDir, '3-transitive', 'L-linked.md'));
    await expect(brain.write({ tier: 'transitive', kind: 'lesson', title: 'Linked', body: 'body' })).rejects.toThrow(/symbolic link/);
    expect((await lstat(join(brainDir, '3-transitive', 'L-linked.md'))).isSymbolicLink()).toBe(true);
    expect(await readFile(sentinel, 'utf8')).toBe('SENTINEL\n');
  });

  it('never writes the usage ledger or .gitignore through a symlink', async () => {
    const { root, outside, sentinel, brain } = await fixture();
    const note = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Recalled', body: 'ledger body' });
    await rm(join(root, '.edu-local'), { recursive: true, force: true });
    await symlink(outside, join(root, '.edu-local'));
    await rm(join(root, '.gitignore'), { force: true });
    await symlink(sentinel, join(root, '.gitignore'));
    resetLedgerCache();
    const again = openBrain([{ scope: 'project', root }]);
    await again.recall('ledger body');
    await again.feedback(note.meta.id, true);
    expect(await readdir(outside)).toEqual(['sentinel.txt']);
    expect(await readFile(sentinel, 'utf8')).toBe('SENTINEL\n');
  });

  it('writes normally when the brain root itself is reached through a symlink', async () => {
    const base = await temp();
    const real = join(base, 'vault', '01-CONOCIMIENTO');
    await mkdir(real, { recursive: true });
    const root = join(base, 'home', '.edu');
    await mkdir(root, { recursive: true });
    await symlink(real, join(root, 'brain'));
    const brain = openBrain([{ scope: 'global', root }]);
    await brain.init({ scope: 'global', root });
    const note = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Through the link', body: 'body' });
    await brain.rebuildIndex();
    expect(await readFile(join(real, '3-transitive', `${note.meta.id}.md`), 'utf8')).toContain('Through the link');
    expect(await readFile(join(real, '0-index', 'catalog.md'), 'utf8')).toContain(note.meta.id);
    expect(await readFile(join(real, '0-index', 'log.md'), 'utf8')).toContain(note.meta.id);
    // A target spelled through the root's real path is inside too.
    await atomicWrite(join(real, '0-index', 'extra.md'), 'x', { root: join(root, 'brain') });
    expect(warnings).toEqual([]);
  });

  it('accepts a root spelled through a linked ancestor (macOS /var → /private/var)', async () => {
    const real = await temp();
    const alias = `${real}-alias`; dirs.push(alias);
    await symlink(real, alias);
    await mkdir(join(real, 'brain'), { recursive: true });
    // Root spelled through the real path, target through the alias, and the other way round.
    await atomicWrite(join(alias, 'brain', '0-index', 'a.md'), 'a', { root: join(real, 'brain') });
    await atomicWrite(join(real, 'brain', '0-index', 'b.md'), 'b', { root: join(alias, 'brain') });
    expect(await readFile(join(real, 'brain', '0-index', 'a.md'), 'utf8')).toBe('a');
    expect(await readFile(join(real, 'brain', '0-index', 'b.md'), 'utf8')).toBe('b');
    // A link below the root is still refused, however the root is spelled.
    await symlink(await temp(), join(real, 'brain', '3-transitive'));
    await expect(atomicWrite(join(alias, 'brain', '3-transitive', 'x.md'), 'x', { root: join(real, 'brain') })).rejects.toThrow(/symbolic link/);
  });

  it('atomicWrite without a root replaces a symlinked target instead of following it', async () => {
    const { brainDir, sentinel } = await fixture();
    const link = join(brainDir, 'linked.md');
    await symlink(sentinel, link);
    await atomicWrite(link, 'replaced');
    expect((await lstat(link)).isSymbolicLink()).toBe(false);
    expect(await readFile(link, 'utf8')).toBe('replaced');
    expect(await readFile(sentinel, 'utf8')).toBe('SENTINEL\n');
  });
});
