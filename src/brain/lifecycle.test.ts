import { describe, expect, it } from 'vitest';
import { validateStatus, validateTransition } from './lifecycle.js';

describe('lifecycle', () => {
  it('accepts declared statuses and rejects illegal transitions', () => {
    expect(() => validateStatus('hypothesis', 'confirmed')).not.toThrow();
    expect(() => validateStatus('hypothesis', 'delivered')).toThrow();
    expect(() => validateTransition('hypothesis', 'open', 'confirmed')).not.toThrow();
    expect(() => validateTransition('hypothesis', 'confirmed', 'open')).toThrow();
  });
});

describe('legacy reverted decisions', () => {
  it('reads the 4.x forward pointer as superseded_by, never as supersedes', async () => {
    const { normalizeLegacyMeta } = await import('./store.js');
    const legacy = { id: 'D-old', tier: 'transitive', title: 'Old', kind: 'decision', status: 'reverted', supersedes: 'D-new', tags: [], links: [], created: '2026-01-01' } as const;
    const read = normalizeLegacyMeta({ ...legacy, tags: [], links: [] });
    expect(read.superseded_by).toBe('D-new');
    expect(read.supersedes).toBeUndefined();
    // An active decision that supersedes another keeps its pointer.
    const active = normalizeLegacyMeta({ ...legacy, status: 'active', tags: [], links: [] });
    expect(active.supersedes).toBe('D-new');
  });
});
