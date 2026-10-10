/**
 * Cross-platform process launching.
 *
 * On Windows, npm-installed CLIs (claude, codex, edu…) are `.cmd` shims. Node's spawn cannot run
 * them by bare name, and running them through a shell needs careful argument escaping.
 * cross-spawn resolves PATHEXT and escapes arguments correctly, so every place Edu starts another
 * CLI goes through `spawnCli`.
 */
import crossSpawn from 'cross-spawn';

export const spawnCli: typeof crossSpawn = crossSpawn;

export interface McpLaunch { command: string; args: string[] }

/**
 * How a host CLI should start Edu's MCP server. Hosts spawn MCP servers without a shell, so on
 * Windows the `edu.cmd` shim must be started through `cmd /c` (as Claude Code documents for npx).
 */
export function eduMcpLaunch(platform: NodeJS.Platform = process.platform): McpLaunch {
  return platform === 'win32' ? { command: 'cmd', args: ['/c', 'edu', 'mcp'] } : { command: 'edu', args: ['mcp'] };
}
