import { describe, expect, it } from 'vitest';
import type { Note, NoteMeta } from '../core/contracts.js';
import { rankNotes, relevantPassage } from './search.js';
import { resolveReference } from './resolve.js';

const now = new Date('2026-10-20T00:00:00Z');
const note = (id: string, body: string, meta: Partial<NoteMeta> = {}): Note => ({
  path: `/fixture/${id}.md`, body,
  meta: { id, title: id, tier: 'transitive', kind: 'decision', status: 'active', tags: [], links: [], created: now.toISOString(), ...meta },
});

describe('operational retrieval', () => {
  it.each(['retired', 'reverted', 'superseded', 'proposed'] as const)('excludes %s from general recall but preserves explicit history', status => {
    const old = note('D-old', 'snapshot restore', { status, tier: status === 'proposed' || status === 'superseded' ? 'canonical' : 'transitive', aliases: ['old-policy'], legacy_id: 'D-702' });
    const current = note('D-current', 'snapshot restore');
    expect(rankNotes('snapshot', [old, current], now).map(h => h.note.meta.id)).toEqual(['D-current']);
    for (const ref of ['D-old', 'old-policy', 'D-702', '[[D-702|history]]']) {
      expect(rankNotes(ref, [old, current], now)[0]?.note).toEqual(old);
      expect(resolveReference([old, current], ref)).toMatchObject({ note: old });
    }
  });
  it('excludes superseded_by imports even with stale active status', () => {
    expect(rankNotes('snapshot', [note('D-old', 'snapshot', { superseded_by: 'D-new' })], now)).toEqual([]);
  });
  it('keeps statusless legacy notes and accepted canonical notes', () => {
    const notes = [note('D-legacy', 'snapshot', { status: undefined }), note('K-good', 'snapshot', { tier: 'canonical', status: 'accepted' })];
    expect(rankNotes('snapshot', notes, now)).toHaveLength(2);
  });
  it('finds a payment rule from a natural Spanish question despite stopword noise', () => {
    const target = note('D-rule', 'Cobros duplicados: conservar Idempotency-Key durante 72 horas; rechazar el segundo cargo.');
    const noise = Array.from({ length: 15 }, (_, i) => note(`D-noise-${i}`, 'Como que la el para de se misma veces'));
    expect(rankNotes('¿Cómo impedir que la misma factura se pague dos veces?', [...noise, target], now, 1)[0]?.note).toEqual(target);
  });
  it.each(['How do we retry payments?', '¿Cómo reintentar pagos?'])('retrieves a bilingual rule: %s', query => {
    const target = note('D-rule', 'Política de reintentos de cobros: conservar Idempotency-Key durante 72 horas.');
    expect(rankNotes(query, [target, note('D-noise', 'How do we como de')], now, 1)[0]?.note).toEqual(target);
  });
  it('exposes a relevant verbatim tail passage without changing the stored body', () => {
    const tail = 'Restaurar snapshot Q7 y esperar exactamente 47 minutos antes de habilitar escrituras.';
    const target = note('D-long', 'Antecedentes sin instrucciones. '.repeat(300) + '\n\n' + tail);
    const hit = rankNotes('snapshot Q7', [target], now)[0]!;
    expect(hit.why).toContain(tail);
    expect(hit.note.body).toEqual(target.body);
  });
  it('offers opt-in historical lexical search without mutating notes', () => {
    const old = note('D-old', 'Restaurar snapshot Q7', { status: 'retired' });
    const before = structuredClone(old);
    expect(rankNotes('snapshot', [old], now, 10, { includeHistory: true })[0]?.note).toEqual(old);
    expect(rankNotes('snapshot', [old], now)).toEqual([]);
    expect(old).toEqual(before);
  });
  it('normalizes wikilinks and ignores their display labels', () => {
    const old = note('D-old', 'Historical policy', { status: 'reverted', aliases: ['the'] });
    const unrelated = note('D-label', 'Displayed label', { status: 'retired' });
    expect(rankNotes(' [[the|Displayed label]] ', [unrelated, old], now).map(h => h.note.meta.id)).toEqual(['D-old']);
    expect(resolveReference([old], ' [[the|Displayed label]] ')).toMatchObject({ note: old });
  });
  it('matches a Spanish query against English vocabulary and accents', () => {
    const target = note('D-rule', 'Retry payments using the same Idempotency-Key.');
    expect(rankNotes('política de reintentos de pagos', [target], now)[0]?.note).toEqual(target);
  });
  it('returns bounded verbatim passages with accents and no paragraph breaks', () => {
    const body = 'Información contextual. '.repeat(200) + 'Restauración: usar snapshot Q7 durante 47 minutos.';
    const passage = relevantPassage(body, 'restaurar snapshot Q7', 160);
    expect(body).toContain(passage);
    expect(passage).toContain('snapshot Q7 durante 47 minutos');
    expect(passage.length).toBeLessThanOrEqual(160);
    expect(relevantPassage(body, 'snapshot', 0)).toBe('');
    expect(relevantPassage('', 'snapshot')).toBe('');
  });
  it('handles empty queries and respects the result limit', () => {
    const notes = [note('D-a', 'snapshot'), note('D-b', 'snapshot')];
    expect(rankNotes(' [[|label]] ', notes, now)).toEqual([]);
    expect(rankNotes('snapshot', notes, now, 0)).toEqual([]);
    expect(rankNotes('snapshot', notes, now, 1)).toHaveLength(1);
  });
  it('does not invent semantic matches for unrelated vocabulary', () => {
    expect(rankNotes('astronaut galaxy', [note('D-rule', 'Idempotency-Key durante 72 horas')], now)).toEqual([]);
  });
});
