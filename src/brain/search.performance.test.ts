import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import type { Note } from '../core/contracts.js';
import { rankNotes, relevantPassage } from './search.js';

const now = new Date('2026-10-20T00:00:00Z');
const note = (id: string, body: string): Note => ({ path: `/fixture/${id}.md`, body,
  meta: { id, title: 'Memo', tier: 'transitive', kind: 'lesson', status: 'candidate', tags: [], links: [], created: now.toISOString() } });
const body = 'Retry payment with the same key. '.repeat(1800) + '\n\nRestore snapshot Q7 after 47 minutes.';

it('keeps pipe-separated search terms unless the whole query is a wikilink', () => {
  const notes = [note('L-a', 'alpha'), note('L-b', 'beta')];
  for (const query of ['alpha | beta', 'alpha|beta', '[[alpha]] | beta', '[[alpha|beta']) {
    expect(rankNotes(query, notes, now).map(hit => hit.note.meta.id).sort()).toEqual(['L-a', 'L-b']);
  }
  expect(rankNotes('| beta', notes, now).map(hit => hit.note.meta.id)).toEqual(['L-b']);
  expect(rankNotes(' [[L-a|beta]] ', notes, now).map(hit => hit.note.meta.id)).toEqual(['L-a']);
});

it('can omit passages without changing ranking, scores or note contents', () => {
  const notes = [note('L-a', 'retry payment'), note('L-b', 'payment')];
  const withPassages = rankNotes('retry payment', notes, now);
  const without = rankNotes('retry payment', notes, now, 10, { includePassages: false });
  expect(without.map(({ note, score }) => ({ note, score }))).toEqual(withPassages.map(({ note, score }) => ({ note, score })));
  expect(without.every(hit => !hit.why.includes('Passage:'))).toBe(true);
  expect(withPassages.every(hit => hit.why.includes('Passage:'))).toBe(true);
});

it('handles a large corpus and a full-body passage window within a broad latency budget', () => {
  const notes = Array.from({ length: 400 }, (_, i) => note(`L-${i}`, body));
  const start = performance.now();
  const hits = rankNotes('retry payment', notes, now, notes.length, { includePassages: false });
  const rankingMs = performance.now() - start;
  expect(hits).toHaveLength(400);
  expect(hits.every(hit => !hit.why.includes('Passage:'))).toBe(true);
  // Large windows used to rescan/tokenize all following tokens for each match.
  const passageStart = performance.now();
  expect(relevantPassage(body, 'retry snapshot Q7', body.length)).toBe(body);
  expect(relevantPassage(body, 'snapshot Q7')).toContain('47 minutes');
  expect(relevantPassage(body, 'retry snapshot absent', 12_000)).toContain('snapshot Q7');
  const passageMs = performance.now() - passageStart;
  console.log(JSON.stringify({ notes: notes.length, bodyChars: body.length, rankingMs, passageMs }));
  // A coarse regression guard, not a CPU microbenchmark or an LLM-efficiency claim.
  expect(rankingMs + passageMs).toBeLessThan(20_000);
}, 30_000);

it('returns bounded default passages for repeated terms in long notes', () => {
  const start = performance.now();
  const hits = rankNotes('retry payment', Array.from({ length: 10 }, (_, i) => note(`L-${i}`, body)), now);
  console.log(JSON.stringify({ defaultPassageNotes: hits.length, bodyChars: body.length, elapsedMs: performance.now() - start }));
  expect(hits).toHaveLength(10);
  expect(hits.every(hit => hit.why.includes('Retry payment with the same key.'))).toBe(true);
  expect(relevantPassage(body, 'retry payment').length).toBeLessThanOrEqual(480);
});
