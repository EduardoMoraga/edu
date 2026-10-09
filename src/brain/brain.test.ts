import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { openBrain } from './brain.js';
import { atomicWrite } from './store.js';

const dirs: string[] = [];
async function temp() { const path = await mkdtemp(join(tmpdir(), 'edu-brain-')); dirs.push(path); return path; }
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('brain API', () => {
  it('atomically writes and reads notes, then records recall usage feedback', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const note = await brain.write({ title: 'Keep contracts frozen', body: 'Stable contract', tier: 'transitive', kind: 'lesson' });
    expect((await brain.recall('frozen contract'))[0]?.note.meta.id).toBe(note.meta.id);
    expect((await brain.read(note.meta.id))?.meta.usage?.uses).toBe(1);
    expect((await brain.feedback(note.meta.id, true)).meta.usage?.wins).toBe(1);
  });
  it('overlays project notes over global notes with matching ids', async () => {
    const global = await temp(), project = await temp();
    const g = openBrain([{ scope: 'global', root: global }]);
    const p = openBrain([{ scope: 'project', root: project }]);
    const a = await g.write({ title: 'Shared note', body: 'global', tier: 'transitive', kind: 'lesson' });
    await p.write({ title: 'Shared note', body: 'project', tier: 'transitive', kind: 'lesson' });
    expect((await openBrain([{ scope: 'project', root: project }, { scope: 'global', root: global }]).read(a.meta.id))?.body).toBe('project');
  });
  it('keeps closed sessions immutable and emits Obsidian indexes', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const session = await brain.openSession('Pairing', 'test');
    await brain.closeSession(session.meta.id, 'Finished session');
    await expect(brain.update(session.meta.id, {}, 'rewrite')).rejects.toThrow('immutable');
    await brain.recall('Finished session');
    await expect(brain.feedback(session.meta.id, true)).rejects.toThrow('immutable');
    expect((await brain.read(session.meta.id))?.meta.usage).toBeUndefined();
    await brain.rebuildIndex();
    const sessionFile = session.path.split('/').at(-1)!.replace(/\.md$/, '');
    expect(await readFile(join(root, 'brain/0-index/INDEX.md'), 'utf8')).toContain(`[[${sessionFile}|Pairing]]`);
    const base = await readFile(join(root, 'brain/0-index/Sessions.base'), 'utf8');
    expect(base).toContain('file.inFolder("brain/2-episodic")');
    expect(base).toContain('file.hasTag("session")');
    expect(base).toContain('note.title');
    expect(parse(base).filters.and).toEqual(['file.inFolder("brain/2-episodic")', 'file.hasTag("session")']);
  });
  it('requires canonical proposals to be explicitly accepted and preserves the prior accepted note', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const first = await brain.proposeCanonical({ title: 'Preferred language', body: 'English', tier: 'canonical', kind: 'preference' });
    expect(first.meta.status).toBe('proposed');
    await expect(brain.write({ title: 'Bypass', body: 'No', tier: 'canonical', kind: 'preference', status: 'accepted' })).rejects.toThrow('proposed');
    await brain.acceptCanonical(first.meta.id);
    await brain.recall('English');
    expect((await brain.read(first.meta.id))?.meta.usage?.uses).toBe(1);
    expect((await brain.feedback(first.meta.id, true)).meta.usage?.wins).toBe(1);
    await expect(brain.update(first.meta.id, {}, 'silently changed')).rejects.toThrow('immutable');
    await expect(brain.update(first.meta.id, { status: undefined }, 'silently changed')).rejects.toThrow();
    expect((await brain.read(first.meta.id))?.meta.status).toBe('accepted');
    expect((await brain.read(first.meta.id))?.body).toBe('English');
    await expect(brain.update(first.meta.id, { status: 'superseded' })).rejects.toThrow('acceptCanonical');
    const second = await brain.proposeCanonical({ title: 'Preferred language v2', body: 'Spanish', tier: 'canonical', kind: 'preference', supersedes: first.meta.id });
    await brain.acceptCanonical(second.meta.id);
    expect((await brain.read(first.meta.id))?.meta.status).toBe('superseded');
  });
  it('reverts decisions only by creating a superseding D-note', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const original = await brain.write({ title: 'Use a stable schema', body: 'Keep contracts stable.', tier: 'transitive', kind: 'decision' });
    await expect(brain.update(original.meta.id, { kind: 'lesson' })).rejects.toThrow();
    await expect(brain.update(original.meta.id, { created: undefined })).rejects.toThrow('Cannot clear');
    await expect(brain.update(original.meta.id, { tier: 'canonical' })).rejects.toThrow('identity field');
    expect((await brain.read(original.meta.id))?.meta.kind).toBe('decision');
    await expect(brain.update(original.meta.id, {}, 'rewritten')).rejects.toThrow('immutable');
    await expect(brain.update(original.meta.id, { status: 'reverted', supersedes: 'D-other' })).rejects.toThrow('create a new D-');
    const replacement = await brain.write({ title: 'Use a versioned schema', body: 'Version contracts.', tier: 'transitive', kind: 'decision', supersedes: original.meta.id });
    expect((await brain.read(original.meta.id))?.meta.status).toBe('reverted');
    expect(replacement.meta.supersedes).toBe(original.meta.id);
  });
  it('maintains a single linked canonical proposal for each proven lesson', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const previous = await brain.proposeCanonical({ title: 'Use repeatable tests', body: 'Existing confirmed standard.', tier: 'canonical', kind: 'standard' });
    await brain.acceptCanonical(previous.meta.id);
    const lesson = await brain.write({ title: 'Use repeatable tests', body: 'Prefer deterministic tests.', tier: 'transitive', kind: 'lesson' });
    await brain.update(lesson.meta.id, { usage: { uses: 3, wins: 3, losses: 0, lastUsed: new Date().toISOString() } });
    const first = await brain.maintain();
    const second = await brain.maintain();
    const proposals = (await brain.list({ tier: 'canonical' })).filter(note => note.meta.links.includes(lesson.meta.id));
    expect(first.promoted).toContain(lesson.meta.id);
    expect(second.promoted).toEqual([]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.meta.kind).toBe('standard');
    expect(proposals[0]?.meta.source).toBe('edu:maintain');
    expect(proposals[0]?.meta.supersedes).toBe(previous.meta.id);
    await brain.acceptCanonical(proposals[0]!.meta.id);
    expect((await brain.read(previous.meta.id))?.meta.status).toBe('superseded');
  });
  it('assigns distinct IDs and timestamp filenames to same-title sessions', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const a = await brain.openSession('Daily sync', 'test');
    const b = await brain.openSession('Daily sync', 'test');
    expect(a.meta.id).not.toBe(b.meta.id);
    expect(a.path).not.toBe(b.path);
    expect(a.path.split('/').at(-1)).toMatch(/^\d{4}-\d{2}-\d{2}_\d{4}_daily-sync/);
  });
  it('uses temp-and-rename writes without leaving temp artifacts', async () => {
    const root = await temp(); const file = join(root, 'nested', 'note.md');
    await atomicWrite(file, 'ok'); expect(await readFile(file, 'utf8')).toBe('ok');
  });
});
