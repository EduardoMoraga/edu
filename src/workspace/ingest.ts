/**
 * Writes an extraction into a workspace brain: notes as canonical (verified → accepted, inferred →
 * proposed for human approval), the glossary as one lexicon note, playbooks under `.edu/playbooks/`.
 * Never overwrites: a title or playbook name already taken gets a suffix.
 */
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Brain } from '../brain/brain.js';
import { atomicWrite, slugify } from '../brain/store.js';
import type { CanonicalKind } from '../core/contracts.js';
import type { Lang } from '../cli/i18n.js';
import type { ExtractedNote, KnowledgeExtraction } from './extract.js';

export interface IngestReport { accepted: number; proposed: number; glossaryTerms: number; playbooks: string[]; skipped: number }

const CANONICAL_KIND: Record<ExtractedNote['kind'], CanonicalKind> = {
  overview: 'identity', standard: 'standard', decision: 'standard', process: 'standard',
  glossary: 'lexicon', fact: 'domain', person: 'person', client: 'domain',
};

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

/** A title whose `K-` id is free in the brain; suffixes the source label, then a counter. */
function freeTitle(title: string, taken: Set<string>, label: string): string {
  const candidates = [title, `${title} (${label})`];
  for (let n = 2; n < 100; n++) candidates.push(`${title} (${label} ${n})`);
  const free = candidates.find(candidate => !taken.has(`K-${slugify(candidate)}`)) ?? `${title} ${Date.now()}`;
  taken.add(`K-${slugify(free)}`);
  return free;
}

const sourceLabel = (source: string) => source.split('#')[0]!.split('; ')[0]!.replace(/\.[^.]+$/, '') || 'doc';

export async function ingestExtraction(brain: Brain, eduRoot: string, extraction: KnowledgeExtraction, opts: { lang: Lang; origin: string }): Promise<IngestReport> {
  const report: IngestReport = { accepted: 0, proposed: 0, glossaryTerms: 0, playbooks: [], skipped: 0 };
  const taken = new Set((await brain.list({ tier: 'canonical' })).map(note => note.meta.id));
  const write = async (note: ExtractedNote) => {
    const title = freeTitle(note.title, taken, sourceLabel(note.source || opts.origin));
    const created = await brain.proposeCanonical({
      tier: 'canonical', kind: CANONICAL_KIND[note.kind], title, body: note.body, band: note.band,
      source: note.source || opts.origin, tags: ['workspace', note.kind],
    });
    if (note.band === 'verified') { await brain.acceptCanonical(created.meta.id); report.accepted++; }
    else report.proposed++;
  };
  for (const note of extraction.notes) {
    if (!note.title.trim() || !note.body.trim()) { report.skipped++; continue; }
    await write(note);
  }
  if (extraction.glossary.length) {
    const body = [...extraction.glossary]
      .sort((a, b) => a.term.localeCompare(b.term))
      .map(entry => `- **${entry.term}**: ${entry.meaning}`).join('\n');
    await write({ title: opts.lang === 'es' ? 'Glosario' : 'Glossary', kind: 'glossary', body, band: 'verified', source: opts.origin });
    report.glossaryTerms = extraction.glossary.length;
  }
  for (const playbook of extraction.playbooks) {
    const base = slugify(playbook.name);
    let name = base;
    for (let n = 2; await exists(join(eduRoot, 'playbooks', `${name}.md`)); n++) name = `${base}-${n}`;
    const steps = playbook.steps.map((step, index) => `${index + 1}. ${step.replace(/^\s*\d+[.)]\s*/, '')}`).join('\n');
    const description = playbook.title.replace(/\s+/g, ' ').trim();
    await atomicWrite(join(eduRoot, 'playbooks', `${name}.md`), [
      '---', `name: ${name}`, `description: ${JSON.stringify(description)}`, 'requireSpecApproval: true', '---', '',
      `# ${playbook.title}`, '', `${opts.lang === 'es' ? 'Fuente' : 'Source'}: ${opts.origin}`, '', steps, '',
    ].join('\n'));
    report.playbooks.push(name);
  }
  await brain.rebuildIndex();
  return report;
}
