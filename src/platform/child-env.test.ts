import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runJsonlProcess } from '../engine/process.js';
import { childEnv, codexMcpEntry, configuredPassthrough } from './child-env.js';

const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

const parent: NodeJS.ProcessEnv = {
  PATH: '/usr/bin', HOME: '/home/ada', LANG: 'es_CL.UTF-8', LC_ALL: 'es_CL.UTF-8', TERM: 'xterm', TMPDIR: '/tmp/x',
  https_proxy: 'http://proxy:8080', NODE_EXTRA_CA_CERTS: '/etc/ca.pem', EDU_HOME: '/home/ada/.edu',
  ANTHROPIC_API_KEY: 'sk-ant', CLAUDE_CODE_OAUTH_TOKEN: 'oauth', OPENAI_API_KEY: 'sk-oai', CODEX_HOME: '/home/ada/.codex',
  GEMINI_API_KEY: 'gem', PI_CODING_AGENT_DIR: '/pi', OPENCODE_CONFIG: '/oc.json',
  FAKE_API_KEY: 'leak', AWS_SECRET_ACCESS_KEY: 'aws', AWS_ACCESS_KEY_ID: 'akia', GITHUB_TOKEN: 'ghp', NPM_TOKEN: 'npm', DATABASE_URL: 'postgres://u:p@h/db',
};
const env = (cli: string, extra: Record<string, string | undefined> = {}, source = parent, platform: NodeJS.Platform = 'linux') =>
  childEnv(cli, extra, { source, passthrough: [], platform });

describe('childEnv', () => {
  it('passes what any program needs and drops unrelated secrets', () => {
    const child = env('node');
    expect(child).toMatchObject({ PATH: '/usr/bin', HOME: '/home/ada', LANG: 'es_CL.UTF-8', LC_ALL: 'es_CL.UTF-8', TERM: 'xterm', TMPDIR: '/tmp/x', https_proxy: 'http://proxy:8080', NODE_EXTRA_CA_CERTS: '/etc/ca.pem', EDU_HOME: '/home/ada/.edu' });
    for (const secret of ['FAKE_API_KEY', 'AWS_SECRET_ACCESS_KEY', 'GITHUB_TOKEN', 'NPM_TOKEN', 'DATABASE_URL', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) expect(child).not.toHaveProperty(secret);
  });

  it("adds only that CLI's own auth variables", () => {
    expect(env('claude')).toMatchObject({ ANTHROPIC_API_KEY: 'sk-ant', CLAUDE_CODE_OAUTH_TOKEN: 'oauth' });
    expect(env('claude')).not.toHaveProperty('OPENAI_API_KEY');
    expect(env('codex')).toMatchObject({ OPENAI_API_KEY: 'sk-oai', CODEX_HOME: '/home/ada/.codex' });
    expect(env('codex')).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(env('agy')).toMatchObject({ GEMINI_API_KEY: 'gem' });
    expect(env('agy')).not.toHaveProperty('OPENAI_API_KEY');
    // Multi-provider CLIs get provider keys, still never unrelated tokens.
    expect(env('pi')).toMatchObject({ PI_CODING_AGENT_DIR: '/pi', ANTHROPIC_API_KEY: 'sk-ant', OPENAI_API_KEY: 'sk-oai', GEMINI_API_KEY: 'gem' });
    expect(env('opencode')).toMatchObject({ OPENCODE_CONFIG: '/oc.json' });
    for (const cli of ['claude', 'codex', 'pi', 'opencode', 'agy']) for (const secret of ['GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'FAKE_API_KEY']) expect(env(cli)).not.toHaveProperty(secret);
    // The command that starts the CLI works as well as its id, including Windows shims.
    expect(env('/usr/local/bin/codex')).toHaveProperty('OPENAI_API_KEY');
    expect(env('C:\\Users\\ada\\AppData\\Roaming\\npm\\claude.cmd')).toHaveProperty('ANTHROPIC_API_KEY');
  });

  it('passes cloud credentials to Claude Code only when it runs on Bedrock', () => {
    expect(env('claude')).not.toHaveProperty('AWS_ACCESS_KEY_ID');
    expect(env('claude', {}, { ...parent, CLAUDE_CODE_USE_BEDROCK: '1' })).toMatchObject({ AWS_ACCESS_KEY_ID: 'akia', AWS_SECRET_ACCESS_KEY: 'aws' });
    expect(env('codex', {}, { ...parent, CLAUDE_CODE_USE_BEDROCK: '1' })).not.toHaveProperty('AWS_ACCESS_KEY_ID');
  });

  it('applies extra last: it adds, overrides and removes', () => {
    expect(env('claude', { EDU_CREW_JOB: 'job-1', HOME: '/sandbox', TERM: undefined })).toMatchObject({ EDU_CREW_JOB: 'job-1', HOME: '/sandbox' });
    expect(env('claude', { TERM: undefined })).not.toHaveProperty('TERM');
  });

  it('honors the passthrough escape hatch', () => {
    expect(childEnv('codex', {}, { source: parent, passthrough: ['GITHUB_TOKEN'], platform: 'linux' })).toMatchObject({ GITHUB_TOKEN: 'ghp' });
  });

  it('matches Windows variables case-insensitively and keeps their spelling', () => {
    const windows = { Path: 'C:\\Windows', SystemRoot: 'C:\\Windows', 'ProgramFiles(x86)': 'C:\\PF86', ComSpec: 'cmd.exe', USERPROFILE: 'C:\\Users\\ada', appdata: 'C:\\AD', GitHub_Token: 'ghp' };
    const child = env('claude', { edu_crew_job: 'job-1' }, { ...windows, EDU_CREW_JOB: 'stale' }, 'win32');
    expect(child).toMatchObject({ Path: 'C:\\Windows', SystemRoot: 'C:\\Windows', 'ProgramFiles(x86)': 'C:\\PF86', ComSpec: 'cmd.exe', USERPROFILE: 'C:\\Users\\ada', appdata: 'C:\\AD', edu_crew_job: 'job-1' });
    expect(child).not.toHaveProperty('GitHub_Token');
    expect(child).not.toHaveProperty('EDU_CREW_JOB'); // replaced, not duplicated under another casing
    // POSIX names are case-sensitive: a lowercase `path` is not PATH there.
    expect(env('node', {}, { path: '/x', PATH: '/usr/bin' }, 'linux')).toEqual({ PATH: '/usr/bin' });
  });

  it('reads the passthrough list from the global config only', async () => {
    const home = await mkdtemp(join(tmpdir(), 'edu-child-env-')); roots.push(home);
    const eduHome = join(home, '.edu');
    await mkdir(eduHome);
    expect(configuredPassthrough({ EDU_HOME: eduHome })).toEqual([]);
    await writeFile(join(eduHome, 'config.json'), JSON.stringify({ crew: { env: { passthrough: ['GITHUB_TOKEN', 'not valid!'] } } }));
    expect(configuredPassthrough({ EDU_HOME: eduHome })).toEqual(['GITHUB_TOKEN']);
    expect(childEnv('codex', {}, { source: { ...parent, EDU_HOME: eduHome }, platform: 'linux' })).toMatchObject({ GITHUB_TOKEN: 'ghp' });
    await writeFile(join(eduHome, 'config.json'), '{ not json');
    expect(configuredPassthrough({ EDU_HOME: eduHome })).toEqual([]);
  });

  it('describes the Codex MCP entry with the variables Codex must forward', () => {
    expect(codexMcpEntry({ command: 'edu', args: ['mcp'] })).toEqual({ command: 'edu', args: ['mcp'], env_vars: expect.arrayContaining(['EDU_CREW_JOB', 'EDU_HOME']) });
  });
});

describe('agent CLI spawn', () => {
  it('starts a real child without the parent secrets but with the worker id', async () => {
    const home = await mkdtemp(join(tmpdir(), 'edu-child-spawn-')); roots.push(home);
    vi.stubEnv('EDU_HOME', join(home, '.edu')); // no global passthrough config here
    vi.stubEnv('FAKE_API_KEY', 'leak');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'aws');
    vi.stubEnv('GITHUB_TOKEN', 'ghp');
    let seen: Record<string, string> = {};
    const script = 'console.log(JSON.stringify(process.env))';
    for await (const _event of runJsonlProcess({ command: process.execPath, args: ['-e', script] }, process.cwd(), 'job-7', line => { seen = JSON.parse(line); return []; })) { /* drain */ }
    expect(seen.EDU_CREW_JOB).toBe('job-7');
    expect(seen).not.toHaveProperty('FAKE_API_KEY');
    expect(seen).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
    expect(seen).not.toHaveProperty('GITHUB_TOKEN');
  });
});
