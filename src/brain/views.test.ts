import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { openBrain } from './brain.js';
import { LEGACY_BASE_FILES, baseFileNames, buildBases, buildDashboard, isEduOwned, projectFormula } from './bases.js';
import type { ProjectEntry } from '../vault/registry.js';

const TOP_KEYS = ['filters', 'formulas', 'properties', 'views'];
const VIEW_KEYS = ['type', 'name', 'filters', 'order', 'sort'];

/** A vault with an orchestrator brain at `<vault>/01-CONOCIMIENTO` linked from `<home>/.edu/brain`, like ~/Edu. */
async function orchestratorVault(lang?: 'en' | 'es') {
  const vault = await mkdtemp(join(tmpdir(), 'edu-views-'));
  await mkdir(join(vault, '.obsidian'), { recursive: true });
  await mkdir(join(vault, '01-CONOCIMIENTO'), { recursive: true });
  const eduHome = join(vault, '..', `${basename(vault)}-home`, '.edu');
  await mkdir(eduHome, { recursive: true });
  const { symlink } = await import('node:fs/promises');
  await symlink(join(vault, '01-CONOCIMIENTO'), join(eduHome, 'brain'), process.platform === 'win32' ? 'junction' : 'dir');
  if (lang) await writeFile(join(eduHome, 'config.json'), JSON.stringify({ lang }));
  return { vault, eduHome, index: join(vault, '01-CONOCIMIENTO', '0-index') };
}

async function workspaceIn(vault: string, rel: string, lang: 'en' | 'es') {
  const root = join(vault, ...rel.split('/'));
  await mkdir(join(root, '.edu'), { recursive: true });
  await writeFile(join(root, '.edu', 'config.json'), JSON.stringify({ lang, brainDir: '01-CONOCIMIENTO' }));
  return { root, location: { scope: 'project' as const, root: join(root, '.edu'), brainDir: join(root, '01-CONOCIMIENTO') }, index: join(root, '01-CONOCIMIENTO', '0-index') };
}

const entry = (name: string, root: string): ProjectEntry => ({ name, root, brain: join(root, '01-CONOCIMIENTO'), addedAt: '2026-10-10T00:00:00.000Z' });

describe('Bases generator', () => {
  it('emits valid YAML using only documented Bases keys', () => {
    for (const lang of ['en', 'es'] as const) for (const scope of [{ mode: 'orchestrator', brainRel: '01-CONOCIMIENTO' }, { mode: 'workspace', brainRel: 'a/01-CONOCIMIENTO' }] as const) {
      for (const file of buildBases(lang, scope)) {
        const data = parse(file.content);
        expect(Object.keys(data).every(key => TOP_KEYS.includes(key))).toBe(true);
        expect(data.views.length).toBeGreaterThan(0);
        for (const view of data.views) {
          expect(Object.keys(view).every(key => VIEW_KEYS.includes(key))).toBe(true);
          expect(view.type).toBe('table');
          for (const column of view.order) expect(data.properties[column]?.displayName, `${file.name} ${column}`).toBeTruthy();
          for (const sort of view.sort) expect(['ASC', 'DESC']).toContain(sort.direction);
        }
        for (const formula of Object.values(data.formulas)) expect(typeof formula).toBe('string');
        expect(file.content).not.toMatch(/[&*]a\d/); // no YAML anchors or aliases
      }
    }
  });

  it('localizes file names, views and column headers', () => {
    expect(baseFileNames('es')).toEqual(['Conocimiento.base', 'Decisiones.base', 'Lecciones.base', 'Hipótesis.base', 'Compromisos.base', 'Sesiones.base']);
    expect(baseFileNames('en')).toEqual(['Knowledge.base', 'Decisions.base', 'Lessons.base', 'Hypotheses.base', 'Commitments.base', 'Sessions.base']);
    const es = Object.fromEntries(buildBases('es', { mode: 'orchestrator', brainRel: '01-CONOCIMIENTO' }).map(f => [f.name, parse(f.content)]));
    expect(es['Conocimiento.base'].views.map((v: { name: string }) => v.name)).toEqual(['Todo', 'Por aprobar']);
    expect(es['Conocimiento.base'].views[1].filters).toEqual({ and: ['status == "proposed"'] });
    expect(es['Conocimiento.base'].filters.and).toEqual(['file.path.contains("/1-canonical/")', 'tier == "canonical"']);
    expect(es['Compromisos.base'].views.map((v: { name: string }) => v.name)).toEqual(['Pendientes', 'Atrasados', 'Todos']);
    expect(es['Compromisos.base'].views[1].filters).toEqual({ and: ['status == "overdue"'] });
    expect(es['Compromisos.base'].views[0].sort).toEqual([{ property: 'note.due', direction: 'ASC' }]);
    expect(es['Compromisos.base'].properties['formula.vence']).toEqual({ displayName: 'Vence' });
    expect(es['Compromisos.base'].properties['formula.proyecto']).toEqual({ displayName: 'Proyecto' });
    expect(es['Lecciones.base'].formulas).toMatchObject({ wins: 'usage.wins', losses: 'usage.losses' });
    expect(es['Lecciones.base'].filters.and).toEqual(['file.path.contains("/3-transitive/")', 'kind == "lesson"']);
    const en = Object.fromEntries(buildBases('en', { mode: 'workspace', brainRel: 'w/01-CONOCIMIENTO' }).map(f => [f.name, parse(f.content)]));
    expect(en['Knowledge.base'].views.map((v: { name: string }) => v.name)).toEqual(['All', 'To approve']);
    expect(en['Commitments.base'].properties['note.owner']).toEqual({ displayName: 'Owner' });
    expect(en['Sessions.base'].filters.and).toEqual(['file.inFolder("w/01-CONOCIMIENTO/2-episodic")', 'kind == "session"']);
  });

  it('derives the project column from the path segment before the brain folder', () => {
    expect(projectFormula('01-CONOCIMIENTO', '3-transitive')).toBe('if(file.path.startsWith("01-CONOCIMIENTO/"), "global", file.path.split("/3-transitive/")[0].split("/").reverse()[1])');
    // Same semantics in JS: what Obsidian evaluates for representative paths.
    const project = (path: string) => path.startsWith('01-CONOCIMIENTO/') ? 'global' : path.split('/3-transitive/')[0]!.split('/').reverse()[1];
    expect(project('01-CONOCIMIENTO/3-transitive/L-x.md')).toBe('global');
    expect(project('04-PROYECTOS/marca-personal/01-CONOCIMIENTO/3-transitive/L-x.md')).toBe('marca-personal');
    expect(project('03-LAB/edu/01-CONOCIMIENTO/3-transitive/C-y.md')).toBe('edu');
  });
});

describe('rebuildIndex Obsidian views', () => {
  it('gives the orchestrator brain vault-wide localized Bases, cleans stale sets and keeps user files', async () => {
    const { vault, eduHome, index } = await orchestratorVault('es');
    await mkdir(index, { recursive: true });
    for (const name of [...LEGACY_BASE_FILES, 'Knowledge.base', 'Mine.base', 'notes.md']) await writeFile(join(index, name), 'x');
    const brain = openBrain([{ scope: 'global', root: eduHome }], { projects: async () => [] });
    await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Small PRs', body: 'x' });
    await brain.rebuildIndex();
    const files = (await readdir(index)).sort();
    expect(files).toEqual([...baseFileNames('es'), 'INDEX.md', 'Mine.base', 'notes.md'].sort());
    const lessons = parse(await readFile(join(index, 'Lecciones.base'), 'utf8'));
    expect(lessons.filters.and).toEqual(['file.path.contains("/3-transitive/")', 'kind == "lesson"']);
    expect(lessons.formulas.proyecto).toContain('startsWith("01-CONOCIMIENTO/")');
    expect(existsSync(join(vault, '00-INICIO', 'Panel.md'))).toBe(true);
  });

  it('keeps a workspace brain scoped to its own folder, without a dashboard', async () => {
    const { vault } = await orchestratorVault('es');
    const ws = await workspaceIn(vault, '04-PROYECTOS/marca-personal', 'es');
    const brain = openBrain([ws.location], { projects: async () => { throw new Error('registry must not be read for a workspace'); } });
    await brain.write({ tier: 'transitive', kind: 'commitment', title: 'Ship', body: 'x', due: '2026-10-20' });
    await brain.rebuildIndex();
    const commitments = parse(await readFile(join(ws.index, 'Compromisos.base'), 'utf8'));
    expect(commitments.filters.and).toEqual(['file.inFolder("04-PROYECTOS/marca-personal/01-CONOCIMIENTO/3-transitive")', 'kind == "commitment"']);
    expect(commitments.formulas.proyecto).toBeUndefined();
    expect(existsSync(join(vault, '00-INICIO', 'Panel.md'))).toBe(false);
  });

  it('switches the whole set when the workspace language changes', async () => {
    const { eduHome, index } = await orchestratorVault('es');
    const brain = openBrain([{ scope: 'global', root: eduHome }], { projects: async () => [] });
    await brain.rebuildIndex();
    await writeFile(join(eduHome, 'config.json'), JSON.stringify({ lang: 'en' }));
    await brain.rebuildIndex();
    expect((await readdir(index)).filter(name => name.endsWith('.base')).sort()).toEqual([...baseFileNames('en')].sort());
  });
});

describe('dashboard note', () => {
  it('embeds the orchestrator Bases by vault path and links registered workspaces', async () => {
    const { vault, eduHome } = await orchestratorVault('es');
    const marca = await workspaceIn(vault, '04-PROYECTOS/marca-personal', 'es');
    await mkdir(join(marca.root, '00-INICIO'), { recursive: true });
    await writeFile(join(marca.root, '00-INICIO', 'marca-personal.md'), '# Marca');
    const lab = await workspaceIn(vault, '03-LAB/edu', 'en');
    const outside = await mkdtemp(join(tmpdir(), 'edu-outside-'));
    const projects = [entry('marca-personal', marca.root), entry('edu', lab.root), entry('elsewhere', outside), entry('gone', join(vault, 'nope'))];
    await openBrain([{ scope: 'global', root: eduHome }], { projects: async () => projects }).rebuildIndex();
    const panel = await readFile(join(vault, '00-INICIO', 'Panel.md'), 'utf8');
    expect(isEduOwned(panel)).toBe(true);
    expect(panel).toContain('# Panel');
    expect(panel).toContain('![[01-CONOCIMIENTO/0-index/Conocimiento.base#Por aprobar]]');
    expect(panel).toContain('![[01-CONOCIMIENTO/0-index/Compromisos.base#Pendientes]]');
    expect(panel).toContain('![[01-CONOCIMIENTO/0-index/Lecciones.base#Todas]]');
    expect(panel).toContain('![[01-CONOCIMIENTO/0-index/Hipótesis.base#Abiertas]]');
    expect(panel).toContain('![[01-CONOCIMIENTO/0-index/Decisiones.base#Activas]]');
    expect(panel).toContain('- [[04-PROYECTOS/marca-personal/00-INICIO/marca-personal|marca-personal]]');
    expect(panel).toContain('- edu — `03-LAB/edu`');
    expect(panel).toContain('- elsewhere — `');
    expect(panel).toContain('(no encontrado)');
  });

  it('never overwrites a user-owned dashboard but refreshes an Edu-owned one', async () => {
    const { vault, eduHome } = await orchestratorVault('es');
    const path = join(vault, '00-INICIO', 'Panel.md');
    await mkdir(join(vault, '00-INICIO'), { recursive: true });
    await writeFile(path, '# Mi panel\n');
    const brain = openBrain([{ scope: 'global', root: eduHome }], { projects: async () => [] });
    await brain.rebuildIndex();
    expect(await readFile(path, 'utf8')).toBe('# Mi panel\n');
    await writeFile(path, '---\ngenerated_by: edu\n---\nold\n');
    await brain.rebuildIndex();
    expect(await readFile(path, 'utf8')).toContain('![[01-CONOCIMIENTO/0-index/Conocimiento.base#Por aprobar]]');
  });

  it('writes the English dashboard and removes the Edu-owned Spanish one on a language switch', async () => {
    const { vault, eduHome } = await orchestratorVault('es');
    const brain = openBrain([{ scope: 'global', root: eduHome }], { projects: async () => [] });
    await brain.rebuildIndex();
    await writeFile(join(eduHome, 'config.json'), JSON.stringify({ lang: 'en' }));
    await brain.rebuildIndex();
    expect(existsSync(join(vault, '00-INICIO'))).toBe(false);
    const dash = await readFile(join(vault, '00-START', 'Dashboard.md'), 'utf8');
    expect(dash).toContain('![[01-CONOCIMIENTO/0-index/Knowledge.base#To approve]]');
    expect(dash).toContain('No workspaces registered yet');
  });

  it('reads the marker only from frontmatter', () => {
    expect(isEduOwned('---\ngenerated_by: edu\n---\n')).toBe(true);
    expect(isEduOwned('generated_by: edu\n')).toBe(false);
    expect(isEduOwned('---\ngenerated_by: me\n---\n')).toBe(false);
    expect(buildDashboard('en', '01-K/0-index', []).startsWith('---\ngenerated_by: edu\n---\n')).toBe(true);
  });
});

describe('localized values', () => {
  it('shows statuses, confidence, kinds and dates in the workspace language', () => {
    const [knowledge] = buildBases('es', { mode: 'workspace', brainRel: '01-CONOCIMIENTO' }).filter(file => file.name === 'Conocimiento.base');
    const base = parse(knowledge!.content) as { formulas: Record<string, string>; properties: Record<string, { displayName: string }>; views: Array<{ order: string[]; sort: Array<{ property: string }> }> };
    expect(base.formulas.estado).toContain('"proposed", "por aprobar"');
    expect(base.formulas.certeza).toContain('"verified", "verificado"');
    expect(base.formulas.actualizado).toContain('date(note.updated).format(');
    expect(base.views[0]!.order).toContain('formula.estado');
    expect(base.views[0]!.order).not.toContain('note.status');
    expect(base.properties['formula.estado']!.displayName).toBe('Estado');
    expect(base.views[0]!.sort[0]!.property).toBe('note.updated');
  });
});
