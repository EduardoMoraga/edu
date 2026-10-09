import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseMarkdown } from '../frontmatter.js';
import type { CanonicalKind, NoteMeta, TransitiveKind } from '../../core/contracts.js';
import type { NewNote, Brain } from '../brain.js';
import type { ImportReport } from './types.js';

export async function markdownFiles(path: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(path, { withFileTypes: true }); } catch { return []; }
  const files: string[] = [];
  for (const entry of entries) {
    const target = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(target));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(target);
  }
  return files.sort();
}

export function mapStatus(status: unknown): string | undefined {
  const map: Record<string, string> = { confirmada: 'confirmed', refutada: 'refuted', sin_evidencia: 'no-evidence', vencido: 'overdue', entregado: 'delivered', pendiente: 'pending', abierta: 'open' };
  return typeof status === 'string' ? map[status.toLowerCase()] ?? status : undefined;
}

export async function importFiles(files: string[], brain: Brain, source: ImportReport['source'], classify: (path: string) => Partial<NewNote>): Promise<ImportReport> {
  const report: ImportReport = { source, imported: [], skipped: [], errors: [] };
  for (const path of files) {
    try {
      const raw = await readFile(path, 'utf8');
      const parsed = parseMarkdown<NoteMeta>(raw);
      const title = String(parsed.meta.title ?? basename(path, '.md').replace(/^[DHCAL]-/, '').replace(/[-_]/g, ' '));
      const mapping = classify(path);
      const input: NewNote = { title, body: parsed.body || raw, tier: mapping.tier ?? 'transitive', kind: mapping.kind ?? 'lesson', tags: Array.isArray(parsed.meta.tags) ? parsed.meta.tags : [], links: Array.isArray(parsed.meta.links) ? parsed.meta.links : [], status: (mapStatus(parsed.meta.status) ?? mapping.status) as NoteMeta['status'], band: parsed.meta.band, owner: parsed.meta.owner, due: parsed.meta.due, supersedes: parsed.meta.supersedes, source };
      if (!input.status) delete input.status;
      if (!input.owner) delete input.owner;
      if (!input.due) delete input.due;
      const note = await brain.write(input); report.imported.push(note);
    } catch (error) { report.errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return report;
}

export function asTransitiveKind(prefix: string): TransitiveKind {
  return ({ D: 'decision', H: 'hypothesis', C: 'commitment', A: 'lesson', L: 'lesson' } as Record<string, TransitiveKind>)[prefix] ?? 'lesson';
}

export function canonicalKind(value: string | undefined): CanonicalKind {
  const allowed: CanonicalKind[] = ['identity', 'standard', 'lexicon', 'domain', 'person', 'preference'];
  return allowed.includes(value as CanonicalKind) ? value as CanonicalKind : 'domain';
}
