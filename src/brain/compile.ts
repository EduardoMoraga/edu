/**
 * Compile on write: before a transitive or canonical note is persisted, find the notes it relates to and
 * link them, and report likely contradictions so the writer can decide on `supersedes`.
 *
 * Only the new note changes. Related notes are never rewritten to add a backlink (that would turn every
 * write into a multi-file sync change); backlinks are derived from `links` when the catalog is built.
 */
import type { Note } from '../core/contracts.js';
import { isOperationalNote, rankNotes } from './search.js';

export interface PossibleConflict {
  id: string;
  title: string;
  reason: string;
}

export interface CompileReport {
  /** Note ids added to the new note's `links` (callers' own links are kept and not repeated here). */
  linked: string[];
  /** Same-kind live notes that overlap strongly enough to contradict the new one. */
  possibleConflicts: PossibleConflict[];
  /** Secret kinds redacted from the title or body before writing (see `redactSecrets`). */
  redacted: string[];
  /** When the new note has no `supersedes`, the id of the strongest conflict, as a suggestion only. */
  suggestedSupersedes?: string;
}

export interface CompileOptions {
  now?: Date;
  /** Maximum related notes linked. */
  limit?: number;
  /** A related note must score at least this fraction of the new note's own score. */
  minRatio?: number;
  /** A same-kind live note at or above this fraction is reported as a possible conflict. */
  conflictRatio?: number;
}

export interface CompileResult {
  /** The links the new note should be written with: caller links first, then related ids. */
  links: string[];
  linked: string[];
  possibleConflicts: PossibleConflict[];
  suggestedSupersedes?: string;
}

const QUERY_BODY_CHARS = 200;

/** Whether two notes of the same kind may assert competing truths. */
function competing(draft: Note, other: Note): string | undefined {
  const a = draft.meta, b = other.meta;
  if (a.kind !== b.kind) return undefined;
  if (a.supersedes === b.id || b.supersedes === a.id) return undefined;
  if (a.kind === 'decision' && (a.status ?? 'active') === 'active' && b.status === 'active') return 'both are active decisions';
  if (a.tier === 'canonical' && b.tier === 'canonical' && b.status === 'accepted') return `an accepted canonical ${b.kind ?? 'note'} already covers this`;
  return undefined;
}

/**
 * Ranks the existing notes against the draft (title + the first 200 body characters) with the brain's own
 * ranking, normalized by the draft's score against itself, and returns the top related live notes.
 * Sessions and the draft itself are never linked.
 */
export function compileNote(draft: Note, existing: Note[], options: CompileOptions = {}): CompileResult {
  const { now = new Date(), limit = 5, minRatio = 0.3, conflictRatio = 0.55 } = options;
  const own = Array.isArray(draft.meta.links) ? draft.meta.links : [];
  const query = `${draft.meta.title} ${draft.body.slice(0, QUERY_BODY_CHARS)}`;
  const pool = [...existing.filter(note => note.meta.id !== draft.meta.id), draft];
  const hits = rankNotes(query, pool, now, pool.length, { includeHistory: true, includePassages: false });
  const self = hits.find(hit => hit.note === draft)?.score ?? hits[0]?.score ?? 0;
  if (!(self > 0)) return { links: [...new Set(own)], linked: [], possibleConflicts: [] };
  const related = hits
    .filter(hit => hit.note !== draft && hit.note.meta.id !== draft.meta.id)
    .filter(hit => hit.note.meta.tier !== 'episodic' && hit.note.meta.kind !== 'session' && isOperationalNote(hit.note))
    .filter(hit => hit.score >= minRatio * self)
    .slice(0, Math.max(0, limit));
  const linked = related.map(hit => hit.note.meta.id).filter(id => !own.includes(id));
  const possibleConflicts: PossibleConflict[] = [];
  for (const hit of related) {
    const ratio = hit.score / self;
    const why = ratio >= conflictRatio ? competing(draft, hit.note) : undefined;
    if (why) possibleConflicts.push({ id: hit.note.meta.id, title: hit.note.meta.title, reason: `${why}; overlap ${ratio.toFixed(2)}` });
  }
  return {
    links: [...new Set([...own, ...linked])],
    linked,
    possibleConflicts,
    ...(possibleConflicts.length && !draft.meta.supersedes ? { suggestedSupersedes: possibleConflicts[0]!.id } : {}),
  };
}
