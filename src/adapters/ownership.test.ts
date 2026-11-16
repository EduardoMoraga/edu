import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyInstall, getManifestPath, planInstall, uninstall } from './installer.js';
import { packageTemplatesDir } from '../platform/package.js';
import { tomlDefines, tomlKeys } from './toml.js';
import { upsertManagedBlock, removeManagedBlock } from './blocks.js';
import { codexNotifyArgv } from './codex.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'edu-ownership-'));
  dirs.push(base);
  const root = join(base, 'project');
  const home = join(base, 'home');
  await Promise.all([mkdir(root), mkdir(home)]);
  return { base, root, home, templatesDir: packageTemplatesDir() };
}
async function put(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
const json = async (path: string) => JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;

describe('install never overwrites a user-defined value (H1)', () => {
  it('keeps the user statusLine, reports it, and leaves it whole after a forced uninstall', async () => {
    const opts = await fixture();
    const settings = join(opts.home, '.claude/settings.json');
    await put(settings, '{"statusLine":{"type":"command","command":"my-status","padding":1}}\n');
    const plan = await planInstall({ ...opts, scope: 'global', clis: ['claude'] });
    await applyInstall(plan);
    expect((await json(settings)).statusLine).toEqual({ type: 'command', command: 'my-status', padding: 1 });
    expect((await json(settings)).hooks.SessionStart).toHaveLength(1);
    expect(plan.notes.join('\n')).toMatch(new RegExp(`Kept your own statusLine in ${settings.replace(/[\\.]/g, '\\$&')}`));
    await uninstall({ manifestPath: getManifestPath('global', opts.root, opts.home), force: true });
    expect(await json(settings)).toEqual({ statusLine: { type: 'command', command: 'my-status', padding: 1 } });
  });

  it('keeps a user OpenCode agent with an Edu agent name and still adds the other Edu agents', async () => {
    const opts = await fixture();
    const config = join(opts.root, 'opencode.json');
    await put(config, '{\n  "agent": {\n    "reviewer": { "prompt": "my review rules" }\n  }\n}\n');
    const plan = await planInstall({ ...opts, scope: 'project', clis: ['opencode'] });
    await applyInstall(plan);
    const agents = (await json(config)).agent;
    expect(agents.reviewer).toEqual({ prompt: 'my review rules' });
    expect(agents.builder.mode).toBe('subagent');
    expect(plan.notes.some(note => note.includes('agent.reviewer'))).toBe(true);
    await uninstall({ manifestPath: getManifestPath('project', opts.root, opts.home) });
    expect(await json(config)).toEqual({ agent: { reviewer: { prompt: 'my review rules' } } });
  });

  it('never claims a value the user already set to exactly what Edu would write', async () => {
    const opts = await fixture();
    const mcp = join(opts.root, '.mcp.json');
    const plan = await planInstall({ ...opts, scope: 'project', clis: ['claude'] });
    const launch = (plan.actions.find(action => action.path === mcp)!.jsonPatch as { mcpServers: { edu: unknown } }).mcpServers.edu;
    await put(mcp, `${JSON.stringify({ mcpServers: { edu: launch } })}\n`);
    await applyInstall(plan);
    await uninstall({ manifestPath: getManifestPath('project', opts.root, opts.home) });
    expect((await json(mcp)).mcpServers.edu).toEqual(launch);
  });
});

describe('Codex [mcp_servers.edu] defined by the user (M5)', () => {
  it.each([
    ['a quoted table', '[mcp_servers."edu"]\ncommand = "mine"\n'],
    ['an inline table', '[mcp_servers]\nedu = { command = "mine" }\n'],
    ['a dotted key', 'mcp_servers.edu.command = "mine"\n'],
  ])('adds no second table for %s and keeps the user definition', async (_, original) => {
    const opts = await fixture();
    const config = join(opts.home, '.codex/config.toml');
    await put(config, original);
    const plan = await planInstall({ ...opts, scope: 'global', clis: ['codex'] });
    await applyInstall(plan);
    const text = await readFile(config, 'utf8');
    expect(text).toContain(original);
    expect(text).not.toContain('[mcp_servers.edu]');
    expect(tomlKeys(text).filter(key => key.header && key.path.join('.') === 'mcp_servers.edu').length).toBeLessThanOrEqual(1);
    expect(text).toContain('notify = ["edu", "hook", "codex-notify"]');
    expect(plan.notes.some(note => note.includes('[mcp_servers.edu]'))).toBe(true);
    await uninstall({ manifestPath: getManifestPath('global', opts.root, opts.home) });
    expect(await readFile(config, 'utf8')).toBe(original);
  });

  it('recognizes every spelling of a TOML key path and ignores multi-line strings', () => {
    expect(tomlDefines("[ mcp_servers . 'edu' . env ]\nA = 1\n", ['mcp_servers', 'edu'])).toBe(true);
    expect(tomlDefines('[mcp_servers]\n"edu" = { command = "x" }\n', ['mcp_servers', 'edu'])).toBe(true);
    expect(tomlDefines('[mcp_servers.education]\ncommand = "x"\n', ['mcp_servers', 'edu'])).toBe(false);
    expect(tomlDefines('doc = """\n[mcp_servers.edu]\n"""\n', ['mcp_servers', 'edu'])).toBe(false);
    expect(tomlDefines('args = [\n  "x",\n  [1, 2]\n]\nmcp_servers.edu.command = "x"\n', ['mcp_servers', 'edu'])).toBe(true);
  });
});

describe('file layout is preserved', () => {
  it('keeps the user JSON indentation and line endings', async () => {
    const opts = await fixture();
    const settings = join(opts.root, '.claude/settings.json');
    await put(settings, '{\r\n\t"theme": "dark"\r\n}\r\n');
    await applyInstall(await planInstall({ ...opts, scope: 'project', clis: ['claude'] }));
    const text = await readFile(settings, 'utf8');
    expect(text).toMatch(/^\{\r\n\t"theme": "dark",\r\n\t"statusLine": \{\r\n\t\t"type"/);
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('writes CRLF blocks into CRLF instruction and TOML files and removes them exactly', async () => {
    const opts = await fixture();
    const agents = join(opts.root, 'AGENTS.md');
    const config = join(opts.home, '.codex/config.toml');
    await put(agents, '# Rules\r\n');
    await put(config, 'model = "x"\r\n');
    await applyInstall(await planInstall({ ...opts, scope: 'project', clis: ['codex'] }));
    for (const path of [agents, config]) expect((await readFile(path, 'utf8')).replace(/\r\n/g, '')).not.toContain('\n');
    await uninstall({ manifestPath: getManifestPath('project', opts.root, opts.home) });
    expect(await readFile(agents, 'utf8')).toBe('# Rules\r\n');
    expect(await readFile(config, 'utf8')).toBe('model = "x"\r\n');
    expect(removeManagedBlock(upsertManagedBlock('a\r\n', 'x\ny'))).toBe('a\r\n');
  });

  it('names the file when a config does not parse (a comment in ~/.claude/settings.json)', async () => {
    const opts = await fixture();
    const settings = join(opts.home, '.claude/settings.json');
    await put(settings, '{\n  // my comment\n  "theme": "dark"\n}\n');
    const error = await applyInstall(await planInstall({ ...opts, scope: 'global', clis: ['claude'] })).catch((caught: Error) => caught);
    expect(String(error)).toContain(settings);
    expect(String(error)).toMatch(/without comments/);
    expect(await readFile(settings, 'utf8')).toBe('{\n  // my comment\n  "theme": "dark"\n}\n');
  });

  it('names a corrupt Edu manifest instead of throwing a bare SyntaxError', async () => {
    const opts = await fixture();
    const manifestPath = getManifestPath('project', opts.root, opts.home);
    await put(manifestPath, '{ not json');
    await expect(applyInstall(await planInstall({ ...opts, scope: 'project', clis: ['claude'] }))).rejects.toThrow(manifestPath);
  });
});

describe('host paths and launches', () => {
  it('installs Codex and Pi into CODEX_HOME and PI_CODING_AGENT_DIR', async () => {
    const opts = await fixture();
    const env = { CODEX_HOME: join(opts.base, 'codex-home'), PI_CODING_AGENT_DIR: join(opts.base, 'pi-home') };
    await mkdir(env.CODEX_HOME);
    await mkdir(env.PI_CODING_AGENT_DIR);
    const plan = await planInstall({ ...opts, scope: 'global', clis: ['codex', 'pi'], env });
    expect(plan.actions.map(action => action.path)).toEqual(expect.arrayContaining([
      join(env.CODEX_HOME, 'AGENTS.md'), join(env.CODEX_HOME, 'config.toml'), join(env.PI_CODING_AGENT_DIR, 'AGENTS.md'), join(env.PI_CODING_AGENT_DIR, 'mcp.json'),
    ]));
    await applyInstall(plan);
    expect(await readFile(join(env.CODEX_HOME, 'config.toml'), 'utf8')).toContain('[mcp_servers.edu]');
    await uninstall({ manifestPath: getManifestPath('global', opts.root, opts.home) });
    await expect(readFile(join(env.CODEX_HOME, 'config.toml'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('runs the Codex notify hook on Windows through Node, never through cmd.exe', async () => {
    const opts = await fixture();
    const argv = codexNotifyArgv(opts.templatesDir, 'win32', 'C:\\node\\node.exe');
    expect(argv).toEqual(['C:\\node\\node.exe', join(dirname(opts.templatesDir), 'dist', 'cli.js'), 'hook', 'codex-notify']);
    const plan = await planInstall({ ...opts, scope: 'global', clis: ['codex'], platform: 'win32' });
    const body = plan.actions.find(action => action.kind === 'toml-merge')!.tomlBody!;
    expect(body).toMatch(/^notify = \[".+node.*", ".+cli\.js", "hook", "codex-notify"\]/);
    expect(body).toContain('command = "cmd"\nargs = ["/c","edu","mcp"]');
    expect(codexNotifyArgv(opts.templatesDir, 'linux')).toEqual(['edu', 'hook', 'codex-notify']);
  });

  it('reinstalls globally from cwd == HOME when HOME is reached through a symlink', async () => {
    const opts = await fixture();
    const { realpath, symlink } = await import('node:fs/promises');
    await symlink(opts.home, join(opts.base, 'alias'));
    const home = join(opts.base, 'alias');
    const root = await realpath(home);
    await applyInstall(await planInstall({ ...opts, home, root, scope: 'global', clis: ['claude'] }));
    await expect(applyInstall(await planInstall({ ...opts, home, root, scope: 'global', clis: ['claude'] }))).resolves.toBeDefined();
    const { diagnose } = await import('../doctor/diagnose.js');
    expect((await diagnose({ root, home, detectBinary: async () => false })).find(item => item.cli === 'claude')?.scopes).toEqual(['global']);
  });

  it('serializes two concurrent installs on one HOME', async () => {
    const opts = await fixture();
    const second = join(opts.base, 'second');
    await mkdir(second);
    await Promise.all([
      applyInstall(await planInstall({ ...opts, scope: 'project', clis: ['codex'] })),
      applyInstall(await planInstall({ ...opts, root: second, scope: 'project', clis: ['codex'] })),
    ]);
    const registry = await json(join(opts.home, '.edu/shared-targets.json'));
    expect(registry.targets[join(opts.home, '.codex/config.toml')].owners).toHaveLength(2);
    expect((await readFile(join(opts.home, '.codex/config.toml'), 'utf8')).match(/\[mcp_servers\.edu\]/g)).toHaveLength(1);
  });
});
