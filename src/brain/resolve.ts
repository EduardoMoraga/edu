import { basename } from 'node:path';
import type { Note } from '../core/contracts.js';

export type ResolveVia = 'id' | 'alias' | 'prefix' | 'stem' | 'title';
/** One note, or the candidates when the reference is ambiguous at the first step that matches it. */
export type ResolveResult = { via: ResolveVia; note: Note } | { via: ResolveVia; candidates: Note[] };

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const stemOf = (path: string) => basename(path.replace(/\\/g, '/'), '.md').toLowerCase();

function pick(via: ResolveVia, matches: Note[]): ResolveResult | undefined {
  if (!matches.length) return undefined;
  return matches.length === 1 ? { via, note: matches[0]! } : { via, candidates: matches };
}

/**
 * Resolves what a human or agent calls a note, in order: exact id → legacy_id / alias → unique id prefix
 * → filename stem (Edu's, or the imported source's) → exact title (case- and accent-insensitive).
 * The first step with any match decides; several matches there come back as candidates, never a guess.
 */
export function resolveReference(notes: Note[], reference: string): ResolveResult | undefined {
  const ref = reference.trim().replace(/^\[\[|\]\]$/g, '').split('|')[0]!.trim();
  if (!ref) return undefined;
  const lower = ref.toLowerCase();
  const exact = notes.filter(note => note.meta.id === ref);
  if (exact.length) return pick('id', exact);
  const alias = pick('alias', notes.filter(note => note.meta.legacy_id?.toLowerCase() === lower || (note.meta.aliases ?? []).some(name => name.toLowerCase() === lower)));
  if (alias) return alias;
  const prefixed = notes.filter(note => note.meta.id.toLowerCase().startsWith(lower));
  // `D-002` should pick `D-002-x` over `D-0021-y`: a match ending on a word boundary wins over a longer token.
  const whole = prefixed.filter(note => /^[-_.]?$|^[-_.]/.test(note.meta.id.slice(lower.length)));
  const prefix = pick('prefix', whole.length ? whole : prefixed);
  if (prefix) return prefix;
  const stemQuery = lower.replace(/\.md$/, '');
  const stem = pick('stem', notes.filter(note => stemOf(note.path) === stemQuery || (note.meta.origin ? stemOf(note.meta.origin) === stemQuery : false)));
  if (stem) return stem;
  const title = fold(ref);
  return pick('title', notes.filter(note => fold(note.meta.title) === title));
}
