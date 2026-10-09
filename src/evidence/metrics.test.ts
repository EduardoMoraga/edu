import { describe, expect, it } from 'vitest';
import { aggregateMetrics, type EpisodeSummary } from './metrics.js';

describe('episode metrics', () => {
  it('aggregates rates by CLI, role, harness level, and time window', () => {
    const episodes: EpisodeSummary[] = [
      { runId: '1', cli: 'codex', role: 'builder', level: 'H3', startedAt: '2026-01-10T00:00:00Z', outcome: 'autonomous_verified_success', interventions: [], verifications: [{ kind: 'deterministic', ok: true }], toolCalls: 1, recoveredTools: 1, attributions: [{ observed: 'x', expected: 'y', failureType: 'verify', evidence: ['log'], alternatives: ['z'], next: 'fix' }], entropySeverity: 0 },
      { runId: '2', cli: 'codex', role: 'builder', level: 'H3', startedAt: '2026-01-11T00:00:00Z', outcome: 'assisted_verified_success', interventions: [{ avoidable: true }], verifications: [{ kind: 'review', ok: true }], toolCalls: 1, recoveredTools: 0, attributions: [{}], entropySeverity: 2 },
    ];
    const results = aggregateMetrics(episodes, { since: '2026-01-01T00:00:00Z', until: '2026-01-31T00:00:00Z' });
    const group = results.find((item) => item.group.cli === 'codex' && item.group.role === 'builder' && item.group.level === 'H3');
    expect(group).toMatchObject({ count: 2, avsr: 0.5, mhir: 0.5, verificationAutonomy: 0.5, toolRecoveryRate: 0.5, attributionCompleteness: 0.5, entropyDelta: 1 });
  });
});
