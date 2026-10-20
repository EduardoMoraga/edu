import type { FailureType, HarnessLevel, OutcomeLabel } from '../core/contracts.js';

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
  resources?: ResourceMetrics;
}

export interface ResourceMetrics {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  costUsd: number | null;
  elapsedMs: number | null;
  models: string[];
}
const resourceKeys = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'costUsd', 'elapsedMs'] as const;

/** Null means missing or partial observations, never a guessed zero. */
export function sumResources(rows: Array<ResourceMetrics | undefined>): ResourceMetrics {
  const result = { models: [...new Set(rows.flatMap(row => row?.models ?? []))] } as ResourceMetrics;
  for (const key of resourceKeys) result[key] = rows.length && rows.every(row => typeof row?.[key] === 'number' && Number.isFinite(row[key]) && row[key]! >= 0)
    ? rows.reduce((sum, row) => sum + row![key]!, 0) : null;
  return result;
}

export interface MetricGroup {
  group: { cli?: string; role?: string; level?: HarnessLevel; window?: string };
  count: number;
  avsr: number;
  /** Legacy alias: fraction of episodes with an avoidable intervention, not human time. */
  mhir: number;
  /** Legacy alias: deterministic-event share, including failed checks; not verified success. */
  verificationAutonomy: number;
  /** Recovered calls / all tool calls, not recoveries / recoverable failures. */
  toolRecoveryRate: number;
  /** Required attribution fields present; does not establish causal correctness. */
  attributionCompleteness: number;
  /** Legacy alias: mean episode maximum severity, not a baseline delta. */
  entropyDelta: number;
  /** Legacy fields above are descriptive proxies, not causal efficiency measures. */
  deterministicVerificationShare: number;
  avoidableInterventionEpisodeRate: number;
  meanMaxEntropySeverity: number;
  resources: ResourceMetrics;
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
      deterministicVerificationShare: verificationRows.length ? verificationRows.filter(event => event.kind === 'deterministic').length / verificationRows.length : 0,
      avoidableInterventionEpisodeRate: rows.filter(episode => episode.interventions.some(event => event.avoidable === true)).length / rows.length,
      meanMaxEntropySeverity: rows.reduce((sum, episode) => sum + episode.entropySeverity, 0) / rows.length,
      resources: sumResources(rows.map(row => row.resources)),
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
