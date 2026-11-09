/**
 * The per-host summary `edu setup` prints last: how Edu reached each host, whether its MCP server can
 * start, how the session brief arrives, and whether the host must be restarted to see the change.
 */
import type { CliId } from '../core/contracts.js';

export type HostMethod = 'plugin' | 'adapter';
/** `hook`: the host injects the brief at session start. `instructions`: the agent is told to call `edu_brief` once. */
export type BriefMode = 'hook' | 'instructions';
/** `ok`: registered and `edu` resolves. `manual`: the host has no file Edu can register MCP in. */
export type McpState = 'ok' | 'manual' | 'edu-missing';

export interface HostRow {
  host: CliId;
  method: HostMethod;
  mcp: McpState;
  brief: BriefMode;
  /** The mechanism behind `brief`, e.g. "SessionStart hook". */
  via: string;
  restart: boolean;
  note?: string;
}

export interface SetupOutcome {
  installed: CliId[];
  fallback: CliId[];
  alreadyInstalled: CliId[];
  failed: Array<{ cli: CliId; message: string }>;
  /** True when setup refreshed an existing installation (every host must restart to load it). */
  upgraded?: boolean;
}

/** Brief delivery per host and method, as verified against each host's installed version. */
const BRIEF: Record<CliId, Record<HostMethod, { brief: BriefMode; via: string }>> = {
  claude: { plugin: { brief: 'hook', via: 'SessionStart hook' }, adapter: { brief: 'hook', via: 'SessionStart hook (settings.json)' } },
  codex: { plugin: { brief: 'hook', via: 'SessionStart hook (trust it once in Codex)' }, adapter: { brief: 'instructions', via: 'AGENTS.md block' } },
  pi: { plugin: { brief: 'hook', via: 'Pi extension' }, adapter: { brief: 'instructions', via: 'AGENTS.md block' } },
  // OpenCode is always installed from managed files; its TUI plugin attaches the brief to each session.
  opencode: { plugin: { brief: 'hook', via: 'TUI plugin session instructions' }, adapter: { brief: 'hook', via: 'TUI plugin session instructions (AGENTS.md block in opencode run)' } },
  agy: { plugin: { brief: 'hook', via: 'SessionStart hook' }, adapter: { brief: 'instructions', via: 'GEMINI.md / AGENTS.md block' } },
};

export function hostRows(report: SetupOutcome, clis: CliId[], options: { eduOnPath: boolean }): HostRow[] {
  return [...new Set(clis)].map((host) => {
    const method: HostMethod = report.fallback.includes(host) ? 'adapter' : 'plugin';
    const failure = report.failed.find(f => f.cli === host);
    const mcp: McpState = !options.eduOnPath ? 'edu-missing' : host === 'agy' && method === 'adapter' ? 'manual' : 'ok';
    const changed = report.installed.includes(host) || report.fallback.includes(host);
    return {
      host, method, mcp, ...BRIEF[host][method],
      restart: Boolean(report.upgraded) || changed,
      ...(failure ? { note: `native installer failed: ${failure.message.split('\n').slice(-2).join(' ').slice(0, 200)}` } : {}),
    };
  });
}

const HEADERS = {
  en: ['host', 'method', 'MCP', 'brief', 'restart'],
  es: ['host', 'método', 'MCP', 'brief', 'reiniciar'],
} as const;

/** Rows padded into columns; the brief mechanism follows the table as one line per host. */
export function formatHostTable(rows: HostRow[], lang: 'en' | 'es'): string[] {
  const yes = lang === 'es' ? 'sí' : 'yes';
  const cells = rows.map(r => [r.host, r.method, r.mcp, r.brief, r.restart ? yes : 'no']);
  const table = [[...HEADERS[lang]], ...cells];
  const widths = table[0]!.map((_, i) => Math.max(...table.map(row => row[i]!.length)));
  return table.map(row => row.map((cell, i) => i === row.length - 1 ? cell : cell.padEnd(widths[i]!)).join('  ').trimEnd());
}
