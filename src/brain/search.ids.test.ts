import { describe, expect, it } from 'vitest';
import type { Note } from '../core/contracts.js';
import { rankNotes } from './search.js';

const note = (id: string, title: string, body: string, extra: Record<string, unknown> = {}): Note => ({
  path: `/b/${id}.md`, body,
  meta: { id, tier: 'transitive', kind: 'decision', title, tags: [], links: [], created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z', source: 'test', ...extra },
} as Note);

describe('recall by id', () => {
  it('ranks the note an id, alias or legacy id names first, above notes that only mention it', () => {
    const named = note('D-010-nada-se-publica', 'Nada se publica', 'Files only', { aliases: ['D-010'], legacy_id: 'D-010' });
    const noisy = note('D-099-kpis', 'Specs 010 for Bolivia', 'd 010 d 010 d 010 D-010 D-010');
    for (const query of ['D-010', 'd-010', 'D-010-nada-se-publica']) {
      expect(rankNotes(query, [noisy, named])[0]?.note.meta.id).toBe('D-010-nada-se-publica');
    }
    expect(rankNotes('D-010', [noisy, named])[0]?.why).toContain('Named by');
  });
});
