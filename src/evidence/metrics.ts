import type { FailureType, HarnessLevel, OutcomeLabel } from './contracts.js';

export interface EpisodeSummary {
  runId: string;
  cli?: string;
  role?: string;
  level?: HarnessLevel;
  startedAt: string;
  outcome: OutcomeLabel;
  interventions: Array<{ avoidable?: boolean; harnessGap?: FailureType }>;
  verifications: Array<{ kind?: string; ok?: boolean }>;
  toolCalls: number;
  recoveredTools: number;
  attributions: Array<{ observed?: string; expected?: string; failureType?: string; evidence?: string[]; alternatives?: string[]; next?: string }>;
  entropySeverity: number;
}

export interface MetricGroup {
  group: { cli?: string; role?: string; level?: HarnessLevel; window?: string };
  count: number;
  avsr: number;
  mhir: number;
  verificationAutonomy: number;
  toolRecoveryRate: number;
  attributionCompleteness: number;
  entropyDelta: number;
  byHarnessGap: Record<string, number>;
}

export interface MetricsWindow { since?: string; until?: string; window?: 'day' | 'week' | 'month' }

/** Computes rates for every observed CLI/role/level combination in a time window. */
export function aggregateMetrics(episodes: EpisodeSummary[], options: MetricsWindow = {}): MetricGroup[] {
  const selected = episodes.filter((episode) => {
    const time = Date.parse(episode.startedAt);
    return (!options.since || time >= Date.parse(options.since)) && (!options.until || time <= Date.parse(options.until));
  });
  const groups = new Map<string, EpisodeSummary[]>();
  for (const episode of selected) {
    const key = JSON.stringify({ cli: episode.cli, role: episode.role, level: episode.level, window: timeWindow(episode.startedAt, options.window) });
    groups.set(key, [...(groups.get(key) ?? []), episode]);
  }
  return [...groups.entries()].map(([key, rows]) => {
    const autonomous = rows.filter((episode) => episode.outcome === 'autonomous_verified_success').length;
    const verificationRows = rows.flatMap((episode) => episode.verifications);
    const toolCount = rows.reduce((sum, episode) => sum + episode.toolCalls, 0);
    const attributionRows = rows.flatMap((episode) => episode.attributions);
    const completeAttributions = attributionRows.filter((event) => Boolean(event.observed && event.expected && event.failureType && event.next && event.evidence?.length && event.alternatives?.length)).length;
    const byHarnessGap: Record<string, number> = {};
    for (const episode of rows) for (const intervention of episode.interventions) {
      if (intervention.avoidable && intervention.harnessGap) byHarnessGap[intervention.harnessGap] = (byHarnessGap[intervention.harnessGap] ?? 0) + 1;
    }
    const group = JSON.parse(key) as MetricGroup['group'];
    return {
      group,
      count: rows.length,
      avsr: autonomous / rows.length,
      mhir: rows.filter((episode) => episode.interventions.some((event) => event.avoidable)).length / rows.length,
      verificationAutonomy: verificationRows.length ? verificationRows.filter((event) => event.kind === 'deterministic').length / verificationRows.length : 0,
      toolRecoveryRate: toolCount ? rows.reduce((sum, episode) => sum + episode.recoveredTools, 0) / toolCount : 0,
      attributionCompleteness: attributionRows.length ? completeAttributions / attributionRows.length : 0,
      entropyDelta: rows.reduce((sum, episode) => sum + episode.entropySeverity, 0) / rows.length,
      byHarnessGap,
    };
  });
}

function timeWindow(value: string, unit: MetricsWindow['window']): string | undefined {
  if (!unit) return undefined;
  const date = new Date(value);
  if (unit === 'day') return date.toISOString().slice(0, 10);
  if (unit === 'month') return date.toISOString().slice(0, 7);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}
