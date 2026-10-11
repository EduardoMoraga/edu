import { describe, expect, it } from 'vitest';
import type { Note, NoteMeta } from '../core/contracts.js';
import { resolveReference } from './resolve.js';

const note = (meta: Partial<NoteMeta> & { id: string; title: string }, path = `/brain/3-transitive/${meta.id}.md`): Note => ({
  meta: { tier: 'transitive', kind: 'decision', tags: [], links: [], created: '2026-01-01T00:00:00.000Z', ...meta }, body: '', path,
});
const notes = [
  note({ id: 'D-002-usar-eventos', title: 'Usar eventos', legacy_id: 'D-002', aliases: ['D-002', 'D-002_usar-eventos'], origin: 'albert:3-TRANSITIVO/decisiones/D-002_usar-eventos.md' }),
  note({ id: 'D-0021-otra', title: 'Otra decisión' }),
  note({ id: 'D-010-colas', title: 'Colas' }),
  note({ id: 'D-011-cache', title: 'Caché distribuida' }),
  note({ id: 'L-medir', title: 'Medir antes' }),
  note({ id: 'L-medir-otra-vez', title: 'Medir antes' }),
  note({ id: 'K-glosario', title: 'Glosario', tier: 'canonical', kind: 'lexicon' }, '/brain/1-canonical/lexicon/glosario.md'),
];

describe('resolveReference', () => {
  it('resolves exact id first', () => {
    expect(resolveReference(notes, 'L-medir')).toMatchObject({ via: 'id', note: { meta: { id: 'L-medir' } } });
  });
  it('resolves a legacy id or alias, case-insensitively', () => {
    expect(resolveReference(notes, 'd-002')).toMatchObject({ via: 'alias', note: { meta: { id: 'D-002-usar-eventos' } } });
    expect(resolveReference(notes, 'D-002_usar-eventos')).toMatchObject({ via: 'alias' });
  });
  it('resolves a unique id prefix, preferring a whole correlative over a longer number', () => {
    expect(resolveReference(notes, 'D-010')).toMatchObject({ via: 'prefix', note: { meta: { id: 'D-010-colas' } } });
    expect(resolveReference(notes, 'D-0021')).toMatchObject({ via: 'prefix', note: { meta: { id: 'D-0021-otra' } } });
  });
  it('returns candidates instead of guessing when a prefix is ambiguous', () => {
    const result = resolveReference(notes, 'D-01');
    expect(result && 'candidates' in result ? result.candidates.map(n => n.meta.id).sort() : result).toEqual(['D-010-colas', 'D-011-cache']);
  });
  it('resolves a filename stem, including the original Albert file name', () => {
    expect(resolveReference(notes, 'glosario')).toMatchObject({ via: 'stem', note: { meta: { id: 'K-glosario' } } });
  });
  it('resolves an exact title ignoring case and accents', () => {
    expect(resolveReference(notes, 'cache DISTRIBUIDA')).toMatchObject({ via: 'title', note: { meta: { id: 'D-011-cache' } } });
    const twins = resolveReference(notes, 'medir antes');
    expect(twins && 'candidates' in twins ? twins.candidates.map(n => n.meta.id).sort() : twins).toEqual(['L-medir', 'L-medir-otra-vez']);
  });
  it('returns undefined when nothing matches', () => {
    expect(resolveReference(notes, 'nada')).toBeUndefined();
  });
});
