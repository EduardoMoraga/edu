import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { win32 } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openBrain } from '../brain.js';
import { albertPathSegments, importAlbert } from './albert.js';
import { importMoragent } from './moragent.js';

const roots: string[] = [];
async function temp() { const path = await mkdtemp(join(tmpdir(), 'edu-import-')); roots.push(path); return path; }
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('read-only brain importers', () => {
  it('detects Albert vault path segments with Windows separators', () => {
    const root = 'C:\\vault\\_ALBERT';
    expect(albertPathSegments(root, `${root}\\1-CANONICO\\negocio\\note.md`, win32.relative)).toEqual(['1-CANONICO', 'negocio', 'note.md']);
    expect(albertPathSegments(root, `${root}\\2-EPISODICO\\note.md`, win32.relative)).toEqual(['2-EPISODICO', 'note.md']);
  });

  it.skipIf(!process.env.EDU_ALBERT_VAULT)('reports aggregate counts from a live Albert vault without copying its content', async () => {
    const source = process.env.EDU_ALBERT_VAULT!;
    const target = process.env.EDU_HOME!;
    roots.push(target);
    const report = await importAlbert(source, openBrain([{ scope: 'project', root: target }]));
    const counts = (notes: typeof report.imported, field: 'tier' | 'kind' | 'status') => Object.fromEntries(
      [...new Set(notes.map(note => note.meta[field]).filter((value): value is string => Boolean(value)))].sort().map(value => [value, notes.filter(note => note.meta[field] === value).length]),
    );
    console.info(`LIVE_ALBERT_IMPORT_COUNTS ${JSON.stringify({ total: report.imported.length, errors: report.errors.length, tiers: counts(report.imported, 'tier'), kinds: counts(report.imported, 'kind'), statuses: counts(report.imported, 'status') })}`);
    expect(report.imported.length).toBeGreaterThan(0);
  });
  it('imports Albert subfolder transitive notes and Spanish metadata with lifecycle mapping', async () => {
    const source = await temp(), target = await temp();
    const paths = [
      ['3-TRANSITIVO/decisiones/D-001_decision.md', 'tipo: decision\ncapa: transitiva\ntitulo: Decisión\nestado: vigente\nconfianza: alta\nfuente: equipo\n'],
      ['3-TRANSITIVO/compromisos/C-001_commitment.md', 'tipo: compromiso\nestado: vencido\ndueño: Ana\nplazo: 2026-10-07\n'],
      ['3-TRANSITIVO/hipotesis/H-001_hypothesis.md', 'tipo: hipotesis\nestado: confirmada\nconfianza: media\nresumen: Evidencia resumida\n'],
      ['3-TRANSITIVO/aprendizajes/L-001_lesson.md', 'tipo: aprendizaje\nestado: proven\nconfianza: baja\nfuente: revisión\n'],
      ['1-CANONICO/negocio/canonical.md', 'tipo: canonico\ndominio: negocio\ntitulo: Canonical\nestado: aceptada\n'],
    ] as const;
    for (const [relative, frontmatter] of paths) {
      const file = join(source, '_ALBERT', relative);
      await mkdir(join(file, '..'), { recursive: true });
      await writeFile(file, `---\n${frontmatter}---\n\nBody text.\n`);
    }
    const report = await importAlbert(source, openBrain([{ scope: 'project', root: target }]));
    expect(report.errors).toEqual([]);
    expect(report.imported.map(note => [note.meta.tier, note.meta.kind, note.meta.status])).toEqual(expect.arrayContaining([
      ['transitive', 'decision', 'active'], ['transitive', 'commitment', 'overdue'],
      ['transitive', 'hypothesis', 'confirmed'], ['transitive', 'lesson', 'proven'],
      ['canonical', 'domain', 'accepted'],
    ]));
    const decision = report.imported.find(note => note.meta.kind === 'decision')!;
    const hypothesis = report.imported.find(note => note.meta.kind === 'hypothesis')!;
    const commitment = report.imported.find(note => note.meta.kind === 'commitment')!;
    const lesson = report.imported.find(note => note.meta.kind === 'lesson')!;
    expect(decision.meta.source).toBe('import:albert · equipo');
    expect(decision.meta.band).toBe('verified');
    expect(hypothesis.body).toContain('> Evidencia resumida');
    expect(hypothesis.meta.band).toBe('inferred');
    expect(commitment.meta.owner).toBe('Ana');
    expect(commitment.meta.due).toBe('2026-10-07');
    expect(lesson.meta.status).toBe('proven');
    expect(lesson.meta.band).toBe('hypothesis');
    expect(lesson.meta.source).toBe('import:albert · revisión');
    expect(report.imported.every(note => note.path.startsWith(join(target, 'brain')))).toBe(true);
  });

  it('maps Spanish lifecycle statuses for prefix-only H and C notes', async () => {
    const source = await temp(), target = await temp();
    const hypothesisPath = join(source, '_ALBERT/3-TRANSITIVO/H-101_hypothesis.md');
    const commitmentPath = join(source, '_ALBERT/3-TRANSITIVO/C-101_commitment.md');
    await mkdir(join(source, '_ALBERT/3-TRANSITIVO'), { recursive: true });
    await writeFile(hypothesisPath, '---\nestado: confirmada\n---\n\nHypothesis body.\n');
    await writeFile(commitmentPath, '---\nestado: entregado\n---\n\nCommitment body.\n');
    const report = await importAlbert(source, openBrain([{ scope: 'project', root: target }]));
    expect(report.imported.find(note => note.meta.kind === 'hypothesis')?.meta.status).toBe('confirmed');
    expect(report.imported.find(note => note.meta.kind === 'commitment')?.meta.status).toBe('delivered');
  });
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
