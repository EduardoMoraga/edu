/**
 * Fidelity of the Albert importer on a synthetic vault (no real client content).
 * Covers: invalid frontmatter, correlative ids, relations, field mapping and re-import idempotency.
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openBrain } from '../brain.js';
import { importAlbert } from './albert.js';

const roots: string[] = [];
async function temp() { const path = await mkdtemp(join(tmpdir(), 'edu-albert-')); roots.push(path); return path; }
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function vault(files: Record<string, string>): Promise<string> {
  const root = await temp();
  for (const [relative, content] of Object.entries(files)) {
    const file = join(root, '_ALBERT', relative);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  return root;
}
const note = (frontmatter: string, body = 'Body text.') => `---\n${frontmatter.trim()}\n---\n\n${body}\n`;

describe('Albert import: invalid frontmatter', () => {
  it('keeps the full raw text as the body, marks the note and reports a warning', async () => {
    const raw = '---\ntipo: aprendizaje\ntitulo: Roto: con dos puntos: extra\nresumen: Algo\n---\n\nCuerpo que no se puede perder.\n';
    const source = await vault({ '3-TRANSITIVO/aprendizajes/L-009_roto.md': raw });
    const report = await importAlbert(source, openBrain([{ scope: 'project', root: await temp() }]));
    expect(report.errors).toEqual([]);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toMatch(/L-009_roto\.md.*invalid-frontmatter/);
    const imported = report.imported[0]!;
    expect(imported.meta.import_warning).toBe('invalid-frontmatter');
    expect(imported.body).toContain('Cuerpo que no se puede perder.');
    expect(imported.body).toContain('titulo: Roto: con dos puntos: extra');
  });

  it('never writes an empty body when the source had content', async () => {
    const source = await vault({ '3-TRANSITIVO/aprendizajes/L-010_solo.md': '---\ntipo: aprendizaje\ntitulo: Solo frontmatter\n---\n' });
    const report = await importAlbert(source, openBrain([{ scope: 'project', root: await temp() }]));
    expect(report.imported[0]!.body.trim()).not.toBe('');
  });
});

describe('Albert import: correlative ids and relations', () => {
  const files = {
    '3-TRANSITIVO/decisiones/D-014_usar-colas.md': note('tipo: decision\ntitulo: Usar colas\nestado: revertida\nrevierte: ninguna\nrevertida_por: D-016\nconfianza: media'),
    '3-TRANSITIVO/decisiones/D-016_usar-eventos.md': note('tipo: decision\ntitulo: Usar eventos\nestado: vigente\nrevierte: D-014\nconfianza: alta', 'Reemplaza [[D-014]] y ver [[L-025_medir-antes|la lección]].'),
    '3-TRANSITIVO/aprendizajes/L-025_medir-antes.md': note('tipo: aprendizaje\ntitulo: Medir antes de optimizar\nestado: vigente'),
    '3-TRANSITIVO/compromisos/C-017_entregar.md': note('tipo: compromiso\ntitulo: Entregar tablero\nestado: cerrado\nplazo: 2026-01-10'),
    '3-TRANSITIVO/A-003_recordatorio.md': note('titulo: Recordatorio'),
    '2-EPISODICO/2026-01-05_sesion-uno.md': note('tipo: episodico\ntitulo: Sesión uno\nfecha: 2026-01-05\nestado: cerrada\nprodujo: [D-016, L-025, D-999]\ncerro: [C-017]', 'Se decidió [[D-016]].'),
  };

  it('embeds the correlative in the Edu id and keeps it as legacy_id and alias', async () => {
    const report = await importAlbert(await vault(files), openBrain([{ scope: 'project', root: await temp() }]));
    expect(report.errors).toEqual([]);
    const byLegacy = new Map(report.imported.map(n => [n.meta.legacy_id, n]));
    const decision = byLegacy.get('D-016')!;
    expect(decision.meta.id).toBe('D-016-usar-eventos');
    expect(decision.path.endsWith('D-016-usar-eventos.md')).toBe(true);
    expect(decision.meta.aliases).toEqual(['D-016', 'D-016_usar-eventos']);
    expect(byLegacy.get('L-025')!.meta.id).toBe('L-025-medir-antes-de-optimizar');
    // A- items become lessons: the Edu prefix differs, so the id is not embedded but the alias is kept.
    const reminder = byLegacy.get('A-003')!;
    expect(reminder.meta.id).toBe('L-recordatorio');
    expect(reminder.meta.aliases).toContain('A-003');
  });

  it('translates revierte/revertida_por, produjo/cerro and body wikilinks to Edu ids', async () => {
    const report = await importAlbert(await vault(files), openBrain([{ scope: 'project', root: await temp() }]));
    const byLegacy = new Map(report.imported.map(n => [n.meta.legacy_id, n]));
    const old = byLegacy.get('D-014')!, current = byLegacy.get('D-016')!;
    expect(old.meta.status).toBe('reverted');
    expect(old.meta.superseded_by).toBe(current.meta.id);
    expect(current.meta.status).toBe('active');
    expect(current.meta.supersedes).toBe(old.meta.id);
    expect(current.meta.links).toEqual(expect.arrayContaining([old.meta.id, 'L-025-medir-antes-de-optimizar']));
    expect(current.body).toContain(`[[${old.meta.id}|D-014]]`);
    expect(current.body).toContain('[[L-025-medir-antes-de-optimizar|la lección]]');
    const session = report.imported.find(n => n.meta.kind === 'session')!;
    expect(session.meta.links).toEqual(expect.arrayContaining([current.meta.id, 'L-025-medir-antes-de-optimizar', byLegacy.get('C-017')!.meta.id]));
    expect(session.body).toContain(`[[${current.meta.id}|D-016]]`);
    // A reference to a note that is not in the vault is not dropped: it stays in the albert map.
    expect(session.meta.albert?.produjo).toEqual(['D-016', 'L-025', 'D-999']);
  });

  it('re-importing the same vault writes nothing new', async () => {
    const source = await vault(files);
    const brain = openBrain([{ scope: 'project', root: await temp() }]);
    const first = await importAlbert(source, brain);
    const total = (await brain.list()).length;
    const second = await importAlbert(source, brain);
    expect(first.imported).toHaveLength(Object.keys(files).length);
    expect(second.imported).toEqual([]);
    expect(second.errors).toEqual([]);
    expect(second.skipped).toHaveLength(Object.keys(files).length);
    expect((await brain.list()).length).toBe(total);
  });

  it('backfills legacy ids on notes imported before ids were preserved, without duplicating them', async () => {
    const source = await vault({ '3-TRANSITIVO/aprendizajes/L-025_medir-antes.md': files['3-TRANSITIVO/aprendizajes/L-025_medir-antes.md'] });
    const brain = openBrain([{ scope: 'project', root: await temp() }]);
    const legacy = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Medir antes de optimizar', body: 'Old import.', source: 'import:albert', status: 'proven' });
    const report = await importAlbert(source, brain);
    expect(report.imported).toEqual([]);
    expect(report.skipped).toHaveLength(1);
    const after = await brain.read(legacy.meta.id);
    expect(after?.meta.legacy_id).toBe('L-025');
    expect(after?.meta.aliases).toContain('L-025');
    expect((await brain.list()).length).toBe(1);
  });
});
