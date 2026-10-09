import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openBrain } from '../brain.js';
import { importAlbert } from './albert.js';
import { importMoragent } from './moragent.js';

const roots: string[] = [];
async function temp() { const path = await mkdtemp(join(tmpdir(), 'edu-import-')); roots.push(path); return path; }
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('read-only brain importers', () => {
  it('maps Albert A-items to lessons and Spanish statuses without changing source', async () => {
    const source = await temp(), target = await temp();
    const file = join(source, '_ALBERT/3-TRANSITIVO/A-recordatorio.md');
    const commitment = join(source, '_ALBERT/3-TRANSITIVO/C-tarea.md');
    await mkdir(join(source, '_ALBERT/3-TRANSITIVO'), { recursive: true });
    await writeFile(file, '---\ntitle: Recordatorio\n---\n\nRemember this.\n');
    await writeFile(commitment, '---\ntitle: Tarea\nstatus: pendiente\n---\n\nDeliver this.\n');
    const report = await importAlbert(source, openBrain([{ scope: 'project', root: target }]));
    expect(report.source).toBe('import:albert');
    expect(report.imported.find(note => note.meta.title === 'Recordatorio')?.meta.kind).toBe('lesson');
    expect(report.imported.find(note => note.meta.title === 'Tarea')?.meta.status).toBe('pending');
    expect(await readFile(commitment, 'utf8')).toContain('pendiente');
  });
  it('imports MORAGENT transient notes as lesson candidates', async () => {
    const source = await temp(), target = await temp();
    const file = join(source, '.moragent/memory/transient/idea.md');
    await mkdir(join(source, '.moragent/memory/transient'), { recursive: true });
    await writeFile(file, '# Idea\n\nTry a small experiment.');
    const before = await readFile(file);
    const report = await importMoragent(source, openBrain([{ scope: 'project', root: target }]));
    expect(report.imported).toHaveLength(1);
    expect(report.imported[0]?.meta.status).toBe('candidate');
    expect(report.imported[0]?.meta.source).toBe('import:moragent');
    expect(await readFile(file)).toEqual(before);
  });
});
