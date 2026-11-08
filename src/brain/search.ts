import type { Note, RecallHit } from '../core/contracts.js';
import { learnedWeight } from './learning.js';
import { analyzeToken, conceptWords, CONCEPT_PREFIX, fuzzyCandidates, queryStopwords, stem, tokenize } from './lexicon.js';
import { normalizeReference } from './resolve.js';

export { tokenize };

/** A concept-bridge match (e.g. Spanish query, English note) counts less than the same stem. */
const BRIDGE_WEIGHT = 0.6;
/** BM25 term-frequency saturation and length normalization. */
const K1 = 1.2;
const B = 0.75;
/** The title counts this many times in the term frequencies (a light BM25F field weight). */
const TITLE_WEIGHT = 2;
/**
 * Score × coverage^COVERAGE_EXPONENT, where coverage is the IDF-weighted share of distinct query units a note
 * matches. BM25 alone lets a long note that repeats one query word outrank a short note that answers all of it.
 */
const COVERAGE_EXPONENT = 0.5;
/** Score × (1 + TITLE_COVERAGE_BOOST × IDF-weighted share of query units found in the title). */
const TITLE_COVERAGE_BOOST = 0.5;
/** A fuzzy (typo) match counts less than a bridge match. */
const FUZZY_WEIGHT = 0.5;
/** Below this raw BM25 the best hit is weak enough to try fuzzy matches for unknown words. */
const WEAK_SCORE = 1;

/**
 * Words that ask for a kind of note ("¿qué decidimos?", "what did we learn", "pendientes", "hipótesis").
 * A note of the asked kind gets a small multiplicative boost; it never adds a match on its own.
 */
const KIND_CUES: ReadonlyArray<readonly [kind: string, words: readonly string[]]> = [
  ['decision', ['decision', 'decisions', 'decide', 'decided', 'decidir', 'decidimos', 'decidio', 'decidieron', 'decisiones', 'acordamos', 'acordado', 'agreed', 'chose', 'chosen', 'elegimos']],
  ['lesson', ['lesson', 'lessons', 'learn', 'learned', 'learnt', 'leccion', 'lecciones', 'aprendimos', 'aprendido', 'aprendizaje', 'aprendizajes', 'takeaway', 'takeaways']],
  ['commitment', ['commitment', 'commitments', 'committed', 'promise', 'promised', 'pendiente', 'pendientes', 'compromiso', 'compromisos', 'prometimos', 'owe', 'due']],
  ['hypothesis', ['hypothesis', 'hypotheses', 'suspect', 'suspicion', 'hipotesis', 'sospecha', 'sospechamos', 'theory', 'teoria']],
];
const KIND_BOOST = 0.15;
/**
 * Score × EPISODE_WEIGHT for episodic notes (session logs). A session mentions many topics in passing; the
 * decision, lesson or canonical note distilled from it is the better answer when both match a question.
 */
const EPISODE_WEIGHT = 0.85;

/** Kinds the query asks for, from its cue words. */
function askedKinds(text: string): Set<string> {
  const tokens = new Set(tokenize(text));
  return new Set(KIND_CUES.filter(([, words]) => words.some(word => tokens.has(word))).map(([kind]) => kind));
}

export interface SearchOptions {
  /** Include historical/proposed notes in general lexical searches. Explicit IDs/aliases always work. */
  includeHistory?: boolean;
  /** Extract passages by default; set false when a caller only needs ranking (e.g. context selection). */
  includePassages?: boolean;
  /**
   * Plain BM25 similarity over every query word, without the question shaping (query function words, coverage,
   * title coverage, kind cues, episode weight). For callers
   * that compare a whole note against others by score ratio (compile on write), not answer a question.
   */
  similarity?: boolean;
}

export function isOperationalNote(note: Note): boolean {
  return !note.meta.superseded_by && !['retired', 'reverted', 'superseded'].includes(note.meta.status ?? '')
    && !(note.meta.tier === 'canonical' && note.meta.status === 'proposed');
}

// Only a complete wikilink has a display label; pipes in ordinary queries are search punctuation.
const searchReference = (query: string): string => /^\[\[[^\[\]\r\n]*\]\]$/.test(query.trim())
  ? normalizeReference(query) : query.trim();

interface Feature { term: string; weight: number }
/**
 * One idea of the query: its stem plus the concept keys it bridges to. Words that share a concept
 * ("retry reintentos") form one unit, so synonyms do not multiply a query's weight; a unit scores
 * its best feature, so the exact stem beats the bridge to the other language.
 */
interface QueryUnit { label: string; features: Feature[]; words: string[] }

function queryUnits(text: string, keepFunctionWords = false): QueryUnit[] {
  const units = new Map<string, QueryUnit>();
  const tokens = tokenize(text);
  // Function words ("which", "should", "desde") only add noise to a question that has content words.
  const content = keepFunctionWords ? tokens : tokens.filter(token => !queryStopwords.has(token));
  for (const token of content.length ? content : tokens) {
    const { stem: s, concepts } = analyzeToken(token);
    if (!s) continue;
    const key = concepts.length ? [...concepts].sort().join(' ') : s;
    let unit = units.get(key);
    if (!unit) {
      unit = { label: s, features: concepts.map(term => ({ term, weight: BRIDGE_WEIGHT })), words: [] };
      units.set(key, unit);
    }
    if (!unit.features.some(feature => feature.term === s)) unit.features.unshift({ term: s, weight: 1 });
    if (!unit.words.includes(token)) unit.words.push(token);
  }
  return [...units.values()];
}

/** Per-note term frequencies over stems and concept keys (the title weighted), plus the title's terms. */
interface DocVector { tf: Map<string, number>; length: number; words: Set<string>; title: Set<string> }

function addField(vector: DocVector, text: string, times: number, title = false): void {
  for (const token of tokenize(text)) {
    const { stem: s, concepts } = analyzeToken(token);
    if (!s) continue;
    if (title) { vector.title.add(s); for (const concept of concepts) vector.title.add(concept); }
    vector.length += times;
    vector.words.add(token);
    vector.tf.set(s, (vector.tf.get(s) ?? 0) + times);
    for (const concept of concepts) vector.tf.set(concept, (vector.tf.get(concept) ?? 0) + times);
  }
}

// Notes come from the store's parsed-note cache, so an unchanged note hands out the same strings:
// the vector is reused while path, title, tags and body are identical. Bounded, process-local.
interface CachedVector { title: string; tags: string; body: string; vector: DocVector }
const vectorCache = new Map<string, CachedVector>();
const VECTOR_CACHE_LIMIT = 10_000;

function docVector(note: Note): DocVector {
  const title = note.meta.title ?? '';
  const tags = Array.isArray(note.meta.tags) ? note.meta.tags.join(' ') : '';
  const body = note.body ?? '';
  const cached = vectorCache.get(note.path);
  if (cached && cached.title === title && cached.tags === tags && cached.body === body) return cached.vector;
  const vector: DocVector = { tf: new Map(), length: 0, words: new Set(), title: new Set() };
  addField(vector, title, TITLE_WEIGHT, true);
  addField(vector, tags, 1);
  addField(vector, body, 1);
  if (vectorCache.size >= VECTOR_CACHE_LIMIT) vectorCache.delete(vectorCache.keys().next().value!);
  vectorCache.set(note.path, { title, tags, body, vector });
  return vector;
}

/** A bounded verbatim window, not a summary or a guarantee of complete instructions. */
export function relevantPassage(body: string, query: string, maxChars = 480): string {
  return passageFor(body, queryUnits(searchReference(query)), maxChars);
}

function passageFor(body: string, units: QueryUnit[], maxChars: number): string {
  const size = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 480;
  if (!size || !body) return '';
  if (body.length <= size) return body.trim();
  // Each stem or concept points at the query units it serves; a window scores distinct units.
  const unitsByTerm = new Map<string, number[]>();
  units.forEach((unit, index) => {
    for (const { term } of unit.features) unitsByTerm.set(term, [...(unitsByTerm.get(term) ?? []), index]);
  });
  if (!units.length) return body.slice(0, size).trim();
  const matchedUnits = (word: string): number[] => {
    const found = new Set<number>();
    for (const token of tokenize(word)) {
      const { stem: s, concepts } = analyzeToken(token);
      if (!s) continue;
      for (const index of unitsByTerm.get(s) ?? []) found.add(index);
      for (const concept of concepts) for (const index of unitsByTerm.get(concept) ?? []) found.add(index);
    }
    return [...found];
  };
  // Tokenize each original word once, retaining offsets even with accents. Only matching words
  // enter the sliding window; each enters/leaves its unit counts once (linear in body length).
  const hits: { start: number; end: number; units: number[] }[] = [];
  for (const token of body.matchAll(/[\p{L}\p{N}]+/gu)) {
    const matched = matchedUnits(token[0]);
    if (matched.length) hits.push({ start: token.index, end: token.index + token[0].length, units: matched });
  }
  let bestStart = 0;
  let bestScore = 0;
  let left = 0;
  let right = 0;
  const counts = new Map<number, number>();
  for (const hit of hits) {
    const start = Math.max(0, hit.start - Math.min(80, Math.floor(size / 4)));
    while (right < hits.length && hits[right]!.end <= start + size) {
      for (const unit of hits[right++]!.units) counts.set(unit, (counts.get(unit) ?? 0) + 1);
    }
    while (left < right && hits[left]!.start < start) {
      for (const unit of hits[left++]!.units) {
        const remaining = counts.get(unit)! - 1;
        if (remaining) counts.set(unit, remaining); else counts.delete(unit);
      }
    }
    if (counts.size > bestScore) { bestScore = counts.size; bestStart = start; }
    if (bestScore === units.length) break;
  }
  // Start at the paragraph boundary when it fits before the match.
  const paragraph = body.indexOf('\n\n', bestStart);
  if (paragraph >= bestStart && paragraph < bestStart + 80 && paragraph + 2 < body.length) {
    const prefix = body.slice(bestStart, paragraph);
    if (!prefix.split(/[^\p{L}\p{N}]+/u).some(word => word && matchedUnits(word).length)) bestStart = paragraph + 2;
  }
  return body.slice(bestStart, bestStart + size).trim();
}

interface Doc { note: Note; vector: DocVector; named: boolean }

function bm25Scores(units: QueryUnit[], docs: Doc[]) {
  // Document frequency once per feature (not per document: that was quadratic in the brain size).
  const df = new Map<string, number>();
  for (const unit of units) for (const { term } of unit.features) {
    if (!df.has(term)) df.set(term, docs.reduce((count, doc) => count + (doc.vector.tf.has(term) ? 1 : 0), 0));
  }
  const idfOf = (term: string) => { const termDf = df.get(term)!; return Math.log(1 + (docs.length - termDf + 0.5) / (termDf + 0.5)); };
  // How much a query unit is worth for coverage: its rarest feature present in the brain.
  const unitIdf = units.map(unit => Math.max(0, ...unit.features.filter(({ term }) => df.get(term)).map(({ term }) => idfOf(term))));
  const totalIdf = unitIdf.reduce((sum, value) => sum + value, 0);
  const avgdl = docs.reduce((sum, doc) => sum + doc.vector.length, 0) / Math.max(docs.length, 1);
  return docs.map(doc => {
    let bm25 = 0;
    let covered = 0;
    let inTitle = 0;
    const matched: string[] = [];
    units.forEach((unit, index) => {
      let best = 0;
      let bestTerm = '';
      for (const { term, weight } of unit.features) {
        const tf = doc.vector.tf.get(term);
        if (!tf) continue;
        const score = weight * idfOf(term) * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * doc.vector.length / Math.max(avgdl, 1)));
        if (score > best) { best = score; bestTerm = term; }
      }
      if (!best) return;
      bm25 += best;
      covered += unitIdf[index]!;
      if (unit.features.some(({ term }) => doc.vector.title.has(term))) inTitle += unitIdf[index]!;
      matched.push(bestTerm.startsWith(CONCEPT_PREFIX) ? `${unit.label}→${bestTerm.slice(CONCEPT_PREFIX.length)}` : bestTerm === unit.features[0]!.term ? bestTerm : `${unit.label}≈${bestTerm}`);
    });
    return { doc, bm25, coverage: totalIdf ? covered / totalIdf : 0, titleCoverage: totalIdf ? inTitle / totalIdf : 0, matched };
  });
}

/**
 * Typo fallback: a query word no note contains (by stem or concept) gains the stems and concepts of
 * close known words, from the notes or from the concept table. Runs only when recall is weak.
 */
function addFuzzyFeatures(units: QueryUnit[], docs: Doc[]): boolean {
  const unknown = units.filter(unit => !docs.some(doc => unit.features.some(({ term }) => doc.vector.tf.has(term))));
  if (!unknown.length) return false;
  const vocabulary = new Set(conceptWords);
  for (const doc of docs) for (const word of doc.vector.words) vocabulary.add(word);
  let added = false;
  for (const unit of unknown) {
    for (const word of unit.words) {
      for (const { term: match } of fuzzyCandidates(word, vocabulary)) {
        const { stem: s, concepts } = analyzeToken(match);
        for (const [term, weight] of [[s ?? stem(match), FUZZY_WEIGHT], ...concepts.map(c => [c, FUZZY_WEIGHT * BRIDGE_WEIGHT] as const)] as const) {
          if (unit.features.some(feature => feature.term === term)) continue;
          unit.features.push({ term, weight });
          added = true;
        }
      }
    }
  }
  return added;
}

export function rankNotes(query: string, notes: Note[], now = new Date(), limit = 10, options: SearchOptions = {}): RecallHit[] {
  const reference = searchReference(query);
  if (!reference) return [];
  const units = queryUnits(reference, options.similarity);
  // A query that is exactly a note's id, alias or legacy id (e.g. an imported "D-010") names that note: it ranks first.
  const key = reference.toLocaleLowerCase('en');
  const named = (note: Note) => [note.meta.id, note.meta.legacy_id, ...(Array.isArray(note.meta.aliases) ? note.meta.aliases : [])]
    .some(name => typeof name === 'string' && name.toLocaleLowerCase('en') === key);
  const docs: Doc[] = [];
  for (const note of notes) {
    const isNamed = named(note);
    if (options.includeHistory || isOperationalNote(note) || isNamed) docs.push({ note, vector: docVector(note), named: isNamed });
  }
  let scored = bm25Scores(units, docs);
  const hitsOf = (rows: typeof scored) => rows.filter(row => row.matched.length || row.doc.named);
  const lexical = hitsOf(scored);
  const top = Math.max(0, ...lexical.map(row => row.bm25));
  if ((lexical.length < limit || top < WEAK_SCORE) && addFuzzyFeatures(units, docs)) scored = bm25Scores(units, docs);
  const kinds = askedKinds(reference);
  const ranked = hitsOf(scored).map(({ doc: { note, named: isNamed }, bm25, coverage, titleCoverage, matched }) => {
    const w = learnedWeight(note.meta.usage, now);
    if (isNamed) return { note, score: 1_000_000, why: `Named by id or alias "${query.trim()}"; learned weight ${w.toFixed(2)}.` };
    const shape = options.similarity ? 1 : Math.pow(coverage, COVERAGE_EXPONENT) * (1 + TITLE_COVERAGE_BOOST * titleCoverage) * (kinds.has(note.meta.kind ?? '') ? 1 + KIND_BOOST : 1)
      * (note.meta.tier === 'episodic' ? EPISODE_WEIGHT : 1);
    return { note, score: bm25 * shape * (0.5 + w), why: `Matched ${matched.join(', ')}; learned weight ${w.toFixed(2)}.` };
  });
  return ranked.sort((a, b) => b.score - a.score || a.note.meta.id.localeCompare(b.note.meta.id)).slice(0, Math.max(0, limit)).map(hit => {
    if (options.includePassages === false) return hit;
    const passage = passageFor(hit.note.body, units, 480);
    return { ...hit, why: `${hit.why}${passage ? ` Passage: ${JSON.stringify(passage)}` : ''}` };
  });
}
