/** Which host is calling the MCP server: from the client name it sends on initialize, else environment hints. */
import type { CliId } from '../core/contracts.js';

/** Provenance `agent` for an MCP client name (from initialize); undefined when the client is not a known host. */
export function agentOfClient(clientName: string | undefined): string | undefined {
  if (!clientName?.trim()) return undefined;
  const cli = detectCallerCli({}, clientName);
  if (cli) return ({ claude: 'claude-code', codex: 'codex', pi: 'pi', opencode: 'opencode', agy: 'antigravity' } as const)[cli];
  // Any other MCP client (Copilot, Cursor, …) is recorded by its own name, normalized.
  const slug = clientName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return slug || undefined;
}

export function detectCallerCli(env: NodeJS.ProcessEnv, clientName?: string): CliId | undefined {
  // The MCP client names itself during initialize; that is more reliable than environment hints.
  const name = (clientName ?? '').toLowerCase();
  if (name.includes('claude')) return 'claude';
  if (name.includes('codex')) return 'codex';
  if (name.includes('opencode')) return 'opencode';
  if (name.includes('antigravity') || name.includes('gemini') || name.includes('agy')) return 'agy';
  if (/(^|[^a-z])pi([^a-z]|$)/.test(name)) return 'pi';
  if (env.CLAUDECODE) return 'claude';
  if (Object.keys(env).some(key => key.startsWith('CODEX_'))) return 'codex';
  if (Object.keys(env).some(key => key.startsWith('PI_'))) return 'pi';
  if (env.OPENCODE) return 'opencode';
  if (env.ANTIGRAVITY || env.ANTIGRAVITY_AGENT || env.GEMINI_CLI) return 'agy';
  return undefined;
}
