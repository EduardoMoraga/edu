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
  const next: NodeJS.ProcessEnv = {
    ...env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true', GIT_MERGE_AUTOEDIT: 'no',
    // Git Credential Manager (the default helper of Git for Windows) fails instead of opening a prompt.
    GCM_INTERACTIVE: 'never',
  };
  if (TOKEN_VARS.some(name => env[name])) {
    const count = Number(env.GIT_CONFIG_COUNT) || 0;
    next.GIT_CONFIG_COUNT = String(count + 1);
    next[`GIT_CONFIG_KEY_${count}`] = 'credential.https://github.com.helper';
    next[`GIT_CONFIG_VALUE_${count}`] = '!f() { test "$1" = get || exit 0; echo username=x-access-token; echo "password=${GH_TOKEN:-$GITHUB_TOKEN}"; }; f';
  }
  return next;
}

/** A Git call that runs longer than this is killed and settles with exit code 124 (like `timeout(1)`). */
export const GIT_TIMEOUT_MS = 60_000;
export const GIT_TIMED_OUT = 124;

export interface GitCallOptions { timeoutMs?: number }

/**
 * Runs Git without a terminal: stdin is closed at once (nothing can wait for input), and a call that outlives
 * `timeoutMs` is killed and settles with code 124 right away, even if a grandchild still holds its pipes.
 */
export function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv, options: GitCallOptions = {}): Promise<Git> {
  const timeoutMs = options.timeoutMs ?? GIT_TIMEOUT_MS;
  return new Promise(done => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (result: Git) => { if (settled) return; settled = true; clearTimeout(timer); done(result); };
    const child = execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, env: gitEnv(env ?? process.env), windowsHide: true }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
      finish({ code, out: String(stdout), err: String(stderr) });
    });
    timer = setTimeout(() => {
      child.kill('SIGKILL');
      child.stdout?.destroy();
      child.stderr?.destroy();
      finish({ code: GIT_TIMED_OUT, out: '', err: `git ${args.filter(arg => !arg.startsWith('-')).slice(0, 1).join('')} timed out after ${timeoutMs} ms` });
    }, timeoutMs);
    child.stdin?.on('error', () => undefined);
    child.stdin?.end();
  });
}

/** Parameter names that carry credentials, compared decoded, lower-cased and without `-`, `_`, `.`… */
const SECRET_NAMES = new Set(['token', 'pass', 'passwd', 'pwd', 'key', 'secret', 'sig', 'signature', 'auth', 'session', 'sessionid', 'jwt', 'bearer']);
const SECRET_PARTS = /token|secret|passw|apikey|signature|credential|auth/;
const SECRET_ENDS = /(?:key|sig|pwd)$/;

/** The decoded name of a query or fragment parameter (`access%5Ftoken` → `access_token`). */
function paramName(raw: string): string {
  try { return [...new URLSearchParams(`${raw}=`).keys()][0] ?? raw; } catch { return raw; }
}

/** A parameter name that carries a credential under any spelling: `access_token`, `Access-Token`, `accessToken`, `access%5Ftoken`, `X-Amz-Signature`… */
export function isSecretParam(raw: string): boolean {
  const name = paramName(raw).toLowerCase().replace(/[^a-z0-9]/g, '');
  return Boolean(name) && (SECRET_NAMES.has(name) || SECRET_PARTS.test(name) || SECRET_ENDS.test(name));
}

/** Drops credential parameters from a `name=value&…` list; text that is not a parameter list stays as is. */
function keepParams(list: string): string {
  if (!list.includes('=')) return list;
  return list.split(/[&;]/).filter(part => part && !isSecretParam(part.split('=')[0]!)).join('&');
}

/**
 * A remote URL safe to keep in `.git/config`: no userinfo on http(s) URLs and no credential parameters in the
 * query or the fragment (OAuth implicit style `#access_token=…`), whatever the case, separators or
 * percent-encoding of their names. `password` is the secret the userinfo carried (a token alone counts), for
 * in-memory use only.
 */
export function withoutCredentials(url: string): { url: string; password?: string; stripped: boolean } {
  const original = url.trim();
  let password: string | undefined;
  let clean = original.replace(/^(https?:\/\/)([^/\s@]+)@/i, (_all, scheme: string, info: string) => {
    const colon = info.indexOf(':');
    const secret = colon >= 0 ? info.slice(colon + 1) : info;
    try { password = decodeURIComponent(secret); } catch { password = secret; }
    return scheme;
  });
  let fragment = '';
  const hash = clean.indexOf('#');
  if (hash >= 0) {
    const kept = keepParams(clean.slice(hash + 1));
    fragment = kept ? `#${kept}` : '';
    clean = clean.slice(0, hash);
  }
  const query = clean.indexOf('?');
  if (query >= 0) {
    const kept = keepParams(clean.slice(query + 1));
    clean = `${clean.slice(0, query)}${kept ? `?${kept}` : ''}`;
  }
  clean += fragment;
  return { url: clean, ...(password ? { password } : {}), stripped: clean !== original };
}

/** `name=value` after `?`, `&`, `;` or `#` in free text (for example a URL inside an error message). */
const PARAM = /([?&;#])([^=&;#?\s'"]+)=([^&;#\s'"]+)/g;

/** `https://user:token@host/…` → `https://***@host/…`, `?access_token=…` → `?access_token=***` (any spelling, query or fragment), plus any token value from the environment. */
export function redact(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let result = text.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, '$1***@')
    .replace(PARAM, (all: string, sep: string, name: string) => isSecretParam(name) ? `${sep}${name}=***` : all);
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
