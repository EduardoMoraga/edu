import type { Note, RecallHit } from '../core/contracts.js';
import { learnedWeight } from './learning.js';

export function tokenize(text: string): string[] {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en').match(/[a-z0-9]+/g) ?? [];
}

export function rankNotes(query: string, notes: Note[], now = new Date(), limit = 10): RecallHit[] {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return [];
  const docs = notes.map(note => ({ note, fields: [tokenize(note.meta.title), tokenize(note.meta.tags.join(' ')), tokenize(note.body)] }));
  const avgdl = docs.reduce((sum, doc) => sum + doc.fields[0]!.length * 2 + doc.fields[1]!.length + doc.fields[2]!.length, 0) / Math.max(docs.length, 1);
  const scored = docs.map(({ note, fields }) => {
    const weighted = [...fields[0]!, ...fields[0]!, ...fields[1]!, ...fields[2]!];
    const dl = weighted.length;
    let bm25 = 0;
    const matched: string[] = [];
    for (const term of terms) {
      const df = docs.filter(doc => doc.fields.some(field => field.includes(term))).length;
      const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
      const tf = weighted.filter(token => token === term).length;
      if (!tf) continue;
      matched.push(term);
      bm25 += idf * (tf * 2.2) / (tf + 1.2 * (1 - 0.75 + 0.75 * dl / Math.max(avgdl, 1)));
    }
    const w = learnedWeight(note.meta.usage, now);
    return { note, score: bm25 * (0.5 + w), why: `Matched ${matched.length ? matched.join(', ') : 'no terms'}; learned weight ${w.toFixed(2)}.`, matches: matched.length };
  }).filter(hit => hit.matches > 0);
  return scored.sort((a, b) => b.score - a.score || a.note.meta.id.localeCompare(b.note.meta.id)).slice(0, Math.max(0, limit)).map(({ matches: _matches, ...hit }) => hit);
}
