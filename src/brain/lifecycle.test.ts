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
