import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applySetup, planSetup, uninstallSetup, type SetupCommand, type SetupRunner } from './index.js';
import { openHome } from '../cli/commands/live.js';
import { shouldRunFirstSetup } from '../cli/commands/plugins.js';
import { captureContext, out as output, runCli } from '../cli/testkit.js';

const packageRoot = process.cwd();
const dirs: string[] = [];
async function tempHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'edu-setup-'));
  dirs.push(root);
  return root;
}
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

function fakeRunner(run: (command: SetupCommand) => { exitCode: number; stdout?: string } = () => ({ exitCode: 0 })) {
  const calls: SetupCommand[] = [];
  const runner: SetupRunner = async (command) => { calls.push(command); return run(command); };
  return { calls, runner };
}

describe('native setup planning', () => {
  it('uses native install argv for each supported CLI and skips already installed plugins', async () => {
    const home = await tempHome();
    const { calls, runner } = fakeRunner((command) => command.args.includes('list') ? { exitCode: 0, stdout: command.cli === 'codex' ? JSON.stringify({ installed: [{ name: 'edu', marketplace: 'edu' }], available: [] }) : '' } : { exitCode: 0 });
    const plan = await planSetup({ clis: ['claude', 'codex', 'pi', 'agy', 'opencode'], packageRoot, home, runner });
    expect(calls.map(({ cli, args }) => [cli, args])).toEqual([
      ['claude', ['plugin', 'list']], ['codex', ['plugin', 'list', '--json']], ['pi', ['list']], ['agy', ['plugin', 'list']],
    ]);
    expect(plan.commands).toEqual(expect.arrayContaining([
      { cli: 'claude', command: 'claude', args: ['plugin', 'marketplace', 'add', packageRoot] },
      { cli: 'claude', command: 'claude', args: ['plugin', 'install', 'edu@edu'] },
      { cli: 'pi', command: 'pi', args: ['install', packageRoot] },
      { cli: 'agy', command: 'agy', args: ['plugin', 'install', join(packageRoot, 'plugins/agy')] },
    ]));
    expect(plan.commands.some(({ cli }) => cli === 'codex')).toBe(false);
    expect(plan.fallback).toContain('opencode');
  });

  it('does not mistake unrelated names containing edu for an installed plugin', async () => {
    const home = await tempHome();
    const { runner } = fakeRunner((command) => command.args.includes('list')
      ? { exitCode: 0, stdout: 'educational-tools\nsuperedu-plugin' }
      : { exitCode: 0 });
    const plan = await planSetup({ clis: ['claude'], packageRoot, home, runner });
    expect(plan.alreadyInstalled).toEqual([]);
    expect(plan.commands.map(({ args }) => args)).toEqual([
      ['plugin', 'marketplace', 'add', packageRoot], ['plugin', 'install', 'edu@edu'],
    ]);
  });

  it('recognizes the exact Codex plugin identity from its JSON installed list', async () => {
    const home = await tempHome();
    const { runner } = fakeRunner((command) => command.args.includes('list')
      ? { exitCode: 0, stdout: JSON.stringify({ installed: [{ name: 'edu', marketplace: 'edu' }], available: [] }) }
      : { exitCode: 0 });
    const plan = await planSetup({ clis: ['codex'], packageRoot, home, runner });
    expect(plan.alreadyInstalled).toEqual(['codex']);
    expect(plan.commands).toEqual([]);
  });

  it('ignores similarly named and merely available Codex plugins in JSON lists', async () => {
    const home = await tempHome();
    const { runner } = fakeRunner((command) => command.args.includes('list')
      ? { exitCode: 0, stdout: JSON.stringify({
        installed: [{ name: 'education-tools', marketplace: 'edu' }, { name: 'edu', marketplace: 'other' }],
        available: [{ name: 'edu', marketplace: 'edu' }],
      }) }
      : { exitCode: 0 });
    const plan = await planSetup({ clis: ['codex'], packageRoot, home, runner });
    expect(plan.alreadyInstalled).toEqual([]);
    expect(plan.commands.map(({ args }) => args)).toEqual([
      ['plugin', 'marketplace', 'add', packageRoot], ['plugin', 'add', 'edu@edu'],
    ]);
  });

  it('applies native installs and records them for reversible uninstall', async () => {
    const home = await tempHome();
    const { calls, runner } = fakeRunner((command) => command.args.at(-1) === 'list' ? { exitCode: 0, stdout: '' } : { exitCode: 0 });
    const plan = await planSetup({ clis: ['claude'], packageRoot, home, runner });
    const applied = await applySetup(plan, { runner, templatesDir: join(packageRoot, 'templates'), platform: 'linux' /* packageRoot is this repo: never localize its plugin files */ });
    expect(applied.installed).toEqual(['claude']);
    const manifest = JSON.parse(await readFile(join(home, '.edu/plugin-setup.json'), 'utf8')) as { native: string[] };
    expect(manifest.native).toEqual(['claude']);
    await uninstallSetup({ home, runner });
    expect(calls).toContainEqual({ cli: 'claude', command: 'claude', args: ['plugin', 'uninstall', 'edu@edu'] });
  });

  it('continues cleanup after native uninstall failures, reports all failures, and is idempotent', async () => {
    const home = await tempHome();
    const { runner } = fakeRunner();
    const plan = await planSetup({ clis: ['claude', 'codex'], packageRoot, home, runner });
    await applySetup(plan, { runner, templatesDir: join(packageRoot, 'templates'), platform: 'linux' /* packageRoot is this repo: never localize its plugin files */ });
    const calls: SetupCommand[] = [];
    const failingRunner: SetupRunner = async command => { calls.push(command); return { exitCode: 2, stderr: `${command.cli} unavailable` }; };
    await expect(uninstallSetup({ home, runner: failingRunner })).rejects.toThrow(/claude.*codex/s);
    expect(calls).toContainEqual({ cli: 'claude', command: 'claude', args: ['plugin', 'marketplace', 'remove', 'edu'] });
    expect(calls).toContainEqual({ cli: 'codex', command: 'codex', args: ['plugin', 'marketplace', 'remove', 'edu'] });
    await expect(readFile(join(home, '.codex/AGENTS.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(home, '.edu/plugin-setup.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(uninstallSetup({ home, runner: failingRunner })).resolves.toBeUndefined();
  });

  it('falls back to managed global adapters when a native install fails', async () => {
    const home = await tempHome();
    const { runner } = fakeRunner((command) => command.args.at(-1) === 'list' ? { exitCode: 0, stdout: '' } : { exitCode: 2, stderr: 'native failure' });
    const plan = await planSetup({ clis: ['claude'], packageRoot, home, runner });
    const applied = await applySetup(plan, { runner, templatesDir: join(packageRoot, 'templates'), platform: 'linux' /* packageRoot is this repo: never localize its plugin files */ });
    expect(applied.fallback).toEqual(['claude']);
    await expect(readFile(join(home, '.edu/manifest.json'), 'utf8')).resolves.toContain('claude');
    await uninstallSetup({ home, runner });
  });

  it('installs generated OpenCode commands, agents, plugin, and MCP through reversible global actions', async () => {
    const home = await tempHome();
    const opencodeConfig = join(home, '.config/opencode/opencode.json');
    await mkdir(join(home, '.config/opencode'), { recursive: true });
    await writeFile(opencodeConfig, '{"theme":"midnight"}\n');
    const { runner } = fakeRunner();
    const plan = await planSetup({ clis: ['opencode'], packageRoot, home, runner });
    const applied = await applySetup(plan, { runner, templatesDir: join(packageRoot, 'templates'), platform: 'linux' /* packageRoot is this repo: never localize its plugin files */ });
    expect(applied.fallback).toEqual(['opencode']);
    await expect(readFile(join(home, '.config/opencode/commands/edu-brief.md'), 'utf8')).resolves.toContain('$ARGUMENTS');
    await expect(readFile(join(home, '.config/opencode/agents/lead.md'), 'utf8')).resolves.toContain('id: lead');
    await expect(readFile(join(home, '.config/opencode/plugins/edu.ts'), 'utf8')).resolves.toContain('session.created');
    const config = JSON.parse(await readFile(join(home, '.config/opencode/opencode.json'), 'utf8')) as { mcp?: { edu?: unknown } };
    expect(config.mcp?.edu).toBeDefined();
    await uninstallSetup({ home, runner });
    await expect(readFile(join(home, '.config/opencode/commands/edu-brief.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(home, '.config/opencode/agents/lead.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(home, '.config/opencode/plugins/edu.ts'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(opencodeConfig, 'utf8')).resolves.toBe('{"theme":"midnight"}\n');
  });

  it('adds only the Codex global identity fallback after native plugin setup', async () => {
    const home = await tempHome();
    const { runner } = fakeRunner((command) => command.args.includes('list') ? { exitCode: 0, stdout: '' } : { exitCode: 0 });
    const plan = await planSetup({ clis: ['codex'], packageRoot, home, runner });
    const applied = await applySetup(plan, { runner, templatesDir: join(packageRoot, 'templates'), platform: 'linux' /* packageRoot is this repo: never localize its plugin files */ });
    expect(applied.installed).toContain('codex');
    const instructions = await readFile(join(home, '.codex/AGENTS.md'), 'utf8');
    expect(instructions).toContain('<!-- edu:core:start -->');
    expect(instructions).toContain(join(home, '.edu/EDU.md'));
    await expect(readFile(join(home, '.codex/config.toml'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(home, '.agents/skills/edu-brief/SKILL.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await uninstallSetup({ home, runner });
    await expect(readFile(join(home, '.codex/AGENTS.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps mixed OpenCode and native Codex actions reversible through one setup manifest', async () => {
    const home = await tempHome();
    const opencodeConfig = join(home, '.config/opencode/opencode.json');
    await mkdir(join(home, '.config/opencode'), { recursive: true });
    await writeFile(opencodeConfig, '{"theme":"midnight"}\n');
    const { runner } = fakeRunner((command) => command.args.includes('list') ? { exitCode: 0, stdout: '' } : { exitCode: 0 });
    const plan = await planSetup({ clis: ['opencode', 'codex'], packageRoot, home, runner });
    const result = await applySetup(plan, { runner, templatesDir: join(packageRoot, 'templates'), platform: 'linux' /* packageRoot is this repo: never localize its plugin files */ });
    expect(result.installed).toEqual(['codex']);
    await expect(readFile(join(home, '.codex/AGENTS.md'), 'utf8')).resolves.toContain('edu:core:start');
    await expect(readFile(join(home, '.config/opencode/plugins/edu.ts'), 'utf8')).resolves.toContain('session.created');
    await uninstallSetup({ home, runner });
    await expect(readFile(join(home, '.codex/AGENTS.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(home, '.config/opencode/plugins/edu.ts'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(opencodeConfig, 'utf8')).resolves.toBe('{"theme":"midnight"}\n');
  });
});

describe('first-run plugin setup', () => {
  it('registers the setup command and its requested flags', async () => {
    const capture = await captureContext();
    dirs.push(join(capture.dirs.cwd, '..'));
    const exit = await runCli(capture, ['setup', '--help']);
    expect(exit?.code).toBe('commander.helpDisplayed');
    expect(output(capture)).toContain('--cli <list>');
    expect(output(capture)).toContain('--dry-run');
    expect(output(capture)).toContain('--yes');
  });

  it('detects a missing global config and initializes setup instead of opening the TUI', async () => {
    const capture = await captureContext({ detected: [], isTTY: true });
    dirs.push(join(capture.dirs.cwd, '..'));
    expect(await shouldRunFirstSetup(capture.ctx)).toBe(true);
    await openHome(capture.ctx, { cwd: capture.dirs.cwd, lang: 'en', json: false });
    await expect(readFile(join(capture.dirs.eduHome, 'config.json'), 'utf8')).resolves.toContain('defaultCli');
    expect(capture.stdout.join('\n')).toContain('No CLIs detected');
    expect(capture.stdout.join('\n')).not.toContain('Just type what you want Edu to do');
    expect(await shouldRunFirstSetup(capture.ctx)).toBe(false);
  });
});

describe('Windows plugin localization', () => {
  it('rewrites plugin MCP launchers to cmd /c on Windows and leaves other platforms untouched', async () => {
    const { mkdtemp, mkdir, writeFile, readFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { localizePluginsForPlatform } = await import('./index.js');
    const root = await mkdtemp(join(tmpdir(), 'edu-win-'));
    await mkdir(join(root, 'plugins/claude-code'), { recursive: true });
    await mkdir(join(root, 'plugins/codex'), { recursive: true });
    await writeFile(join(root, 'plugins/claude-code/.mcp.json'), '{"edu":{"command":"edu","args":["mcp"]}}');
    await writeFile(join(root, 'plugins/codex/.mcp.json'), '{"mcpServers":{"edu":{"command":"edu","args":["mcp"]}}}');
    expect(await localizePluginsForPlatform(root, 'darwin')).toEqual([]);
    expect(await localizePluginsForPlatform(root, 'win32')).toEqual([]); // a checkout outside node_modules is never rewritten
    const written = await localizePluginsForPlatform(root, 'win32', { installedOnly: false });
    expect(written).toHaveLength(2);
    expect(JSON.parse(await readFile(join(root, 'plugins/claude-code/.mcp.json'), 'utf8'))).toEqual({ edu: { command: 'cmd', args: ['/c', 'edu', 'mcp'] } });
    expect(JSON.parse(await readFile(join(root, 'plugins/codex/.mcp.json'), 'utf8')).mcpServers.edu.command).toBe('cmd');
  });
});
