/**
 * The environment an agent CLI child receives. Children used to inherit the whole parent environment, so
 * every vendor key, GITHUB_TOKEN and cloud secret reached every agent. `childEnv` passes an allowlist:
 * the variables any program needs to run (PATH, home, locale, terminal, proxy, temp, and the Windows
 * system variables), Edu's own non-secret settings, and the auth variables of that one CLI. Anything
 * else needs a human to name it in the global config: `crew.env.passthrough` in `EDU_HOME/config.json`.
 *
 * Registered checks (`.edu/harness/checks.json`) keep the full environment on purpose: a human wrote
 * them for this project, they are not an agent, and test suites often need project credentials.
 *
 * Only Node built-ins at runtime: scripts load this file with Node's type stripping.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { CliId } from '../core/contracts.js';

/** Needed by any program, on every platform. Matched case-insensitively on Windows. */
const BASE = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'COLORTERM', 'NO_COLOR', 'TZ',
  'LANG', 'LANGUAGE', 'TMPDIR', 'TMP', 'TEMP',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy',
  // Corporate proxies re-sign TLS; without the CA bundle every request fails.
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR',
  // Windows: profile folders and the system variables Node, cmd.exe and the crypto stack need.
  'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'USERNAME', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA',
  'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'COMMONPROGRAMFILES', 'COMMONPROGRAMFILES(X86)',
  'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'PATHEXT', 'OS', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS',
] as const;
const BASE_PREFIXES = ['LC_'] as const;

/** Edu's own settings (no secrets): the child's Edu MCP server must read the same brain. */
const EDU = ['EDU_HOME', 'EDU_LANG', 'EDU_CEILING_DIRECTORIES', 'EDU_PROJECT', 'EDU_LOCK_WORKSPACE', 'EDU_MCP_PROFILE', 'EDU_ASCII', 'EDU_BIN'] as const;

/** Provider keys of the multi-provider CLIs (Pi, OpenCode). */
const PROVIDERS = [
  'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_APPLICATION_CREDENTIALS',
  'GROQ_API_KEY', 'XAI_API_KEY', 'OPENROUTER_API_KEY', 'MISTRAL_API_KEY', 'CEREBRAS_API_KEY', 'DEEPSEEK_API_KEY', 'ZAI_API_KEY',
] as const;

interface CliAuth { names: readonly string[]; prefixes: readonly string[] }
const CLI_AUTH: Record<CliId, CliAuth> = {
  claude: { names: ['CLAUDE_CONFIG_DIR'], prefixes: ['ANTHROPIC_', 'CLAUDE_CODE_'] },
  codex: { names: ['AZURE_OPENAI_API_KEY'], prefixes: ['OPENAI_', 'CODEX_'] },
  pi: { names: PROVIDERS, prefixes: ['PI_', 'ANTHROPIC_', 'OPENAI_', 'AZURE_OPENAI_'] },
  opencode: { names: PROVIDERS, prefixes: ['OPENCODE_', 'ANTHROPIC_', 'OPENAI_', 'AZURE_OPENAI_'] },
  agy: { names: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_LOCATION', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_GENAI_USE_VERTEXAI'], prefixes: ['ANTIGRAVITY_', 'GEMINI_'] },
};
/** Claude Code on Bedrock or Vertex authenticates with that cloud's credentials. */
const CLAUDE_CLOUD: Record<string, CliAuth> = {
  CLAUDE_CODE_USE_BEDROCK: { names: [], prefixes: ['AWS_'] },
  CLAUDE_CODE_USE_VERTEX: { names: ['GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT', 'CLOUD_ML_REGION'], prefixes: ['VERTEX_REGION_'] },
};

export interface ChildEnvOptions {
  /** Parent environment to filter. Default `process.env`. */
  source?: NodeJS.ProcessEnv;
  /** Extra variable names (the config escape hatch). Default: `crew.env.passthrough` of the global config. */
  passthrough?: readonly string[];
  platform?: NodeJS.Platform;
}

const CLI_IDS = new Set<string>(Object.keys(CLI_AUTH));
const cliOf = (command: string): CliId | undefined => {
  const name = command.replace(/\\/g, '/').split('/').pop()!.replace(/\.(?:cmd|exe|bat|ps1)$/i, '').toLowerCase();
  return CLI_IDS.has(name) ? name as CliId : undefined;
};

/**
 * The allowlisted environment for one agent CLI child, plus `extra` (which always wins; an undefined value
 * removes the variable). `cli` may be a CLI id or the command that starts it; an unknown command gets only
 * the base allowlist.
 */
export function childEnv(cli: CliId | string, extra: Record<string, string | undefined> = {}, options: ChildEnvOptions = {}): NodeJS.ProcessEnv {
  const source = options.source ?? process.env;
  const windows = (options.platform ?? process.platform) === 'win32';
  const id = cliOf(cli);
  const auth = id ? CLI_AUTH[id] : { names: [], prefixes: [] };
  const names = new Set<string>([...BASE, ...EDU, ...auth.names, ...(options.passthrough ?? configuredPassthrough(source))]);
  const prefixes: string[] = [...BASE_PREFIXES, ...auth.prefixes];
  if (id === 'claude') for (const [flag, cloud] of Object.entries(CLAUDE_CLOUD)) {
    if (truthy(source[flag])) { cloud.names.forEach(name => names.add(name)); prefixes.push(...cloud.prefixes); }
  }
  const key = (name: string) => windows ? name.toUpperCase() : name;
  const allowed = new Set([...names].map(key));
  const allowedPrefixes = prefixes.map(key);
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const k = key(name);
    if (allowed.has(k) || allowedPrefixes.some(prefix => k.startsWith(prefix))) env[name] = value;
  }
  for (const [name, value] of Object.entries(extra)) {
    // Replace any differently-cased Windows spelling instead of leaving two.
    if (windows) for (const existing of Object.keys(env)) if (existing.toUpperCase() === name.toUpperCase()) delete env[existing];
    if (value === undefined) delete env[name];
    else env[name] = value;
  }
  return env;
}

const truthy = (value: string | undefined) => Boolean(value && !/^(?:0|false|no|off)$/i.test(value.trim()));

/** `crew.env.passthrough` from `EDU_HOME/config.json` (never a project config); empty when absent or invalid. */
export function configuredPassthrough(source: NodeJS.ProcessEnv = process.env): string[] {
  const eduHome = resolve(source.EDU_HOME || join(source.HOME || source.USERPROFILE || homedir(), '.edu'));
  try {
    const config = JSON.parse(readFileSync(join(eduHome, 'config.json'), 'utf8')) as { crew?: { env?: { passthrough?: unknown } } };
    const list = config?.crew?.env?.passthrough;
    return Array.isArray(list) ? list.filter((name): name is string => typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_()]*$/.test(name)) : [];
  } catch { return []; }
}

/**
 * Variables an MCP host must forward to Edu's MCP server when it filters its own children's environment
 * (Codex does): without EDU_CREW_JOB a worker's MCP server would not run in worker mode.
 */
export const MCP_FORWARDED_ENV = ['EDU_CREW_JOB', 'EDU_HOME', 'EDU_PROJECT', 'EDU_LOCK_WORKSPACE', 'EDU_MCP_PROFILE', 'EDU_CEILING_DIRECTORIES'] as const;

/** Codex's MCP server entry for Edu: the launch command plus the variables Codex must forward (`env_vars`). */
export function codexMcpEntry<T extends { command: string; args: string[] }>(launch: T): T & { env_vars: string[] } {
  return { ...launch, env_vars: [...MCP_FORWARDED_ENV] };
}
