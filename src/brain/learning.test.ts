import { describe, expect, it } from 'vitest';
import { learnedWeight, lessonStatus, overdueStatus } from './learning.js';
import { rankNotes } from './search.js';
import type { Note } from '../core/contracts.js';

const date = new Date('2026-01-01T00:00:00Z');
const note = (id: string, body: string, usage = { uses: 0, wins: 0, losses: 0, lastUsed: date.toISOString() }): Note => ({
  meta: { id, tier: 'transitive', title: 'Build a reliable system', kind: 'lesson', status: 'candidate', tags: ['architecture'], links: [], created: date.toISOString(), usage }, body, path: `/${id}.md`,
});

describe('brain learning', () => {
  it('applies a 45 day recency half-life with a 0.25 floor', () => {
    expect(learnedWeight({ uses: 1, wins: 1, losses: 1, lastUsed: date.toISOString() }, new Date(date.getTime() + 45 * 86400000))).toBeCloseTo(0.25);
    expect(learnedWeight({ uses: 0, wins: 0, losses: 0, lastUsed: date.toISOString() }, new Date(date.getTime() + 800 * 86400000))).toBe(0.25);
  });
  it('promotes proven lessons and retires stale ones', () => {
    expect(lessonStatus({ ...note('L-a', '').meta, usage: { uses: 4, wins: 3, losses: 0 } }, date)).toBe('proven');
    expect(lessonStatus({ ...note('L-b', '').meta, usage: { uses: 1, wins: 0, losses: 0, lastUsed: '2025-01-01T00:00:00Z' } }, date)).toBe('retired');
    expect(lessonStatus({ ...note('L-c', '').meta, status: 'retired', usage: { uses: 10, wins: 10, losses: 0 } }, date)).toBe('retired');
  });
  it('marks pending commitments overdue after the due date', () => {
    expect(overdueStatus({ ...note('C-a', '').meta, kind: 'commitment', status: 'pending', due: '2025-12-01' }, date)).toBe('overdue');
  });
  it('ranks a positively learned relevant note above an otherwise equal note', () => {
    const low = note('L-low', 'reliable architecture');
    const high = note('L-high', 'reliable architecture', { uses: 3, wins: 3, losses: 0, lastUsed: date.toISOString() });
    expect(rankNotes('reliable architecture', [low, high], date)[0]?.note.meta.id).toBe('L-high');
  });
});
