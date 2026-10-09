import { describe, expect, it } from 'vitest';
import { TIER_DIRS, TRANSITIVE_PREFIX } from './contracts.js';

describe('contracts', () => {
  it('maps tiers to sortable Obsidian folders', () => {
    expect(Object.values(TIER_DIRS)).toEqual(['1-canonical', '2-episodic', '3-transitive']);
  });
  it('uses unique transitive prefixes', () => {
    const p = Object.values(TRANSITIVE_PREFIX);
    expect(new Set(p).size).toBe(p.length);
  });
});
