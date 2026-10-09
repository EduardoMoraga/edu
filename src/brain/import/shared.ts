import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseMarkdownLenient } from '../frontmatter.js';
import type { CanonicalKind, ClaimBand, NoteMeta, TransitiveKind } from '../../core/contracts.js';
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
  const map: Record<string, string> = { confirmada: 'confirmed', refutada: 'refuted', sin_evidencia: 'no-evidence', vencido: 'overdue', entregado: 'delivered', pendiente: 'pending', abierta: 'open', vigente: 'active', revertida: 'reverted', aceptada: 'accepted', aceptado: 'accepted', borrador: 'open-session' };
  return typeof status === 'string' ? map[status.toLowerCase()] ?? status : undefined;
}

export interface ImportMetadata {
  title?: string; body?: string; source?: string; band?: ClaimBand; created?: string; updated?: string;
  owner?: string; due?: string; tags?: string[]; status?: string; acceptedCanonical?: boolean;
}

export async function importFiles(files: string[], brain: Brain, source: ImportReport['source'], classify: (path: string) => Partial<NewNote>, normalize?: (metadata: Record<string, unknown>, body: string, path: string) => ImportMetadata): Promise<ImportReport> {
  const report: ImportReport = { source, imported: [], skipped: [], errors: [] };
  for (const path of files) {
    try {
      const raw = await readFile(path, 'utf8');
      const parsed = parseMarkdownLenient<NoteMeta>(raw);
      const mapping = classify(path);
      const extra = normalize?.(parsed.meta as unknown as Record<string, unknown>, parsed.body, path) ?? {};
      const title = String(extra.title ?? parsed.meta.title ?? basename(path, '.md').replace(/^[DHCAL]-/, '').replace(/[-_]/g, ' '));
      const noteBody = (extra.body ?? parsed.body) || raw;
      const input: NewNote = { title, body: noteBody, tier: mapping.tier ?? 'transitive', kind: mapping.kind ?? 'lesson', tags: extra.tags ?? (Array.isArray(parsed.meta.tags) ? parsed.meta.tags : []), links: Array.isArray(parsed.meta.links) ? parsed.meta.links : [], status: (extra.acceptedCanonical ? 'proposed' : extra.status ?? mapStatus(parsed.meta.status) ?? mapping.status) as NoteMeta['status'], band: extra.band ?? parsed.meta.band, owner: extra.owner ?? parsed.meta.owner, due: extra.due ?? parsed.meta.due, supersedes: parsed.meta.supersedes, created: extra.created, updated: extra.updated, source: extra.source ?? source };
      if (!input.status) delete input.status;
      if (!input.owner) delete input.owner;
      if (!input.due) delete input.due;
      const note = await brain.write(input);
      report.imported.push(extra.acceptedCanonical && note.meta.tier === 'canonical' ? await brain.acceptCanonical(note.meta.id) : note);
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
