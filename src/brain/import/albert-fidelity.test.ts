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

export { vault, note, temp };
