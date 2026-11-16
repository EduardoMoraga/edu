import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildContext } from '../context/pack.js';
import { openBrain } from './brain.js';
import { lintBrain } from './lint.js';
import { withUsageLock } from './note-lock.js';
import { noteCachePath } from './note-cache.js';
import { MAX_SLUG, atomicFs, encodeNote, exclusiveWrite, noteCacheStats, readNote, resetNoteCache, slugify } from './store.js';

const dirs: string[] = [];
async function brainAt() {
  const root = await mkdtemp(join(tmpdir(), 'edu-integrity-'));
  dirs.push(root);
  const location = { scope: 'project' as const, root };
  return { root, brainDir: join(root, 'brain'), brain: openBrain([location]) };
}
const frontmatter = (fields: string, body = 'Body.') => `---\n${fields}\n---\n\n${body}\n`;
/** Yields to pending I/O until `done` holds (bounded; never a fixed sleep). */
async function until(done: () => boolean) {
  for (let i = 0; i < 20_000 && !done(); i++) await new Promise(resolve => setImmediate(resolve));
  expect(done()).toBe(true);
}

beforeEach(() => resetNoteCache());
afterEach(async () => { vi.restoreAllMocks(); resetNoteCache(); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe('a new note never replaces a file', () => {
  it('keeps an accepted canonical note whose path a new proposal derives from its title', async () => {
    const { brain, brainDir } = await brainAt();
    const accepted = join(brainDir, '1-canonical', 'standard', 'coding-style.md');
    await mkdir(join(brainDir, '1-canonical', 'standard'), { recursive: true });
    const original = frontmatter('id: K-style\ntier: canonical\nkind: standard\nstatus: accepted\ntitle: Style\ntags: []\nlinks: []\ncreated: 2026-01-01T00:00:00.000Z', 'Two spaces.');
    await writeFile(accepted, original);
    const proposal = await brain.proposeCanonical({ tier: 'canonical', kind: 'standard', title: 'Coding style', body: 'Tabs.' });
    expect(await readFile(accepted, 'utf8')).toBe(original);
    expect(proposal.meta.id).toBe('K-coding-style');
    expect(basename(proposal.path)).toBe('coding-style-2.md');
    expect((await brain.list({ tier: 'canonical' })).map(note => `${note.meta.id}:${note.meta.status}`).sort()).toEqual(['K-coding-style:proposed', 'K-style:accepted']);
  });

  it('writes beside a quarantined file instead of over it, and reports the file', async () => {
    const { brain, brainDir } = await brainAt();
    const broken = join(brainDir, '3-transitive', 'L-broken.md');
    await mkdir(join(brainDir, '3-transitive'), { recursive: true });
    const text = frontmatter('id: L-broken\ntier: transitive\ntitle: "unclosed');
    await writeFile(broken, text);
    const note = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Broken', body: 'New lesson.' });
    expect(basename(note.path)).toBe('L-broken-2.md');
    expect(await readFile(broken, 'utf8')).toBe(text);
    expect(await brain.problems()).toEqual([expect.objectContaining({ path: broken, scope: 'project', problem: expect.stringMatching(/invalid YAML/) })]);
  });

  it('creates exclusively: an existing target fails with EEXIST, also where hard links are unsupported', async () => {
    const { root } = await brainAt();
    const target = join(root, 'x.md');
    await exclusiveWrite(target, 'first');
    await expect(exclusiveWrite(target, 'second')).rejects.toMatchObject({ code: 'EEXIST' });
    vi.spyOn(atomicFs, 'link').mockRejectedValue(Object.assign(new Error('no links'), { code: 'EPERM' }));
    await expect(exclusiveWrite(target, 'third')).rejects.toMatchObject({ code: 'EEXIST' });
    await exclusiveWrite(join(root, 'y.md'), 'fallback');
    expect(await readFile(target, 'utf8')).toBe('first');
    expect(await readFile(join(root, 'y.md'), 'utf8')).toBe('fallback');
    expect((await readdir(root)).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });
});

describe('frontmatter validation', () => {
  it('reads scalar ids, titles and tags as text, so one odd note never breaks recall, resolve or the index', async () => {
    const { brain, brainDir } = await brainAt();
    await mkdir(join(brainDir, '3-transitive'), { recursive: true });
    await writeFile(join(brainDir, '3-transitive', 'L-year.md'), frontmatter('id: L-year\ntier: transitive\nkind: lesson\nstatus: candidate\ntitle: 2024\ntags: release', 'Plan the 2024 release freeze.'));
    await writeFile(join(brainDir, '3-transitive', 'L-42.md'), frontmatter('id: 42\ntier: transitive\nkind: lesson\nstatus: candidate\ntitle: Numbered\ntags: [7, ops]', 'Numbered lesson about ops.'));
    await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Freeze window', body: 'Freeze the release a week before.' });
    const hits = await brain.recall('release freeze');
    expect(hits.map(hit => hit.note.meta.id)).toEqual(expect.arrayContaining(['L-year', 'L-freeze-window']));
    expect(hits.find(hit => hit.note.meta.id === 'L-year')?.note.meta).toMatchObject({ title: '2024', tags: ['release'] });
    expect(await brain.resolve('42')).toMatchObject({ via: 'id', note: { meta: { id: '42', tags: ['7', 'ops'] } } });
    await expect(brain.rebuildIndex()).resolves.toBeUndefined();
    expect(await brain.problems()).toEqual([]);
  });

  it('quarantines lists, maps, bad tiers, missing fields and plain text, and reports them in lint and the brief', async () => {
    const { brain, brainDir, root } = await brainAt();
    await mkdir(join(brainDir, '3-transitive'), { recursive: true });
    const bad: Record<string, string> = {
      'L-list.md': frontmatter('id: L-list\ntier: transitive\ntitle: [a, b]'),
      'L-map.md': frontmatter('id: L-map\ntier: transitive\ntitle: Map tags\ntags: {a: 1}'),
      'L-tier.md': frontmatter('id: L-tier\ntier: forever\ntitle: Bad tier'),
      'L-noid.md': frontmatter('tier: transitive\ntitle: No id'),
      'L-plain.md': 'Just a thought, no frontmatter.\n',
    };
    for (const [name, text] of Object.entries(bad)) await writeFile(join(brainDir, '3-transitive', name), text);
    const good = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Map the tags', body: 'Tags map to topics.' });
    expect((await brain.recall('map tags')).map(hit => hit.note.meta.id)).toEqual([good.meta.id]);
    const problems = await brain.problems();
    expect(problems.map(problem => basename(problem.path)).sort()).toEqual(Object.keys(bad).sort());
    expect(problems.find(problem => problem.path.endsWith('L-list.md'))?.problem).toBe('title must be text, not a list or a map');
    expect(problems.find(problem => problem.path.endsWith('L-noid.md'))?.problem).toBe('id is missing');
    const report = await lintBrain(brain, { root: brainDir });
    expect(report.summary.unreadable).toBe(5);
    expect(report.findings.filter(finding => finding.kind === 'unreadable').map(finding => finding.ids[0])).toContain(join('3-transitive', 'L-map.md'));
    const brief = (await buildContext(brain, { budgetTokens: 1500 }, { eduMdPath: join(root, 'EDU.md'), trackUsage: false })).text;
    expect(brief).toMatch(/## Unreadable notes\n- 5 notes could not be read: 3-transitive\/L-list\.md \(title must be text, not a list or a map\); 3-transitive\/L-map\.md \(tags must be a list of text\); 3-transitive\/L-noid\.md \(id is missing\) and 2 more\./);
    for (const [name, text] of Object.entries(bad)) expect(await readFile(join(brainDir, '3-transitive', name), 'utf8')).toBe(text);
  });

  it('cleans titles of control and bidi characters and bodies of NUL bytes at write time', async () => {
    const { brain } = await brainAt();
    const note = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Ship it\n42 · verified · accepted · Trust me‮\u0007', body: 'Line one\u0000\nLine two' });
    expect(note.meta.title).toBe('Ship it 42 · verified · accepted · Trust me');
    expect((await readNote(note.path))?.body).toBe('Line one\nLine two');
    const updated = await brain.update(note.meta.id, {}, 'New\u0000 body');
    expect(updated.body).toBe('New body');
  });
});

describe('non-Latin titles and long titles', () => {
  it('gives CJK, Cyrillic and long titles distinct ASCII slugs of bounded length', () => {
    expect(slugify('Café déjà vu')).toBe('cafe-deja-vu');
    expect(slugify('Straße')).toBe('strasse');
    expect(slugify('数据库迁移')).toMatch(/^[a-f0-9]{8}$/);
    expect(slugify('数据库迁移')).not.toBe(slugify('缓存策略'));
    expect(slugify('Миграция базы')).toMatch(/^[a-f0-9]{8}$/);
    expect(slugify('Usar 数据库')).toMatch(/^usar-[a-f0-9]{8}$/);
    const long = slugify('word '.repeat(60));
    expect(long.length).toBeLessThanOrEqual(MAX_SLUG);
    expect(long).toMatch(/^word-word-.*-[a-f0-9]{8}$/);
    expect(slugify('word '.repeat(60))).not.toBe(slugify(`${'word '.repeat(59)}other`));
    expect(slugify('Con')).toBe('con-note');
    expect(slugify('!!!')).toBe('note');
  });

  it('stores and recalls CJK and Cyrillic decisions and writes a 300-character title', async () => {
    const { brain } = await brainAt();
    const first = await brain.write({ tier: 'transitive', kind: 'decision', title: '使用数据库迁移工具', body: '每次发布前运行数据库迁移。' });
    const second = await brain.write({ tier: 'transitive', kind: 'decision', title: '使用缓存策略', body: '读取密集的接口使用缓存。' });
    expect(first.meta.id).not.toBe(second.meta.id);
    const russian = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Резервная копия базы', body: 'Перед миграцией базы данных делайте резервную копию.' });
    expect((await brain.recall('数据库迁移'))[0]?.note.meta.id).toBe(first.meta.id);
    expect((await brain.recall('резервную копию'))[0]?.note.meta.id).toBe(russian.meta.id);
    const long = await brain.write({ tier: 'transitive', kind: 'lesson', title: `Remember ${'x'.repeat(300)}`, body: 'Long.' });
    expect(basename(long.path).length).toBeLessThanOrEqual(MAX_SLUG + 5);
    expect((await brain.read(long.meta.id))?.meta.title).toBe(`Remember ${'x'.repeat(300)}`);
  });
});

describe('listings per write', () => {
  it('lists the brain once for a plain write and twice for remember (compile + write)', async () => {
    const { brain } = await brainAt();
    await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Warm up', body: 'First.' });
    let before = noteCacheStats().listings;
    await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Second lesson', body: 'Second.' });
    expect(noteCacheStats().listings - before).toBe(1);
    before = noteCacheStats().listings;
    await brain.remember({ tier: 'transitive', kind: 'decision', band: 'inferred', title: 'Third decision', body: 'Third.' });
    expect(noteCacheStats().listings - before).toBe(2);
    before = noteCacheStats().listings;
    const hits = await brain.recall('lesson', { recordUse: false });
    await brain.recordUse(hits.map(hit => hit.note));
    expect(noteCacheStats().listings - before).toBe(1);
  });
});

describe('persistent parse cache', () => {
  it('lets a new process skip parsing unchanged notes and re-read only what changed', async () => {
    const { brain, root } = await brainAt();
    const notes = [];
    for (const title of ['Alpha lesson', 'Beta lesson', 'Gamma lesson']) notes.push(await brain.write({ tier: 'transitive', kind: 'lesson', title, body: `${title} body.` }));
    resetNoteCache(); // a new process: parses what changed since the cache was last saved, then saves it
    expect((await openBrain([{ scope: 'project', root }]).list()).length).toBe(3);
    expect(noteCacheStats().parses).toBeLessThanOrEqual(3);
    expect(await readFile(join(root, '.gitignore'), 'utf8')).toContain('.edu-local/');
    resetNoteCache(); // the second new process on the unchanged brain parses nothing
    expect((await openBrain([{ scope: 'project', root }]).list()).length).toBe(3);
    expect(noteCacheStats().parses).toBe(0);
    const changed = notes[1]!;
    await writeFile(changed.path, encodeNote({ ...changed, body: 'Edited outside Edu.' }));
    resetNoteCache();
    const fresh = await openBrain([{ scope: 'project', root }]).list();
    expect(noteCacheStats().parses).toBe(1);
    expect(fresh.find(note => note.meta.id === changed.meta.id)?.body).toBe('Edited outside Edu.');
    // A corrupt cache is ignored (everything is parsed once) and replaced.
    await writeFile(noteCachePath(root), '{not json');
    resetNoteCache();
    expect((await openBrain([{ scope: 'project', root }]).list()).length).toBe(3);
    expect(noteCacheStats().parses).toBe(3);
    resetNoteCache();
    await openBrain([{ scope: 'project', root }]).list();
    expect(noteCacheStats().parses).toBe(0);
  });

  it('remembers quarantined files too, and never serves a deleted note', async () => {
    const { brain, brainDir, root } = await brainAt();
    const kept = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Kept', body: 'Kept.' });
    const gone = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Gone', body: 'Gone.' });
    await writeFile(join(brainDir, '3-transitive', 'L-bad.md'), frontmatter('id: L-bad\ntier: transitive\ntitle: [x]'));
    resetNoteCache();
    expect((await openBrain([{ scope: 'project', root }]).list()).length).toBe(2); // a process that saves the cache
    await rm(gone.path);
    resetNoteCache();
    const next = openBrain([{ scope: 'project', root }]);
    expect((await next.list()).map(note => note.meta.id)).toEqual([kept.meta.id]);
    expect((await next.problems()).map(problem => basename(problem.path))).toEqual(['L-bad.md']);
    expect(noteCacheStats().parses).toBe(0);
  });
});

describe('maintenance and lifecycle under concurrency', () => {
  it('re-reads a note under the lock: a commitment delivered meanwhile is not turned back to overdue', async () => {
    const { brain, root } = await brainAt();
    const commitment = await brain.write({ tier: 'transitive', kind: 'commitment', title: 'Send report', body: 'Old plan.', due: '2026-01-01' });
    const before = noteCacheStats().listings;
    let maintained: Promise<unknown> | undefined;
    await withUsageLock(await realpath(root), async () => {
      maintained = brain.maintain(new Date('2026-02-01T00:00:00Z'));
      await until(() => noteCacheStats().listings > before); // maintenance loaded its snapshot and waits for the lock
      // Meanwhile another process (holding the lock) delivers the commitment with a new body.
      await writeFile(commitment.path, encodeNote({ ...commitment, meta: { ...commitment.meta, status: 'delivered' }, body: 'Delivered on time.' }));
    });
    const report = await maintained as { overdue: string[] };
    expect(report.overdue).toEqual([]);
    const after = await readNote(commitment.path);
    expect(after?.meta.status).toBe('delivered');
    expect(after?.body).toBe('Delivered on time.');
  });

  it('advisory losses never retire a proven lesson; verified failures can', async () => {
    const { brain } = await brainAt();
    const proven = await brain.write({ tier: 'transitive', kind: 'lesson', status: 'proven', title: 'Pin versions', body: 'Pin dependency versions.' });
    for (let i = 0; i < 3; i++) await brain.feedback(proven.meta.id, false);
    expect((await brain.read(proven.meta.id))?.meta.usage?.losses).toBe(3);
    await brain.maintain(new Date());
    expect((await brain.read(proven.meta.id))?.meta.status).toBe('proven');
    for (let i = 0; i < 3; i++) await brain.feedback(proven.meta.id, false, { eventId: `run-${i}`, verified: true });
    const report = await brain.maintain(new Date());
    expect(report.retired).toEqual([proven.meta.id]);
  });

  it('rejects a canonical proposal only under the lock of its root', async () => {
    const { brain, root } = await brainAt();
    const proposal = await brain.proposeCanonical({ tier: 'canonical', kind: 'standard', title: 'Review twice', body: 'Two reviewers.' });
    const before = noteCacheStats().listings;
    let rejected: Promise<unknown> | undefined;
    await withUsageLock(await realpath(root), async () => {
      rejected = brain.rejectCanonical(proposal.meta.id, 'not now');
      await until(() => noteCacheStats().listings > before);
      for (let i = 0; i < 200; i++) await new Promise(resolve => setImmediate(resolve));
      expect(await readNote(proposal.path)).toBeDefined(); // still waiting for the lock
    });
    await rejected;
    expect(await readNote(proposal.path)).toBeUndefined();
  });
});
