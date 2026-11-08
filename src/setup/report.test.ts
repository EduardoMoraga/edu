import { describe, expect, it } from 'vitest';
import { formatHostTable, hostRows } from './report.js';

describe('setup host report', () => {
  it('reports method, MCP, brief mode and restart for every host', () => {
    const rows = hostRows({ installed: ['claude', 'codex', 'pi', 'agy'], fallback: ['opencode'], alreadyInstalled: [], failed: [] },
      ['claude', 'codex', 'pi', 'opencode', 'agy'], { eduOnPath: true });
    expect(rows.map(r => [r.host, r.method, r.mcp, r.brief, r.restart])).toEqual([
      ['claude', 'plugin', 'ok', 'hook', true],
      ['codex', 'plugin', 'ok', 'hook', true],
      ['pi', 'plugin', 'ok', 'hook', true],
      ['opencode', 'adapter', 'ok', 'hook', true],
      ['agy', 'plugin', 'ok', 'hook', true],
    ]);
    expect(rows.find(r => r.host === 'codex')?.via).toMatch(/trust/i);
  });

  it('falls back to instructions when a native installer failed, and flags manual MCP for agy', () => {
    const rows = hostRows({ installed: [], fallback: ['codex', 'pi', 'agy'], alreadyInstalled: ['claude'], failed: [{ cli: 'agy', message: 'boom' }] },
      ['claude', 'codex', 'pi', 'agy'], { eduOnPath: true });
    expect(rows.map(r => [r.host, r.method, r.mcp, r.brief, r.restart])).toEqual([
      ['claude', 'plugin', 'ok', 'hook', false],
      ['codex', 'adapter', 'ok', 'instructions', true],
      ['pi', 'adapter', 'ok', 'instructions', true],
      ['agy', 'adapter', 'manual', 'instructions', true],
    ]);
    expect(rows.find(r => r.host === 'agy')?.note).toContain('native installer failed');
  });

  it('marks MCP unusable when edu is not on PATH and restarts every host after an upgrade', () => {
    const rows = hostRows({ installed: [], fallback: [], alreadyInstalled: ['claude'], failed: [], upgraded: true }, ['claude'], { eduOnPath: false });
    expect(rows[0]).toMatchObject({ mcp: 'edu-missing', restart: true });
  });

  it('formats an aligned table in English and Spanish', () => {
    const rows = hostRows({ installed: ['claude'], fallback: ['opencode'], alreadyInstalled: [], failed: [] }, ['claude', 'opencode'], { eduOnPath: true });
    const en = formatHostTable(rows, 'en');
    expect(en[0]).toMatch(/^host\s+method\s+MCP\s+brief\s+restart/);
    expect(en[1]).toMatch(/^claude\s+plugin\s+ok\s+hook\s+yes/);
    expect(en[2]!.indexOf('ok')).toBe(en[0]!.indexOf('MCP'));
    expect(formatHostTable(rows, 'es')[0]).toMatch(/^host\s+método\s+MCP\s+brief\s+reiniciar/);
  });
});
