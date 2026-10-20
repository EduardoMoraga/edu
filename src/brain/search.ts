import type { Note, RecallHit } from '../core/contracts.js';
import { learnedWeight } from './learning.js';
import { normalizeReference } from './resolve.js';

export function tokenize(text: string): string[] {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en').match(/[a-z0-9]+/g) ?? [];
}

// Deliberately small ES/EN vocabulary, not translation or general semantic search.
// Normalize both sides once per token: synonyms do not multiply a query's weight.
const vocabulary = [
  'payment payments pago pagos pagar pague cobro cobros',
  'invoice invoices factura facturas',
  'duplicate duplicates duplicated duplicado duplicados duplicada duplicadas repetido repetidos repetida repetidas',
  'retry retries reattempt reintento reintentos reintentar',
  'restore restoration restaurar restauracion',
  'backup backups respaldo respaldos',
  'connection connections conexion conexiones',
  'deploy deployment despliegue desplegar',
];
const concepts = new Map(vocabulary.flatMap(group => {
  const words = group.split(' ');
  return words.map(word => [word, words[0]!] as const);
}));
const stopwords = new Set(('a an the how what which do does we i to of for in on is are be and or ' +
  'como que cual cuales el la los las un una unos unas de del al para en por y o se su sus').split(' '));
const searchTokens = (text: string) => tokenize(text).filter(term => !stopwords.has(term)).map(term => concepts.get(term) ?? term);

export interface SearchOptions {
  /** Include historical/proposed notes in general lexical searches. Explicit IDs/aliases always work. */
  includeHistory?: boolean;
  /** Extract passages by default; set false when a caller only needs ranking (e.g. context selection). */
  includePassages?: boolean;
}

export function isOperationalNote(note: Note): boolean {
  return !note.meta.superseded_by && !['retired', 'reverted', 'superseded'].includes(note.meta.status ?? '')
    && !(note.meta.tier === 'canonical' && note.meta.status === 'proposed');
}

// Only a complete wikilink has a display label; pipes in ordinary queries are search punctuation.
const searchReference = (query: string): string => /^\[\[[^\[\]\r\n]*\]\]$/.test(query.trim())
  ? normalizeReference(query) : query.trim();

/** A bounded verbatim window, not a summary or a guarantee of complete instructions. */
export function relevantPassage(body: string, query: string, maxChars = 480): string {
  const size = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 480;
  if (!size || !body) return '';
  if (body.length <= size) return body.trim();
  const terms = new Set(searchTokens(searchReference(query)));
  if (!terms.size) return body.slice(0, size).trim();
  // Tokenize each original word once, retaining offsets even with accents. Only matching words
  // enter the sliding window; each enters/leaves its term counts once (linear in body length).
  const hits: { start: number; end: number; terms: string[] }[] = [];
  for (const token of body.matchAll(/[\p{L}\p{N}]+/gu)) {
    const matched = searchTokens(token[0]).filter(term => terms.has(term));
    if (matched.length) hits.push({ start: token.index, end: token.index + token[0].length, terms: matched });
  }
  let bestStart = 0;
  let bestScore = 0;
  let left = 0;
  let right = 0;
  const counts = new Map<string, number>();
  for (const hit of hits) {
    const start = Math.max(0, hit.start - Math.min(80, Math.floor(size / 4)));
    while (right < hits.length && hits[right]!.end <= start + size) {
      for (const term of hits[right++]!.terms) counts.set(term, (counts.get(term) ?? 0) + 1);
    }
    while (left < right && hits[left]!.start < start) {
      for (const term of hits[left++]!.terms) {
        const remaining = counts.get(term)! - 1;
        if (remaining) counts.set(term, remaining); else counts.delete(term);
      }
    }
    if (counts.size > bestScore) { bestScore = counts.size; bestStart = start; }
    if (bestScore === terms.size) break;
  }
  // Start at the paragraph boundary when it fits before the match.
  const paragraph = body.indexOf('\n\n', bestStart);
  if (paragraph >= bestStart && paragraph < bestStart + 80 && paragraph + 2 < body.length) {
    const prefix = body.slice(bestStart, paragraph);
    if (!searchTokens(prefix).some(term => terms.has(term))) bestStart = paragraph + 2;
  }
  return body.slice(bestStart, bestStart + size).trim();
}

export function rankNotes(query: string, notes: Note[], now = new Date(), limit = 10, options: SearchOptions = {}): RecallHit[] {
  const reference = searchReference(query);
  if (!reference) return [];
  const terms = [...new Set(searchTokens(reference))];
  // A query that is exactly a note's id, alias or legacy id (e.g. an imported "D-010") names that note: it ranks first.
  const key = reference.toLocaleLowerCase('en');
  const named = (note: Note) => [note.meta.id, note.meta.legacy_id, ...(Array.isArray(note.meta.aliases) ? note.meta.aliases : [])]
    .some(name => typeof name === 'string' && name.toLocaleLowerCase('en') === key);
  const docs = notes.filter(note => options.includeHistory || isOperationalNote(note) || named(note))
    .map(note => ({ note, fields: [searchTokens(note.meta.title), searchTokens(note.meta.tags.join(' ')), searchTokens(note.body)] }));
  // Document frequency once per term (it was recomputed for every document: quadratic in the brain size).
  const df = new Map(terms.map(term => [term, docs.filter(doc => doc.fields.some(field => field.includes(term))).length]));
  const avgdl = docs.reduce((sum, doc) => sum + doc.fields[0]!.length * 2 + doc.fields[1]!.length + doc.fields[2]!.length, 0) / Math.max(docs.length, 1);
  const scored = docs.map(({ note, fields }) => {
    const weighted = [...fields[0]!, ...fields[0]!, ...fields[1]!, ...fields[2]!];
    const dl = weighted.length;
    let bm25 = 0;
    const matched: string[] = [];
    for (const term of terms) {
      const termDf = df.get(term)!;
      const idf = Math.log(1 + (docs.length - termDf + 0.5) / (termDf + 0.5));
      const tf = weighted.filter(token => token === term).length;
      if (!tf) continue;
      matched.push(term);
      bm25 += idf * (tf * 2.2) / (tf + 1.2 * (1 - 0.75 + 0.75 * dl / Math.max(avgdl, 1)));
    }
    const w = learnedWeight(note.meta.usage, now);
    if (named(note)) return { note, score: 1_000_000, why: `Named by id or alias "${query.trim()}"; learned weight ${w.toFixed(2)}.`, matches: 1 };
    return { note, score: bm25 * (0.5 + w), why: `Matched ${matched.length ? matched.join(', ') : 'no terms'}; learned weight ${w.toFixed(2)}.`, matches: matched.length };
  }).filter(hit => hit.matches > 0);
  return scored.sort((a, b) => b.score - a.score || a.note.meta.id.localeCompare(b.note.meta.id)).slice(0, Math.max(0, limit)).map(({ matches: _matches, ...hit }) => {
    if (options.includePassages === false) return hit;
    const passage = relevantPassage(hit.note.body, reference);
    return { ...hit, why: `${hit.why}${passage ? ` Passage: ${JSON.stringify(passage)}` : ''}` };
  });
}
