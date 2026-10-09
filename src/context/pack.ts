import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Brain } from '../brain/index.js';
import { learnedWeight, rankNotes } from '../brain/index.js';
import type { ContextPack, ContextRequest, ContextSection, Note } from '../core/contracts.js';
import { estimateTokens, truncateToTokens } from './tokens.js';

export interface ContextOptions { eduMdPath?: string; now?: Date }

function byNewest(a: Note, b: Note): number {
  return b.meta.created.localeCompare(a.meta.created) || a.meta.id.localeCompare(b.meta.id);
}

async function identityCore(path?: string): Promise<string> {
  if (!path) return '';
  try {
    const source = await readFile(path, 'utf8');
    const beforeMarker = source.split('<!-- edu:extended -->', 1)[0] ?? '';
    return (beforeMarker === source ? source.split('\n').slice(0, 40).join('\n') : beforeMarker).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

/** Construct an ordered context pack without spending tokens on notes that are not included. */
async function assembleContext(brain: Brain, req: ContextRequest, opts: ContextOptions, trackUsage: boolean): Promise<ContextPack> {
  const budget = Number.isFinite(req.budgetTokens) ? Math.max(0, Math.floor(req.budgetTokens)) : 0;
  const now = opts.now ?? new Date();
  const notes = await brain.list();
  const sections: ContextSection[] = [];
  const deferred: string[] = [];
  const included = new Set<string>();
  const fullText = () => sections.map(section => section.text).join('\n\n');
  const add = (title: string, line: string, note?: Note): boolean => {
    const existing = sections.find(section => section.title === title);
    const body = existing ? `${existing.text}\n${line}` : `## ${title}\n${line}`;
    const prospective = sections.map(section => section === existing ? body : section.text);
    if (!existing) prospective.push(body);
    if (estimateTokens(prospective.join('\n\n')) > budget) {
      if (note && !deferred.includes(note.meta.id)) deferred.push(note.meta.id);
      return false;
    }
    if (existing) {
      existing.text = body;
      existing.tokens = estimateTokens(body);
      if (note) existing.noteIds.push(note.meta.id);
    } else sections.push({ title, text: body, tokens: estimateTokens(body), noteIds: note ? [note.meta.id] : [] });
    if (note) included.add(note.meta.id);
    return true;
  };

  const identity = await identityCore(opts.eduMdPath ?? join(process.cwd(), '.edu', 'EDU.md'));
  if (identity) {
    if (!add('Identity core', identity)) {
      const head = '## Identity core\n';
      const clipped = truncateToTokens(identity, budget - estimateTokens(head));
      if (clipped) add('Identity core', clipped);
    }
  }

  const pending = notes.filter(note => note.meta.kind === 'commitment' && (note.meta.status === 'pending' || note.meta.status === 'overdue'))
    .sort((a, b) => (a.meta.due ?? '9999').localeCompare(b.meta.due ?? '9999') || a.meta.id.localeCompare(b.meta.id));
  const hypotheses = notes.filter(note => note.meta.kind === 'hypothesis' && note.meta.status === 'open').sort(byNewest);
  for (const note of [...pending, ...hypotheses]) {
    const detail = note.meta.kind === 'commitment' ? `due ${note.meta.due ?? 'unspecified'}` : `band ${note.meta.band ?? 'hypothesis'}`;
    add('Active commitments & open hypotheses', `- ${note.meta.title} (${detail})`, note);
  }

  const allLessons = notes.filter(note => note.meta.kind === 'lesson' && (note.meta.status === 'proven' || note.meta.status === 'candidate'));
  const relevant = req.query ? rankNotes(req.query, allLessons, now, allLessons.length) : [];
  const relevance = new Map(relevant.map((hit, index) => [hit.note.meta.id, index]));
  const lessons = allLessons.filter(note => note.meta.status === 'candidate' || !req.query || relevance.has(note.meta.id));
  lessons.sort((a, b) => Number(b.meta.status === 'proven') - Number(a.meta.status === 'proven')
    || (relevance.get(a.meta.id) ?? Infinity) - (relevance.get(b.meta.id) ?? Infinity)
    || learnedWeight(b.meta.usage, now) - learnedWeight(a.meta.usage, now)
    || a.meta.id.localeCompare(b.meta.id));
  for (const note of lessons) add('Proven lessons', `- ${note.meta.title} (${note.meta.status}; ${note.meta.band ?? 'inferred'})`, note);

  if (req.query) {
    const canonical = notes.filter(note => note.meta.tier === 'canonical' && note.meta.status === 'accepted');
    for (const hit of rankNotes(req.query, canonical, now, canonical.length)) {
      const snippet = hit.note.body.split(/\n\s*\n/, 1)[0]?.replace(/\s+/g, ' ').trim() ?? '';
      add('Canonical hits', `- ${hit.note.meta.title}: ${truncateToTokens(snippet, 80)}`, hit.note);
    }
  }

  for (const note of notes.filter(note => note.meta.tier === 'episodic' && note.meta.status !== 'open-session').sort(byNewest).slice(0, 3)) {
    const summary = note.body.split(/\n/, 1)[0]?.trim() ?? '';
    add('Last 3 episodes', `- ${note.meta.title}${summary ? `: ${truncateToTokens(summary, 50)}` : ''}`, note);
  }
  const remaining = notes.filter(note => !included.has(note.meta.id)).length;
  add('Index pointer', `${remaining} more notes available via edu_recall/edu_read`);

  if (trackUsage) await brain.recordUse([...included], now);
  const text = fullText();
  return { text, tokens: estimateTokens(text), budgetTokens: budget, sections, deferred };
}

export async function buildContext(brain: Brain, req: ContextRequest, opts: ContextOptions = {}): Promise<ContextPack> {
  return assembleContext(brain, req, opts, true);
}

/** Internal read-only form used for deterministic session-start briefs. */
export async function buildBriefContext(brain: Brain, budgetTokens: number, opts: ContextOptions): Promise<ContextPack> {
  return assembleContext(brain, { budgetTokens }, opts, false);
}
