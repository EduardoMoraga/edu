import { describe, expect, it } from 'vitest';
import {
  displayWidth,
  formatCost,
  formatDuration,
  formatPercent,
  formatTokens,
  padEndDisplay,
  truncate,
} from './format.js';

describe('formatTokens', () => {
  it('keeps small counts exact', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(950)).toBe('950');
  });
  it('uses one decimal k and drops trailing .0', () => {
    expect(formatTokens(38_100)).toBe('38.1k');
    expect(formatTokens(1_000)).toBe('1k');
    expect(formatTokens(9_549)).toBe('9.5k');
    expect(formatTokens(999_960)).toBe('1M');
  });
  it('uses M for millions', () => {
    expect(formatTokens(1_250_000)).toBe('1.3M');
    expect(formatTokens(12_000_000)).toBe('12M');
  });
  it('guards invalid input', () => {
    expect(formatTokens(-5)).toBe('0');
    expect(formatTokens(Number.NaN)).toBe('0');
  });
});

describe('formatCost', () => {
  it('formats dollars with cents', () => {
    expect(formatCost(0.42)).toBe('$0.42');
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(12.5)).toBe('$12.50');
  });
  it('flags sub-cent amounts instead of rounding to zero', () => {
    expect(formatCost(0.004)).toBe('<$0.01');
  });
  it('drops cents from large amounts', () => {
    expect(formatCost(123.4)).toBe('$123');
  });
  it('never invents a cost when unknown', () => {
    expect(formatCost(undefined)).toBe('$—');
  });
});

describe('formatDuration', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(41_000)).toBe('41s');
    expect(formatDuration(134_000)).toBe('2m14s');
    expect(formatDuration(120_000)).toBe('2m00s');
    expect(formatDuration(3_725_000)).toBe('1h02m');
  });
  it('floors partial seconds and clamps negatives', () => {
    expect(formatDuration(1_999)).toBe('1s');
    expect(formatDuration(-10)).toBe('0s');
  });
});

describe('formatPercent', () => {
  it('rounds to an integer percent', () => {
    expect(formatPercent(0.414)).toBe('41%');
    expect(formatPercent(1)).toBe('100%');
  });
});

describe('display width helpers', () => {
  it('counts wide emoji as two cells and combining marks as zero', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('🔍')).toBe(2);
    expect(displayWidth('◆')).toBe(1);
    expect(displayWidth('⚙️')).toBe(2);
  });
  it('pads by display width', () => {
    expect(padEndDisplay('🔍', 4)).toBe('🔍  ');
    expect(padEndDisplay('abcdef', 3)).toBe('abcdef');
  });
  it('truncates with an ellipsis within the width', () => {
    expect(truncate('hello world', 8)).toBe('hello w…');
    expect(truncate('hello', 8)).toBe('hello');
    expect(truncate('hello world', 8, '...')).toBe('hello...');
    expect(truncate('abc', 0)).toBe('');
  });
});
