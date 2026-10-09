import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EduEvent } from '../core/contracts.js';
import type { FailureType, OutcomeLabel, Requirement } from './contracts.js';

export type EvidenceEvent = EduEvent | EvidenceOnlyEvent;
export type EvidenceOnlyEvent =
  | { type: 'task.define'; requirements: Requirement[]; successCriteria?: string[]; at: string }
  | { type: 'context.trace'; noteId: string; contribution: string; influenced: boolean; at: string }
  | { type: 'verify.result'; checkId?: string; method?: string; requirementIds: string[]; ok: boolean; output: string; exitCode?: number | null; durationMs?: number; timedOut?: boolean; kind: 'reproduction' | 'deterministic' | 'targeted-test' | 'regression' | 'lint' | 'review'; at: string }
  | { type: 'failure.attribution'; observed: string; expected: string; failureType: FailureType; evidence: string[]; alternatives: string[]; next: string; at: string }
  | { type: 'intervention'; by: 'user'; action: string; detail?: string; avoidable: boolean; harnessGap: FailureType; at: string }
  | { type: 'entropy.finding'; category: string; severity: 0 | 1 | 2 | 3; path: string; detail: string; at: string }
  | { type: 'outcome'; label: OutcomeLabel; metrics: Record<string, unknown>; at: string };

export interface PackageOptions {
  limitations?: string[];
  entropyFindings?: Array<{ category: string; severity: 0 | 1 | 2 | 3; path: string; detail: string }>;
}

const types = (events: EvidenceEvent[], ...names: string[]) => events.filter((event) => names.includes(event.type));
const jsonl = (events: EvidenceEvent[]) => events.length ? `${events.map((event) => JSON.stringify(event)).join('\n')}\n` : '';

/** Materializes the normalized event stream as a portable, inspectable episode. */
export async function buildEpisodePackage(root: string, runId: string, events: EvidenceEvent[], options: PackageOptions = {}): Promise<string> {
  const directory = join(root, 'runs', runId);
  await mkdir(directory, { recursive: true });
  const taskEvent = events.find((event) => event.type === 'task.define');
  const runEvent = events.find((event) => event.type === 'run.start');
  const outcomeEvent = [...events].reverse().find((event) => event.type === 'outcome');
  const task = {
    runId,
    ...(runEvent?.type === 'run.start' ? { goal: runEvent.goal, mode: runEvent.mode, startedAt: runEvent.at } : {}),
    ...(taskEvent?.type === 'task.define' ? { requirements: taskEvent.requirements, successCriteria: taskEvent.successCriteria ?? [] } : { requirements: [] }),
    limitations: options.limitations ?? [],
  };
  const outcome = outcomeEvent?.type === 'outcome'
    ? outcomeEvent
    : events.find((event) => event.type === 'run.end') ?? { label: 'unverified_success', metrics: {} };
  const entropyEvents = types(events, 'entropy.finding');
  const entropy = { findings: [...entropyEvents, ...(options.entropyFindings ?? []).map((finding) => ({ type: 'entropy.finding', ...finding }))] };
  const content: Record<string, string> = {
    'task.json': `${JSON.stringify(task, null, 2)}\n`,
    'action.jsonl': jsonl(events),
    'tool.jsonl': jsonl(types(events, 'tool.call', 'tool.result')),
    'context.jsonl': jsonl(types(events, 'context.trace', 'brain.recall', 'brain.learn')),
    'verification.jsonl': jsonl(types(events, 'verify.result')),
    'attribution.jsonl': jsonl(types(events, 'failure.attribution')),
    'intervention.jsonl': jsonl(types(events, 'intervention', 'approval.resolve')),
    'entropy.json': `${JSON.stringify(entropy, null, 2)}\n`,
    'outcome.json': `${JSON.stringify(outcome, null, 2)}\n`,
    'report.md': makeReport(task.requirements, types(events, 'verify.result'), task.limitations),
  };
  await Promise.all(Object.entries(content).map(([name, body]) => writeFile(join(directory, name), body, 'utf8')));
  return directory;
}

function makeReport(requirements: Requirement[], verification: EvidenceEvent[], limitations: string[]): string {
  const lines = ['# Verification report', '', '| Requirement | Evidence | Status |', '|---|---|---|'];
  for (const requirement of requirements) {
    const evidence = verification.filter((event) => event.type === 'verify.result' && event.kind !== 'reproduction' && event.requirementIds.includes(requirement.id));
    const latest = evidence.at(-1);
    const status = latest?.type === 'verify.result' ? latest.ok ? 'verified' : 'failed' : 'unverified';
    const descriptions = evidence.map((event) => event.type === 'verify.result' ? `${event.kind}: ${event.output.replaceAll('|', '\\|').replaceAll('\n', ' ')}` : '').join('<br>') || 'No evidence recorded';
    lines.push(`| ${requirement.id}: ${requirement.text.replaceAll('|', '\\|')} | ${descriptions} | ${status} |`);
  }
  lines.push('', '## Limitations', '');
  lines.push(...(limitations.length ? limitations.map((limitation) => `- ${limitation}`) : ['- None recorded.']));
  return `${lines.join('\n')}\n`;
}
