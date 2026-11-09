import { describe, expect, it } from 'vitest';
import type { Note, NoteMeta, RecallHit } from '../core/contracts.js';
import { fuseRankings, MAX_QUERY_VARIANTS, NAMED_SCORE, queryVariants, rankNotes, rankQueries, RRF_K } from './search.js';

const now = new Date('2026-10-20T00:00:00Z');
const note = (id: string, title: string, body: string, meta: Partial<NoteMeta> = {}): Note => ({
  path: `/fusion/${id}.md`, body,
  meta: { id, title, tier: 'transitive', kind: 'decision', status: 'active', tags: [], links: [], created: now.toISOString(), ...meta },
});
const hit = (n: Note, score: number, why = `why ${n.meta.id}`): RecallHit => ({ note: n, score, why });

const a = note('L-a', 'Alpha', 'alpha');
const b = note('L-b', 'Beta', 'beta');
const c = note('L-c', 'Gamma', 'gamma');
const d = note('L-d', 'Delta', 'delta');

describe('queryVariants', () => {
  it('trims, drops empties, dedupes case-insensitively and caps the count', () => {
    expect(queryVariants([' retry ', 'Retry', '', '  ', 'reintentos', 'a', 'b', 'c'])).toEqual(['retry', 'reintentos', 'a', 'b']);
    expect(MAX_QUERY_VARIANTS).toBe(4);
  });
});

describe('fuseRankings (Reciprocal Rank Fusion)', () => {
  it('sums 1 / (k + rank) over the lists that contain a note, with k = 60', () => {
    expect(RRF_K).toBe(60);
    const fused = fuseRankings([[hit(a, 3), hit(b, 2)], [hit(b, 5), hit(c, 1)]]);
    expect(fused.map(entry => entry.hit.note.meta.id)).toEqual(['L-b', 'L-a', 'L-c']);
    expect(fused[0]!.rrf).toBeCloseTo(1 / 62 + 1 / 61, 12);
    expect(fused[1]!.rrf).toBeCloseTo(1 / 61, 12);
    expect(fused[2]!.rrf).toBeCloseTo(1 / 62, 12);
  });

  it('breaks RRF ties by the best single score, then by id', () => {
    // a and b are both rank 1 in one list: equal RRF; b has the better single score.
    expect(fuseRankings([[hit(a, 2)], [hit(b, 9)]]).map(entry => entry.hit.note.meta.id)).toEqual(['L-b', 'L-a']);
    expect(fuseRankings([[hit(b, 4)], [hit(a, 4)]]).map(entry => entry.hit.note.meta.id)).toEqual(['L-a', 'L-b']);
  });

  it('keeps notes named by id or alias on top whatever their fused rank', () => {
    const fused = fuseRankings([[hit(a, 5), hit(b, 4), hit(c, 3)], [hit(a, 5), hit(b, 4), hit(d, NAMED_SCORE)]]);
    expect(fused[0]!.hit.note.meta.id).toBe('L-d');
    expect(fused[0]!.named).toBe(true);
  });

  it('takes the hit (and its why) from the variant where the note ranked best', () => {
    const fused = fuseRankings([[hit(a, 3), hit(b, 2, 'from first')], [hit(b, 1, 'from second')]]);
    const entry = fused.find(item => item.hit.note === b)!;
    expect(entry.variant).toBe(1);
    expect(entry.hit.why).toBe('from second');
    expect(entry.best).toBe(2);
  });

  it('is deterministic regardless of input order inside equal ranks', () => {
    const lists = [[hit(a, 1), hit(b, 1)], [hit(c, 1), hit(d, 1)]];
    const first = fuseRankings(lists).map(entry => entry.hit.note.meta.id);
    expect(fuseRankings(lists).map(entry => entry.hit.note.meta.id)).toEqual(first);
    expect(first).toEqual(['L-a', 'L-c', 'L-b', 'L-d']);
  });
});

const corpus = [
  note('E-pager', 'On-call escalation', 'When the pager fires twice in an hour, escalate to the platform lead and open an incident.'),
  note('E-coffee', 'Coffee machine', 'The office coffee machine is cleaned on Tuesdays.'),
  note('S-guardia', 'Turnos de soporte', 'El turno de soporte rota cada semana entre los equipos.'),
  note('S-vacaciones', 'Vacaciones', 'Las vacaciones se piden con dos semanas de anticipación.'),
  note('D-010', 'Alias target', 'Unrelated text.', { aliases: ['the-alias'] }),
];

describe('rankQueries', () => {
  it('is exactly rankNotes for a single query (string or one deduplicated variant)', () => {
    for (const query of ['turno de soporte', 'pager escalation', 'D-010']) {
      const single = rankNotes(query, corpus, now, 10);
      expect(rankQueries([query], corpus, now, 10)).toEqual(single);
      expect(rankQueries([` ${query} `, query.toUpperCase(), ''], corpus, now, 10)).toEqual(rankNotes(` ${query} `.trim(), corpus, now, 10));
    }
  });

  it('finds the English note through the English alternative of a Spanish question', () => {
    const spanish = '¿a quién avisamos cuando suena el buscapersonas dos veces?';
    expect(rankNotes(spanish, corpus, now, 3).map(h => h.note.meta.id)).not.toContain('E-pager');
    const fused = rankQueries([spanish, 'who do we escalate to when the pager fires twice'], corpus, now, 3);
    expect(fused[0]!.note.meta.id).toBe('E-pager');
    expect(fused[0]!.score).toBeCloseTo(1 / (RRF_K + 1), 12);
    expect(fused[0]!.why).toContain('pager');
    expect(fused[0]!.why).toContain('Passage: ');
  });

  it('keeps an id named by any variant on top and is deterministic', () => {
    const run = () => rankQueries(['turno de soporte', 'the-alias'], corpus, now, 5);
    const hits = run();
    expect(hits[0]!.note.meta.id).toBe('D-010');
    expect(hits[0]!.score).toBe(NAMED_SCORE);
    expect(run()).toEqual(hits);
  });
});
