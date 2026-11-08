/**
 * Git plumbing shared by `edu sync` and `edu join`: a non-interactive runner, credentials taken
 * from the environment only, and redaction so no token ever reaches output or saved state.
 */
import { execFile } from 'node:child_process';

export interface Git { code: number; out: string; err: string }

const TOKEN_VARS = ['GH_TOKEN', 'GITHUB_TOKEN'] as const;

/**
 * Environment for every Git call: never prompt, never open an editor. When `GH_TOKEN` or
 * `GITHUB_TOKEN` is set, a command-scoped credential helper answers for github.com by reading the
 * variable at run time; the token itself is never written to a config file or an argument.
 */
export function gitEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_MERGE_AUTOEDIT: 'no' };
  if (TOKEN_VARS.some(name => env[name])) {
    const count = Number(env.GIT_CONFIG_COUNT) || 0;
    next.GIT_CONFIG_COUNT = String(count + 1);
    next[`GIT_CONFIG_KEY_${count}`] = 'credential.https://github.com.helper';
    next[`GIT_CONFIG_VALUE_${count}`] = '!f() { test "$1" = get || exit 0; echo username=x-access-token; echo "password=${GH_TOKEN:-$GITHUB_TOKEN}"; }; f';
  }
  return next;
}

export function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<Git> {
  return new Promise(done => {
    execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, env: gitEnv(env ?? process.env) }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
      done({ code, out: String(stdout), err: String(stderr) });
    });
  });
}

/** `https://user:token@host/…` → `https://***@host/…`, plus any token value from the environment. */
export function redact(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let result = text.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, '$1***@');
  for (const name of TOKEN_VARS) {
    const value = env[name];
    if (value && value.length >= 8) result = result.split(value).join('***');
  }
  return result;
}

/** Comparable identity of a remote: host/path without scheme, credentials, `.git` or case on the host. */
export function remoteKey(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '').replace(/\.git$/, '');
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/.exec(trimmed);
  if (scp && !/^[a-z]:$/i.test(`${scp[1]}:`)) return `${scp[1]!.toLowerCase()}/${scp[2]}`;
  const parsed = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/@]+@)?([^/:]+)(?::\d+)?\/(.*)$/i.exec(trimmed);
  if (parsed) return `${parsed[1]!.toLowerCase()}/${parsed[2]}`;
  return trimmed.replace(/\\/g, '/');
}

export function sameRemote(a: string, b: string): boolean {
  return remoteKey(a) === remoteKey(b);
}

export const gitLines = (text: string): string[] => text.split('\n').map(line => line.trim()).filter(Boolean);
