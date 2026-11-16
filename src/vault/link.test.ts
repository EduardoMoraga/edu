import { describe, expect, it } from 'vitest';
import { resolve, sep } from 'node:path';
import type { BrainLocation } from '../core/contracts.js';
import { linkName, linkPath } from './link.js';

describe('brain vault link path safety', () => {
  it('keeps generated link names to one basename segment beneath the selected vault', () => {
    const location: BrainLocation = { scope: 'project', root: '/tmp/attacker/../../outside/.edu' };
    const vault = '/tmp/vault';
    const path = linkPath(vault, location);
    expect(linkName(location)).toBe('outside');
    expect(path).toBe(resolve(vault, 'Edu', 'outside'));
    expect(path.startsWith(`${resolve(vault)}${sep}Edu${sep}`)).toBe(true);
  });
});
