/**
 * Cross-platform process launching.
 *
 * On Windows, npm-installed CLIs (claude, codex, edu…) are `.cmd` shims that re-run their arguments
 * through cmd.exe. cmd.exe treats characters like `|`, `&`, `>` inside prompts as operators and caps
 * command lines at 8191 characters. So on Windows Edu reads the shim, finds the Node script it wraps
 * and starts that script directly with Node (no cmd.exe involved). Native `.exe` CLIs start directly.
 * Anything else falls back to cross-spawn, which resolves PATHEXT and escapes arguments.
 */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, extname, join, resolve } from 'node:path';
import crossSpawn from 'cross-spawn';

export interface ResolvedCommand { command: string; args: string[]; direct: boolean }

/** Finds `name` on PATH honoring PATHEXT (Windows) and returns the full path, or undefined. */
export function whichSync(name: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  const exts = platform === 'win32' ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  const hasExt = platform === 'win32' && extname(name) !== '';
  for (const dir of (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : delimiter)) {
    if (!dir) continue;
    for (const ext of hasExt ? [''] : exts) {
      const candidate = join(dir, name + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

/** Extracts the Node script an npm `.cmd` shim runs, e.g. `"%dp0%\node_modules\pkg\cli.js" %*`. */
export function nodeScriptFromCmdShim(shimPath: string, content?: string): string | undefined {
  const text = content ?? readFileSync(shimPath, 'utf8');
  const match = /"%(?:~?dp0)%?\\([^"]+?\.(?:js|mjs|cjs))"/i.exec(text) ?? /%~dp0\\([^\s"]+?\.(?:js|mjs|cjs))/i.exec(text);
  if (!match?.[1]) return undefined;
  return resolve(dirname(shimPath), match[1].replace(/\\/g, '/'));
}

/** Some shims wrap a native binary instead of a script: `"%dp0%\node_modules\pkg\bin\tool.exe" %*`. */
export function exeFromCmdShim(shimPath: string, content?: string): string | undefined {
  const text = content ?? readFileSync(shimPath, 'utf8');
  const match = /"%(?:~?dp0)%?\\([^"]+?\.exe)"/i.exec(text);
  return match?.[1] ? resolve(dirname(shimPath), match[1].replace(/\\/g, '/')) : undefined;
}

export function resolveCommand(command: string, args: string[], env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): ResolvedCommand {
  if (platform !== 'win32') return { command, args, direct: false };
  const found = whichSync(command, env, platform);
  if (!found) return { command, args, direct: false };
  const ext = extname(found).toLowerCase();
  if (ext === '.exe' || ext === '.com') return { command: found, args, direct: true };
  if (ext === '.cmd' || ext === '.bat') {
    const script = nodeScriptFromCmdShim(found);
    if (script && existsSync(script)) return { command: process.execPath, args: [script, ...args], direct: true };
    const binary = exeFromCmdShim(found);
    if (binary && existsSync(binary)) return { command: binary, args, direct: true };
  }
  return { command, args, direct: false };
}

/** Starts another CLI safely on every platform (see module comment). */
export function spawnCli(command: string, args: readonly string[], options: SpawnOptions = {}): ChildProcess {
  const env = (options.env ?? process.env) as NodeJS.ProcessEnv;
  const resolved = resolveCommand(command, [...args], env);
  if (resolved.direct) return spawn(resolved.command, resolved.args, { ...options, windowsHide: true });
  return crossSpawn(command, [...args], options);
}

export interface McpLaunch { command: string; args: string[] }

/**
 * How a host CLI should start Edu's MCP server. Hosts spawn MCP servers without a shell, so on
 * Windows the `edu.cmd` shim must be started through `cmd /c` (as Claude Code documents for npx).
 * The arguments are fixed, so no user text ever reaches cmd.exe.
 */
export function eduMcpLaunch(platform: NodeJS.Platform = process.platform): McpLaunch {
  return platform === 'win32' ? { command: 'cmd', args: ['/c', 'edu', 'mcp'] } : { command: 'edu', args: ['mcp'] };
}
