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

describe('Albert import: field fidelity', () => {
  const files = {
    '3-TRANSITIVO/compromisos/C-001_tablero.md': note('tipo: compromiso\ntitulo: Tablero semanal\nestado: vencido\ndueno: Ana\npara: Equipo comercial\nplazo: 2026-02-01\nkpi: 95% de cobertura\nalcance: Tres regiones\nresultado: Pendiente de datos\nconfianza: alta\nfuente: reunión\nresumen: Entregar el tablero\nactualizado: 2026-02-02\ntags: [bi]'),
    '3-TRANSITIVO/compromisos/C-002_cierre.md': note('tipo: compromiso\ntitulo: Cierre mensual\nestado: cerrado\ndueno: Luis\npara: Finanzas\nplazo: 2026-03-01'),
    '3-TRANSITIVO/compromisos/C-003_entregado.md': note('tipo: compromiso\ntitulo: Informe\nestado: entregado'),
    '3-TRANSITIVO/compromisos/C-004_pendiente.md': note('tipo: compromiso\ntitulo: Revisión\nestado: pendiente'),
    '3-TRANSITIVO/hipotesis/H-001_estacional.md': note('tipo: hipotesis\ntitulo: Demanda estacional\nabierta_en: 2026-01-15\nestado: abierta\nconfianza: media\nconfianza_nota: pocos datos\nbanda: 40-60\nevidencia: Ventas Q1\ncierra_con: Datos Q2\nacerto: pendiente'),
    '3-TRANSITIVO/decisiones/D-001_motor.md': note('tipo: decision\ntitulo: Elegir motor\nfecha: 2026-01-02\nestado: vigente\ndecidido_por: Comité\nrevierte: ninguna\ncampo_nuevo: valor raro'),
    '3-TRANSITIVO/aprendizajes/L-001_costo.md': note('tipo: aprendizaje\ntitulo: Validar antes\nestado: vigente\ncosto: dos días'),
  };

  it('maps commitment owner, stakeholder, due date and lifecycle states', async () => {
    const report = await importAlbert(await vault(files), openBrain([{ scope: 'project', root: await temp() }]));
    expect(report.errors).toEqual([]);
    const byLegacy = new Map(report.imported.map(n => [n.meta.legacy_id, n.meta]));
    const c1 = byLegacy.get('C-001')!;
    expect([c1.owner, c1.stakeholder, c1.due, c1.status]).toEqual(['Ana', 'Equipo comercial', '2026-02-01', 'overdue']);
    expect([byLegacy.get('C-002')!.status, byLegacy.get('C-003')!.status, byLegacy.get('C-004')!.status]).toEqual(['delivered', 'delivered', 'pending']);
    expect(byLegacy.get('C-002')!.stakeholder).toBe('Finanzas');
    expect(c1.albert).toMatchObject({ kpi: '95% de cobertura', alcance: 'Tres regiones', resultado: 'Pendiente de datos' });
    const body = report.imported.find(n => n.meta.legacy_id === 'C-001')!.body;
    expect(body).toMatch(/## Origen Albert[\s\S]*kpi[\s\S]*95% de cobertura[\s\S]*alcance[\s\S]*resultado/);
  });

  it('maps hypothesis, decision and lesson fields and keeps unknown keys', async () => {
    const report = await importAlbert(await vault(files), openBrain([{ scope: 'project', root: await temp() }]));
    const byLegacy = new Map(report.imported.map(n => [n.meta.legacy_id, n]));
    const hypothesis = byLegacy.get('H-001')!;
    expect(hypothesis.meta.created.slice(0, 10)).toBe('2026-01-15');
    expect(hypothesis.meta.albert).toMatchObject({ evidencia: 'Ventas Q1', cierra_con: 'Datos Q2', acerto: 'pendiente', confianza_nota: 'pocos datos', banda: '40-60' });
    expect(hypothesis.body).toContain('Ventas Q1');
    const decision = byLegacy.get('D-001')!;
    expect(decision.meta.albert).toMatchObject({ decidido_por: 'Comité', campo_nuevo: 'valor raro' });
    expect(decision.body).toContain('Comité');
    expect(byLegacy.get('L-001')!.meta.albert).toMatchObject({ costo: 'dos días' });
  });

  it('drops no source key: each one is a native field or sits under albert:', async () => {
    const report = await importAlbert(await vault(files), openBrain([{ scope: 'project', root: await temp() }]));
    const native = new Set(['titulo', 'fecha', 'actualizado', 'tags', 'dueno', 'para', 'plazo', 'fuente', 'resumen', 'abierta_en']);
    for (const [relative, content] of Object.entries(files)) {
      const imported = report.imported.find(n => n.meta.origin === `albert:${relative}`)!;
      const keys = [...content.matchAll(/^([a-z_ñ]+):/gm)].map(match => match[1]!);
      for (const key of keys) expect(native.has(key) || imported.meta.albert?.[key] !== undefined, `${relative} ${key}`).toBe(true);
    }
  });
});
