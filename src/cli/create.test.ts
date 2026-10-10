import { access, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EduEvent } from '../core/contracts.js';
import { FakeEngine } from '../engine/fake.js';
import { sampleDocx } from '../workspace/testing.js';
import { deckSnapshot } from './commands/deck.js';
import { captureContext, err, out, runCli } from './testkit.js';

const present = (path: string) => access(path).then(() => true, () => false);
const at = '2026-10-10T00:00:00.000Z';
const answer = (text: string): EduEvent[] => [{ type: 'agent.end', agentId: 'x', ok: true, summary: text, at }];

async function docs(dir: string) {
  await mkdir(dir, { recursive: true });
  const md = join(dir, 'operacion.md');
  await writeFile(md, '# Operación Norte\n\nTrade marketing para retail en Chile.\n\n## Clientes\nLider y Jumbo.\n\n## Proceso de visita\n1. Revisar quiebres\n2. Reportar\n');
  const docx = join(dir, 'kpis.docx');
  await writeFile(docx, sampleDocx());
  return { md, docx };
}

const notesIn = async (dir: string): Promise<string[]> => {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory()) found.push(...await notesIn(join(dir, entry.name)));
    else if (entry.name.endsWith('.md')) found.push(join(dir, entry.name));
  }
  return found;
};

describe('edu create', () => {
  it('builds a localized, self-contained workspace from documents without an LLM', async () => {
    const c = await captureContext({ detected: ['claude'] });
    const { md, docx } = await docs(join(c.dirs.cwd, 'in'));
    const original = await readFile(docx);
    await runCli(c, ['create', md, docx, '--name', 'Albert', '--dir', join(c.dirs.cwd, 'out'), '--no-llm']);
    expect(err(c)).toBe('');
    expect(c.exitCode).toBeUndefined();
    const root = join(c.dirs.cwd, 'out', 'albert');
    expect((await readdir(root)).sort()).toEqual(['.edu', '.obsidian', '00-INICIO', '01-CONOCIMIENTO', '02-ENTREGABLES', '03-LAB', '04-PROYECTOS', '05-ARCHIVO', 'AGENTS.md', 'CLAUDE.md']);
    expect(await present(join(root, '.edu', 'brain'))).toBe(false);
    const config = JSON.parse(await readFile(join(root, '.edu', 'config.json'), 'utf8'));
    expect(config).toMatchObject({ lang: 'es', brainDir: '01-CONOCIMIENTO', sourcesDir: '01-CONOCIMIENTO/fuentes', identity: { name: 'Albert', summary: 'Trade marketing para retail en Chile.' } });
    expect((await readdir(join(root, '01-CONOCIMIENTO', 'fuentes'))).sort()).toEqual(['kpis.docx', 'operacion.md']);
    expect(await readFile(docx)).toEqual(original);

    const notes = await notesIn(join(root, '01-CONOCIMIENTO', '1-canonical'));
    const texts = await Promise.all(notes.map(path => readFile(path, 'utf8')));
    // Same-titled sections from both documents merge into one note (Operación Norte, Clientes).
    expect(texts.length).toBe(4);
    expect(texts.every(text => /status: accepted/.test(text) && /band: verified/.test(text))).toBe(true);
    expect(texts.some(text => text.includes('source: operacion.md#Clientes'))).toBe(true);
    expect(texts.some(text => text.includes('source: kpis.docx#KPIs') && text.includes('| Quiebre | < 3% |'))).toBe(true);
    expect(await readFile(join(root, '01-CONOCIMIENTO', '0-index', 'INDEX.md'), 'utf8')).toContain('Clientes');

    const readme = await readFile(join(root, '00-INICIO', 'README.md'), 'utf8');
    expect(readme).toContain('# Albert');
    expect(readme).toContain('edu create --add');
    expect(readme).toContain('claude      # o: codex · pi · opencode');
    const app = JSON.parse(await readFile(join(root, '.obsidian', 'app.json'), 'utf8'));
    expect(app.userIgnoreFilters).toContain('.edu/');
    expect(JSON.parse(await readFile(join(root, '.obsidian', 'workspace.json'), 'utf8')).lastOpenFiles).toEqual(['00-INICIO/README.md']);
    expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toContain('Eres **Albert**, el agente de este espacio de trabajo');
    expect(await readFile(join(root, '.edu', 'EDU.md'), 'utf8')).toMatch(/^# Albert — the contract/);

    const registry = JSON.parse(await readFile(join(c.dirs.eduHome, 'projects.json'), 'utf8'));
    expect(registry.projects).toEqual([expect.objectContaining({ name: 'albert', root: await realpath(root), brain: join(await realpath(root), '01-CONOCIMIENTO') })]);
    expect(out(c)).toContain('Notas: 4 aceptadas · 0 propuestas');
    expect(out(c)).toContain('Extracción: por títulos (--no-llm)');

    const deck = await deckSnapshot(root);
    expect(deck).toMatchObject({ identity: 'Albert', brain: { present: true, canonical: 4 } });

    const hook = await captureContext();
    hook.ctx.env = { ...c.ctx.env };
    await runCli(hook, ['--cwd', root, 'hook', 'session-start']);
    expect(out(hook)).toContain("You are **Albert**, this workspace's agent, powered by Edu.");
  });

  it('refuses a non-empty target unless --yes, and uses English names with --lang en', async () => {
    const c = await captureContext();
    const { md } = await docs(join(c.dirs.cwd, 'in'));
    const parent = join(c.dirs.cwd, 'out');
    await mkdir(join(parent, 'ada'), { recursive: true });
    await writeFile(join(parent, 'ada', 'keep.txt'), 'mine');
    await runCli(c, ['create', md, '--name', 'Ada', '--dir', parent, '--no-llm', '--lang', 'en']);
    expect(c.exitCode).toBe(1);
    expect(err(c)).toMatch(/is not empty; pass --yes/);
    c.exitCode = undefined;
    await runCli(c, ['create', md, '--name', 'Ada', '--dir', parent, '--no-llm', '--lang', 'en', '--yes']);
    expect(c.exitCode).toBeUndefined();
    expect((await readdir(join(parent, 'ada'))).sort()).toEqual(['.edu', '.obsidian', '00-START', '01-KNOWLEDGE', '02-DELIVERABLES', '03-LAB', '04-PROJECTS', '05-ARCHIVE', 'AGENTS.md', 'CLAUDE.md', 'keep.txt']);
    expect(await readFile(join(parent, 'ada', 'keep.txt'), 'utf8')).toBe('mine');
    expect(await present(join(parent, 'ada', '01-KNOWLEDGE', 'sources', 'operacion.md'))).toBe(true);
  });

  it('extracts with the installed CLI: verified notes accepted, inferred proposed, playbooks and glossary', async () => {
    const extraction = {
      identity: { name: 'ignored', role: 'Analista de trade marketing', tone: 'directo', summary: 'Opera trade en retail.' },
      notes: [
        { title: 'Clientes', kind: 'client', body: 'Lider y Jumbo.', band: 'verified', source: 'operacion.md#Clientes' },
        { title: 'Riesgo de quiebre', kind: 'fact', body: 'Probable alza en verano.', band: 'inferred', source: 'operacion.md' },
      ],
      playbooks: [{ name: 'Visita Sala', title: 'Visita a sala', steps: ['Revisar quiebres', '2. Reportar'] }],
      glossary: [{ term: 'OSA', meaning: 'on-shelf availability' }],
    };
    const c = await captureContext({ detected: ['codex', 'claude'] });
    c.ctx.engineFactory = () => new FakeEngine(answer(`\`\`\`json\n${JSON.stringify(extraction)}\n\`\`\``));
    const { md } = await docs(join(c.dirs.cwd, 'in'));
    await runCli(c, ['create', md, '--name', 'Albert', '--dir', join(c.dirs.cwd, 'out')]);
    expect(err(c)).toBe('');
    const root = join(c.dirs.cwd, 'out', 'albert');
    expect(out(c)).toContain('Extrayendo conocimiento con claude');
    expect(out(c)).toContain('Notas: 2 aceptadas · 1 propuestas para aprobar · 1 términos de glosario · 1 playbooks');
    const config = JSON.parse(await readFile(join(root, '.edu', 'config.json'), 'utf8'));
    expect(config.identity).toEqual({ name: 'Albert', role: 'Analista de trade marketing', tone: 'directo', summary: 'Opera trade en retail.' });
    expect(config.defaultCli).toBe('claude');
    const playbook = await readFile(join(root, '.edu', 'playbooks', 'visita-sala.md'), 'utf8');
    expect(playbook).toContain('name: visita-sala');
    expect(playbook).toContain('1. Revisar quiebres\n2. Reportar');
    const { loadPlaybook } = await import('../orchestrator/playbook.js');
    expect((await loadPlaybook('visita-sala', join(root, '.edu'))).description).toBe('Visita a sala');
    const notes = await Promise.all((await notesIn(join(root, '01-CONOCIMIENTO', '1-canonical'))).map(path => readFile(path, 'utf8')));
    expect(notes.find(text => text.includes('Riesgo de quiebre'))).toMatch(/status: proposed[\s\S]*band: inferred|band: inferred[\s\S]*status: proposed/);
    expect(notes.find(text => text.includes('title: Glosario'))).toContain('- **OSA**: on-shelf availability');
  });

  it('falls back to the heading extraction with a warning when the CLI answer stays invalid', async () => {
    const c = await captureContext({ detected: ['claude'] });
    c.ctx.engineFactory = () => new FakeEngine(answer('I cannot do that.'));
    const { md } = await docs(join(c.dirs.cwd, 'in'));
    await runCli(c, ['create', md, '--name', 'Albert', '--dir', join(c.dirs.cwd, 'out')]);
    expect(c.exitCode).toBeUndefined();
    expect(err(c)).toContain('claude no devolvió un JSON válido');
    expect(out(c)).toContain('Extracción: por títulos (falló claude)');
    expect(out(c)).toContain('Notas: 3 aceptadas');
  });

  it('adds documents to an existing workspace with --add, without clobbering titles', async () => {
    const c = await captureContext();
    const { md } = await docs(join(c.dirs.cwd, 'in'));
    await runCli(c, ['create', md, '--name', 'Albert', '--dir', join(c.dirs.cwd, 'out'), '--no-llm']);
    const root = join(c.dirs.cwd, 'out', 'albert');
    const more = join(c.dirs.cwd, 'in', 'operacion.md');
    await runCli(c, ['--cwd', join(root, '03-LAB'), 'create', '--add', more, '--no-llm']);
    expect(err(c)).toBe('');
    expect(out(c)).toContain('Agregado al cerebro');
    expect((await readdir(join(root, '01-CONOCIMIENTO', 'fuentes'))).sort()).toEqual(['operacion-2.md', 'operacion.md']);
    const titles = (await Promise.all((await notesIn(join(root, '01-CONOCIMIENTO', '1-canonical'))).map(path => readFile(path, 'utf8'))))
      .map(text => /title: (.+)/.exec(text)?.[1]).sort();
    expect(titles).toContain('Clientes');
    expect(titles).toContain('Clientes (operacion)');
    expect(titles).toHaveLength(6);
  });

  it('explains --add outside a workspace and a missing --name', async () => {
    const c = await captureContext();
    const { md } = await docs(join(c.dirs.cwd, 'in'));
    await runCli(c, ['create', '--add', md, '--no-llm']);
    expect(err(c)).toMatch(/No Edu workspace here/);
    await runCli(c, ['create', md, '--no-llm', '--dir', c.dirs.cwd]);
    expect(err(c)).toMatch(/--name is required/);
  });
});
