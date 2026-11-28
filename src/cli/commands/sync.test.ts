import { describe, expect, it } from 'vitest';
import { parseMinutes } from './sync.js';

describe('edu sync schedule interval', () => {
  it('defaults personal to 5 minutes and cheil to 15 when --minutes is omitted', () => {
    expect(parseMinutes(undefined, 'personal')).toBe(5);
    expect(parseMinutes(undefined)).toBe(5);
    expect(parseMinutes(undefined, 'cheil')).toBe(15);
    expect(parseMinutes('15', 'personal')).toBe(15);
    expect(parseMinutes('5', 'cheil')).toBe(5);
  });

  it('rejects a blank or fractional interval', () => {
    expect(() => parseMinutes('0', 'cheil')).toThrow(/--minutes/);
    expect(() => parseMinutes('1.5')).toThrow(/--minutes/);
  });
});
