import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BrainLocation } from '../core/contracts.js';
import { openBrain } from './brain.js';
import { parseLog } from './catalog.js';
import { readLedger, resetLedgerCache } from './ledger.js';
import { brainPath } from './location.js';
import { resetNoteCache } from './store.js';

const dirs: string[] = [];
afterEach(async () => { resetNoteCache(); resetLedgerCache(); await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const gone = (path: string) => access(path).then(() => false, () => true);

async function setup() {
  const base = await mkdtemp(join(tmpdir(), 'edu-move-')); dirs.push(base);
  const project: BrainLocation = { scope: 'project', root: join(base, 'project', '.edu') };
  const global: BrainLocation = { scope: 'global', root: join(base, 'home', '.edu') };
  const brain = openBrain([project, global]);
  await brain.init(project); await openBrain([global]).init(global);
  return { project, global, brain };
}

describe('brain.move', () => {
  it('moves a note to the global brain with the same id and file content, exposure, log and catalogs', async () => {
    const { project, global, brain } = await setup();
    const note = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Pin the Node runtime', body: 'Pin Node 22 in CI.', tags: ['ci'], by: { agent: 'codex' } });
    await brain.feedback(note.meta.id, true);
    await brain.recordUse([note.meta.id], new Date('2026-11-01T10:00:00Z'));
    const raw = await readFile(note.path, 'utf8');

    const moved = await brain.move(note.meta.id, global.root);
    expect(moved.meta.id).toBe(note.meta.id);
    expect(moved.path.startsWith(brainPath(global))).toBe(true);
    expect(await readFile(moved.path, 'utf8')).toBe(raw);
    expect(await gone(note.path)).toBe(true);
    expect(moved.meta).toMatchObject({ agent: 'codex', usage: { wins: 1, lastUsed: '2026-11-01T10:00:00.000Z' } });
    expect((await readLedger(global.root)).notes[note.meta.id]).toBeTruthy();
    expect((await readLedger(project.root)).notes[note.meta.id]).toBeUndefined();
    // Still visible from the project (global is in its overlay) and from the global brain alone.
    expect((await brain.read(note.meta.id))?.path).toBe(moved.path);
    expect((await openBrain([global]).read(note.meta.id))?.meta.title).toBe('Pin the Node runtime');

    for (const loc of [project, global]) {
      const log = parseLog(await readFile(join(brainPath(loc), '0-index', 'log.md'), 'utf8'));
      expect(log.at(-1)).toMatchObject({ op: 'move:global', id: note.meta.id });
    }
    expect(await readFile(join(brainPath(global), '0-index', 'catalog.md'), 'utf8')).toContain(note.meta.id);
  });

  it('refuses when the target already has the id, for open sessions, and when the note is already there', async () => {
    const { project, global, brain } = await setup();
    const globalBrain = openBrain([global]);
    await globalBrain.write({ tier: 'transitive', kind: 'decision', title: 'Use queues', body: 'Global version.' });
    const local = await brain.write({ tier: 'transitive', kind: 'decision', title: 'Another one', body: 'Project version.' });
    // Same id in both: the project copy shadows the global one.
    const { atomicWrite } = await import('./store.js');
    const shadowPath = join(brainPath(project), '3-transitive', 'D-use-queues.md');
    await atomicWrite(shadowPath, (await readFile((await globalBrain.read('D-use-queues'))!.path, 'utf8')).replace('Global version.', 'Project version.'));
    await expect(brain.move('D-use-queues', global.root)).rejects.toThrow(/already exists in the global brain/);
    expect(await readFile(shadowPath, 'utf8')).toContain('Project version.');

    const session = await brain.openSession('Live work', 'claude');
    await expect(brain.move(session.meta.id, global.root)).rejects.toThrow(/open session/);
    await expect(brain.move(local.meta.id, project.root)).rejects.toThrow(/already in the project brain/);
    await expect(brain.move('missing', global.root)).rejects.toThrow(/Note not found/);
    await expect(brain.move(local.meta.id, '/elsewhere')).rejects.toThrow(/Not a location/);
  });

  it('moves a global note into the project brain', async () => {
    const { project, global, brain } = await setup();
    const shared = await openBrain([global]).write({ tier: 'transitive', kind: 'lesson', title: 'Only for this project', body: 'Local detail.' });
    const moved = await brain.move(shared.meta.id, project.root);
    expect(moved.path.startsWith(brainPath(project))).toBe(true);
    expect(await openBrain([global]).read(shared.meta.id)).toBeUndefined();
  });
});
