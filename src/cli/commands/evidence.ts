/** `edu metrics` and deterministic harness check registry commands. */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from 'commander';
import type { HarnessLevel, OutcomeLabel } from '../../core/contracts.js';
import { aggregateMetrics, type EpisodeSummary } from '../../evidence/metrics.js';
import { loadChecks, runCheck, saveChecks } from '../../evidence/registry.js';
import type { CliContext } from '../context.js';
import { action, printJson } from '../kit.js';
import { openWorkspace } from '../workspace.js';

interface MetricsOptions { since?: string; by?: string; json?: boolean }
interface AddCheckOptions { id?: string; req?: string; cmd?: string; expectStdout?: string; expectExit?: string; timeout?: string; json?: boolean }

export function registerEvidence(program: Command, ctx: CliContext): void {
  program.command('metrics')
    .description('summarize evidence from recent episode packages')
    .option('--since <window>', 'time window, e.g. 30d or an ISO timestamp', '30d')
    .option('--by <dimension>', 'group by cli, role, or level', 'cli')
    .option('--json', 'machine-readable output')
    .action(action<MetricsOptions>(ctx, async ({ g, opts }) => {
      const by = oneOf(opts.by ?? 'cli', ['cli', 'role', 'level'] as const, '--by');
      const since = parseSince(opts.since ?? '30d');
      const ws = await openWorkspace(ctx, g.cwd);
      const episodes = await readEpisodes(join(ws.primary.root, 'runs'));
      const projected = episodes.map(episode => ({ ...episode, cli: by === 'cli' ? episode.cli : undefined, role: by === 'role' ? episode.role : undefined, level: by === 'level' ? episode.level : undefined }));
      const rows = aggregateMetrics(projected, { since }).map(group => ({
        group: group.group[by], avsr: group.avsr, mhir: group.mhir, verificationAutonomy: group.verificationAutonomy,
        toolRecoveryRate: group.toolRecoveryRate, attributionCompleteness: group.attributionCompleteness,
        entropyDelta: group.entropyDelta, n: group.count,
      }));
      if (opts.json || g.json) return printJson(ctx, rows);
      ctx.out(`${by.padEnd(8)} AVSR   M-HIR  verify-auto  tool-recovery  attribution  entropy  n`);
      for (const row of rows) ctx.out(`${String(row.group ?? 'unknown').padEnd(8)} ${pct(row.avsr)} ${pct(row.mhir)} ${pct(row.verificationAutonomy)} ${pct(row.toolRecoveryRate)} ${pct(row.attributionCompleteness)} ${row.entropyDelta.toFixed(2).padStart(7)} ${row.n}`);
      if (!rows.length) ctx.out('No episode packages in this window.');
    }));

  const checks = program.command('checks').description('manage deterministic checks under .edu/harness/checks.json');
  checks.command('list').description('list registered deterministic checks').option('--json', 'machine-readable output')
    .action(action<{ json?: boolean }>(ctx, async ({ g, opts }) => {
      const items = await loadChecks(g.cwd);
      if (opts.json || g.json) return printJson(ctx, items);
      if (!items.length) return ctx.out('No deterministic checks registered.');
      for (const item of items) ctx.out(`${item.id}  [${item.requirementIds.join(', ')}]  ${item.command}`);
    }));

  checks.command('add').description('register a deterministic shell check')
    .requiredOption('--id <id>', 'unique check id')
    .requiredOption('--req <ids>', 'comma-separated requirement ids')
    .requiredOption('--cmd <command>', 'shell command to run')
    .option('--expect-stdout <text>', 'required stdout substring')
    .option('--expect-exit <code>', 'expected exit code', '0')
    .option('--timeout <ms>', 'timeout in milliseconds', '30000')
    .option('--json', 'machine-readable output')
    .action(action<AddCheckOptions>(ctx, async ({ g, opts }) => {
      const id = opts.id?.trim() ?? '';
      const requirementIds = (opts.req ?? '').split(',').map(value => value.trim()).filter(Boolean);
      const command = opts.cmd?.trim() ?? '';
      if (!id || !requirementIds.length || !command) throw new Error('--id, --req, and --cmd must not be empty');
      const exitCode = integer(opts.expectExit ?? '0', '--expect-exit', 0);
      const timeoutMs = integer(opts.timeout ?? '30000', '--timeout', 1);
      const current = await loadChecks(g.cwd);
      if (current.some(item => item.id === id)) throw new Error(`A check with id "${id}" already exists`);
      const item = { id, requirementIds, command, expect: { exitCode, ...(opts.expectStdout !== undefined ? { stdoutIncludes: opts.expectStdout } : {}) }, timeoutMs };
      await saveChecks(g.cwd, [...current, item]);
      if (opts.json || g.json) return printJson(ctx, item);
      ctx.out(`Added check ${id}.`);
    }));

  checks.command('run').description('run every registered deterministic check').option('--json', 'machine-readable output')
    .action(action<{ json?: boolean }>(ctx, async ({ g, opts }) => {
      const items = await loadChecks(g.cwd);
      const results = await Promise.all(items.map(item => runCheck(item, g.cwd)));
      if (opts.json || g.json) printJson(ctx, results);
      else {
        for (const result of results) ctx.out(`${result.ok ? '✓' : '✗'} ${result.checkId}: ${result.output.replace(/\s+/g, ' ').trim()}`);
        if (!results.length) ctx.out('No deterministic checks registered.');
      }
      if (results.some(result => !result.ok)) ctx.setExitCode(1);
    }));
}

async function readEpisodes(root: string): Promise<EpisodeSummary[]> {
  let entries: import('node:fs').Dirent[];
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const summaries: EpisodeSummary[] = [];
  for (const item of entries.filter(value => value.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const entry = item.name;
    const dir = join(root, entry);
    const [task, outcome, interventions, verifications, attributions, tools, entropy] = await Promise.all([
      json(join(dir, 'task.json')), json(join(dir, 'outcome.json')), jsonl(join(dir, 'intervention.jsonl')),
      jsonl(join(dir, 'verification.jsonl')), jsonl(join(dir, 'attribution.jsonl')), jsonl(join(dir, 'tool.jsonl')), json(join(dir, 'entropy.json')),
    ]);
    const metrics = object(outcome.metrics);
    const start = (await jsonl(join(dir, 'action.jsonl'))).find(event => event.type === 'run.start');
    if (!start) continue;
    const label = outcome.label as OutcomeLabel;
    if (!['autonomous_verified_success', 'assisted_verified_success', 'unverified_success', 'failed', 'unsafe_invalid'].includes(label)) continue;
    const level = metrics.harnessLevel as HarnessLevel | undefined;
    const toolCalls = tools.filter(event => event.type === 'tool.call');
    const recoveredTools = countRecoveredTools(tools);
    const findings = Array.isArray(entropy.findings) ? entropy.findings : [];
    summaries.push({
      runId: typeof task.runId === 'string' ? task.runId : entry,
      ...(typeof metrics.cli === 'string' ? { cli: metrics.cli } : {}), ...(typeof metrics.role === 'string' ? { role: metrics.role } : {}),
      ...(level ? { level } : {}), startedAt: String(start.at ?? ''), outcome: label,
      interventions: interventions.filter(event => event.type === 'intervention') as EpisodeSummary['interventions'],
      verifications: verifications as EpisodeSummary['verifications'], toolCalls: toolCalls.length, recoveredTools,
      attributions: attributions as EpisodeSummary['attributions'],
      entropySeverity: findings.reduce((max, finding) => Math.max(max, Number(object(finding).severity) || 0), 0),
    });
  }
  return summaries;
}

function countRecoveredTools(events: Array<Record<string, unknown>>): number {
  const calls = new Map<string, string>();
  const failed = new Set<string>();
  let recovered = 0;
  for (const event of events) {
    if (event.type === 'tool.call') {
      const key = JSON.stringify([event.agentId, event.tool, event.input]);
      calls.set(String(event.callId), key);
    } else if (event.type === 'tool.result') {
      const key = calls.get(String(event.callId));
      if (!key) continue;
      if (event.ok === false) failed.add(key);
      else if (event.ok === true && failed.has(key)) {
        recovered++;
        failed.delete(key);
      }
    }
  }
  return recovered;
}

async function json(path: string): Promise<Record<string, unknown>> {
  try { return object(JSON.parse(await readFile(path, 'utf8'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
}
async function jsonl(path: string): Promise<Array<Record<string, unknown>>> {
  try {
    return (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean).map(line => object(JSON.parse(line)));
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function oneOf<T extends string>(value: string, choices: readonly T[], flag: string): T {
  if (!(choices as readonly string[]).includes(value)) throw new Error(`${flag} must be one of ${choices.join(', ')}`);
  return value as T;
}
function integer(value: string, flag: string, minimum: number): number {
  if (!/^\d+$/.test(value) || Number(value) < minimum || !Number.isSafeInteger(Number(value))) throw new Error(`${flag} must be an integer >= ${minimum}`);
  return Number(value);
}
function parseSince(value: string): string {
  const relative = /^(\d+)([dhw])$/.exec(value);
  if (relative) {
    const units: Record<string, number> = { d: 86_400_000, h: 3_600_000, w: 604_800_000 };
    const time = Date.now() - Number(relative[1]) * units[relative[2]!]!;
    return new Date(time).toISOString();
  }
  const time = Date.parse(value);
  if (Number.isNaN(time)) throw new Error('--since must be a duration such as 30d or a valid date');
  return new Date(time).toISOString();
}
function pct(value: number): string { return `${(value * 100).toFixed(0)}%`.padStart(6); }
