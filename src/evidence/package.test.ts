import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildEpisodePackage, type EvidenceEvent } from './package.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('episode package', () => {
  it('writes the complete event package and requirement report', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-evidence-package-'));
    roots.push(root);
    const events: EvidenceEvent[] = [
      { type: 'run.start', runId: 'run-1', goal: 'fix bug', mode: 'solo', at: '2026-01-01T00:00:00Z' },
      { type: 'task.define', requirements: [{ id: 'r1', text: 'returns value' }], at: '2026-01-01T00:00:01Z' },
      { type: 'tool.call', agentId: 'builder', callId: 'c1', tool: 'shell', input: 'npm test', at: '2026-01-01T00:00:02Z' },
      { type: 'verify.result', method: 'unit', requirementIds: ['r1'], ok: true, output: '1 passed', kind: 'deterministic', at: '2026-01-01T00:00:03Z' },
      { type: 'outcome', label: 'autonomous_verified_success', metrics: {}, at: '2026-01-01T00:00:04Z' },
    ];
    const dir = await buildEpisodePackage(root, 'run-1', events);
    for (const file of ['task.json', 'action.jsonl', 'tool.jsonl', 'context.jsonl', 'verification.jsonl', 'attribution.jsonl', 'intervention.jsonl', 'entropy.json', 'outcome.json', 'report.md']) {
      await expect(readFile(join(dir, file), 'utf8')).resolves.toBeDefined();
    }
    const report = await readFile(join(dir, 'report.md'), 'utf8');
    expect(report).toContain('r1');
    expect(report).toContain('1 passed');
    expect(report).toContain('verified');
  });

  it('reports the latest non-reproduction verification instead of any historical pass', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-evidence-package-latest-'));
    roots.push(root);
    const events: EvidenceEvent[] = [
      { type: 'task.define', requirements: [{ id: 'r1', text: 'returns value' }], at: '2026-01-01T00:00:00Z' },
      { type: 'verify.result', checkId: 'unit', requirementIds: ['r1'], ok: true, output: 'reproduced', kind: 'reproduction', at: '2026-01-01T00:00:01Z' },
      { type: 'verify.result', checkId: 'unit', requirementIds: ['r1'], ok: true, output: 'passed', kind: 'deterministic', at: '2026-01-01T00:00:02Z' },
      { type: 'verify.result', checkId: 'unit', requirementIds: ['r1'], ok: false, output: 'exit 1', kind: 'deterministic', at: '2026-01-01T00:00:03Z' },
    ];
    const dir = await buildEpisodePackage(root, 'run-latest', events);
    const report = await readFile(join(dir, 'report.md'), 'utf8');
    expect(report).toContain('exit 1');
    expect(report).toContain('failed');
    expect(report).not.toContain('| r1 | reproduced | verified |');
  });
});
