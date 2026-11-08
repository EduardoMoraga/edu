import { describe, expect, it } from 'vitest';
import { commonPrefixLength, runContextBench } from './context.js';

describe('context bench', () => {
  it('measures the common prefix in code units', () => {
    expect(commonPrefixLength('abcdef', 'abcxyz')).toBe(3);
    expect(commonPrefixLength('same', 'same')).toBe(4);
    expect(commonPrefixLength('', 'x')).toBe(0);
  });

  it('measures brief, stability and MCP tool cost deterministically', async () => {
    const [a, b] = await Promise.all([runContextBench(), runContextBench()]);
    const stable = (r: typeof a) => ({ ...r, stability: { ...r.stability, firstDifference: null } });
    expect(stable(a)).toEqual(stable(b));
    expect(a.brief.tokens).toBeGreaterThan(0);
    expect(a.brief.tokens).toBeLessThanOrEqual(a.brief.budgetTokens);
    // The hook appends the host session line to the brief.
    expect(a.brief.hookTokens).toBeGreaterThan(a.brief.tokens);
    expect(a.stability.commonPrefixTokens).toBeLessThanOrEqual(a.stability.secondTokens);
    expect(a.mcp.full.tools).toBeGreaterThan(a.mcp.memory.tools);
    expect(a.mcp.full.tokens).toBeGreaterThan(a.mcp.memory.tokens);
    expect(a.mcp.full.perTool.map(t => t.name)).toContain('edu_recall');
  }, 30_000);
});
