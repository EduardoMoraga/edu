import { cp, mkdir, mkdtemp, readFile, realpath, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applySetup, planSetup, type SetupRunner } from './index.js';
const candidateVersion = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')).version as string;
const versions = ['0.10.2', '2.0.0-rc.1'] as const;
const platforms = ['linux', 'win32'] as const;
const cases = versions.flatMap(baseline => platforms.map(platform => ({ baseline, platform })));
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function nativeFixture(platform: NodeJS.Platform = 'linux', baseline: string = '0.10.2') {
  const home = await realpath(await mkdtemp(join(tmpdir(), '09-codex-native-'))); roots.push(home);
  vi.stubEnv('CODEX_HOME', join(home, 'codex home'));
  const brainRoot = join(home, '.edu'); const packageRoot = join(home, 'node_modules/edu-agent');
  const source = join(packageRoot, 'plugins/codex'); const base = join(home, 'codex home/plugins/cache/edu/edu');
  const oldRoot = join(base, baseline); const nextRoot = join(base, candidateVersion);
  const files: Record<string, string> = JSON.parse(await readFile(new URL(`./fixtures/codex-${baseline}.json`, import.meta.url), 'utf8'));
  for (const [path, content] of Object.entries(files)) {
    for (const root of [oldRoot, source]) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), content); }
  }
  if (platform === 'win32') {
    // Exact 0.10.2 localization bytes, independently specified from the current helper.
    const launch = { command: 'cmd', args: ['/c', 'edu', 'mcp'] };
    const shape = { mcpServers: { edu: launch } };
    await writeFile(join(oldRoot, '.mcp.json'), `${JSON.stringify(shape, null, 2)}\n`);
  }
  const manifest = JSON.parse(files['.codex-plugin/plugin.json']!); manifest.version = candidateVersion;
  await writeFile(join(source, '.codex-plugin/plugin.json'), JSON.stringify(manifest));
  await writeFile(join(source, 'skills/edu-brief/SKILL.md'), 'NEW PROTOCOL');
  await mkdir(join(packageRoot, '.agents/plugins'), { recursive: true });
  await writeFile(join(packageRoot, '.agents/plugins/marketplace.json'), JSON.stringify({ name: 'edu', plugins: [{ name: 'edu', source: { source: 'local', path: './plugins/codex' } }] }));
  await mkdir(brainRoot); await writeFile(join(brainRoot, 'EDU.md'), '# CUSTOM IDENTITY');
  await writeFile(join(brainRoot, 'plugin-setup.json'), JSON.stringify({ version: 1, packageRoot, native: ['codex'], fallback: [] }));
  const other = join(home, 'codex home/plugins/cache/other/other/custom.txt'); await mkdir(dirname(other), { recursive: true }); await writeFile(other, 'OTHER CUSTOM');
  const calls: string[] = []; let installedVersion = baseline; let mode = 'ok';
  const runner: SetupRunner = async c => {
    const args = c.args.join(' '); calls.push(args);
    if (mode === 'throw' && args === 'plugin add edu@edu --json') throw new Error('spawn failed');
    if (args === '--version') return { exitCode: 0, stdout: mode === 'unsupported' ? 'codex-cli 0.164.0' : 'codex-cli 0.163.0' };
    if (args.startsWith('plugin list')) return { exitCode: 0, stdout: JSON.stringify({ installed: [{ pluginId: 'edu@edu', name: 'edu', marketplaceName: 'edu', version: installedVersion, installed: true, enabled: true, source: { source: 'local', path: source }, marketplaceSource: { sourceType: 'local', source: mode === 'origin' ? '/another/package' : packageRoot } }] }) };
    expect(args).toBe('plugin add edu@edu --json');
    // Native mutation cannot begin until the original cache is backed up.
    const backups = await readdir(join(brainRoot, 'backups')); let found = false;
    for (const backup of backups) {
      const record = JSON.parse(await readFile(join(brainRoot, 'backups', backup, 'manifest.json'), 'utf8'));
      for (const file of record.files) if (file.path === join(oldRoot, '.codex-plugin/plugin.json')) {
        expect(await readFile(join(brainRoot, 'backups', backup, file.file), 'utf8')).toBe(files['.codex-plugin/plugin.json']); found = true;
      }
    }
    expect(found).toBe(true);
    const launch = platform === 'win32' ? { command: 'cmd', args: ['/c', 'edu', 'mcp'] } : { command: 'edu', args: ['mcp'] };
    expect(JSON.parse(await readFile(join(source, '.mcp.json'), 'utf8'))).toEqual({ mcpServers: { edu: launch } });

    if (mode === 'failure') return { exitCode: 1, stderr: 'simulated host failure' };
    if (mode !== 'retained-old') await rm(base, { recursive: true }); await cp(source, nextRoot, { recursive: true }); installedVersion = manifest.version;
    if (mode === 'corrupt') await writeFile(join(nextRoot, 'skills/edu-brief/SKILL.md'), 'STALE');
    return { exitCode: 0, stdout: JSON.stringify({ pluginId: 'edu@edu', version: manifest.version, installedPath: mode === 'wrong-path' ? '/other/cache' : nextRoot }) };
  };
  const run = async () => applySetup(await planSetup({ home, packageRoot, clis: ['codex'], runner }), { runner, brainRoot, platform });
  return { home, brainRoot, packageRoot, runner, source, base, oldRoot, nextRoot, other, calls, run, setInstalledVersion: (value: string) => { installedVersion = value; }, setMode: (value: string) => { mode = value; } };
}
describe.each(cases)('$baseline on $platform', ({ platform, baseline }) => {
const fixture = (override: NodeJS.Platform = platform) => nativeFixture(override, baseline);
it('refreshes a pristine public cache with backup and candidate validation; repeat does not reinstall', async () => {
  const f = await fixture(); await f.run();
  expect(await readFile(join(f.nextRoot, 'skills/edu-brief/SKILL.md'), 'utf8')).toBe('NEW PROTOCOL');
  expect(await readFile(f.other, 'utf8')).toBe('OTHER CUSTOM');
  const launch = platform === 'win32' ? { command: 'cmd', args: ['/c', 'edu', 'mcp'] } : { command: 'edu', args: ['mcp'] };
  expect(JSON.parse(await readFile(join(f.nextRoot, '.mcp.json'), 'utf8'))).toEqual({ mcpServers: { edu: launch } });
  await f.run(); expect(f.calls.filter(c => c === 'plugin add edu@edu --json')).toHaveLength(1);
});
it.each(['edited', 'extra', 'missing', 'symlink', 'origin', 'unsupported', 'unknown-version', 'unknown-directory', 'empty-directory'])('preserves custom/unknown cache (%s) without invoking install', async mode => {
  const f = await fixture(); f.setMode(mode);
  const path = join(f.oldRoot, 'skills/edu-brief/SKILL.md');
  if (mode === 'edited') await writeFile(path, 'CUSTOM');
  if (mode === 'extra') await writeFile(join(f.oldRoot, 'custom.txt'), 'CUSTOM');
  if (mode === 'missing') await rm(path);
  if (mode === 'unknown-version') f.setInstalledVersion('8.0.0');
  if (mode === 'unknown-directory') { await mkdir(join(f.base, 'unknown')); await writeFile(join(f.base, 'unknown/custom'), 'CUSTOM'); }
  if (mode === 'empty-directory') await mkdir(join(f.base, 'empty'));
  if (mode === 'symlink') { await rm(path); await symlink(f.other, path); }
  await expect(f.run()).rejects.toThrow(/manual conflict/i);
  expect(f.calls).not.toContain('plugin add edu@edu --json');
  if (mode === 'edited') expect(await readFile(path, 'utf8')).toBe('CUSTOM');
  expect(await readFile(f.other, 'utf8')).toBe('OTHER CUSTOM');
});
it.each(['failure', 'corrupt', 'wrong-path', 'throw', 'retained-old'])('does not claim success when native runner/postvalidation fails (%s)', async mode => {
  const f = await fixture(); f.setMode(mode);
  await expect(f.run()).rejects.toThrow(/native.*failed/i);
  expect(f.calls).toContain('plugin add edu@edu --json');
  expect(await readFile(f.other, 'utf8')).toBe('OTHER CUSTOM');
});

it('refuses a native mutation if its private backup cannot be created', async () => {
  const f = await fixture();
  const { migrateWorkspaces } = await import('../update/migrate.js');
  const brainRoot = join(f.home, '.edu');
  await migrateWorkspaces(brainRoot);
  await rm(join(brainRoot, 'backups'), { recursive: true });
  await writeFile(join(brainRoot, 'backups'), 'blocked');
  await expect(f.run()).rejects.toThrow();
  expect(f.calls).not.toContain('plugin add edu@edu --json');
  expect(await readFile(join(f.oldRoot, 'skills/edu-brief/SKILL.md'), 'utf8')).not.toBe('NEW PROTOCOL');
});

it('refuses arbitrary Windows MCP variants without overwriting custom source or invoking native update', async () => {
  const f = await fixture('win32'); const path = join(f.source, '.mcp.json');
  const custom = '{"custom":"preserve","command":"something-else"}\n'; await writeFile(path, custom);
  await expect(f.run()).rejects.toThrow(/manual conflict/i);
  expect(await readFile(path, 'utf8')).toBe(custom);
  expect(f.calls).not.toContain('plugin add edu@edu --json');
});
it('refuses a modified old Windows launch instead of blessing any cmd wrapper', async () => {
  const f = await fixture('win32'); const path = join(f.oldRoot, '.mcp.json');
  const custom = (await readFile(path, 'utf8')).replace('"/c"', '"/k"'); await writeFile(path, custom);
  await expect(f.run()).rejects.toThrow(/manual conflict/i);
  expect(await readFile(path, 'utf8')).toBe(custom);
  expect(f.calls).not.toContain('plugin add edu@edu --json');
});

it('Windows localization backs up the candidate and leaves other host package MCP files untouched', async () => {
  const f = await fixture('win32');
  const other = join(dirname(f.source), 'agy/mcp_config.json');
  await mkdir(dirname(other), { recursive: true }); await writeFile(other, 'OTHER HOST CUSTOM');
  const original = await readFile(join(f.source, '.mcp.json'), 'utf8');
  await f.run();
  expect(await readFile(other, 'utf8')).toBe('OTHER HOST CUSTOM');
  const root = join(f.home, '.edu/backups'); let found = false;
  for (const folder of await readdir(root)) {
    const manifest = JSON.parse(await readFile(join(root, folder, 'manifest.json'), 'utf8'));
    for (const file of manifest.files) if (file.path === join(f.source, '.mcp.json')) {
      expect(await readFile(join(root, folder, file.file), 'utf8')).toBe(original); found = true;
    }
  }
  expect(found).toBe(true);
});

it.each(['after-preflight', 'during-backup'])('aborts before native mutation when marketplace changes %s', async phase => {
  const f = await fixture();
  const { planCodexRefresh } = await import('./codex-upgrade.js');
  const migration = await import('../update/migrate.js');
  const mutate = () => writeFile(join(f.packageRoot, '.agents/plugins/marketplace.json'), '{"name":"edu","plugins":[{"name":"edu","source":"https://untrusted.invalid/plugin"}]}');
  const execute = await planCodexRefresh({ home: f.home, packageRoot: f.packageRoot, previousPackageRoot: f.packageRoot, brainRoot: f.brainRoot, runner: f.runner, platform });
  if (phase === 'after-preflight') await mutate();
  else {
    const original = migration.backupUpgradeFiles;
    vi.spyOn(migration, 'backupUpgradeFiles').mockImplementation(async (...args) => { const result = await original(...args); await mutate(); return result; });
  }
  await expect(execute()).rejects.toThrow(/provenance|metadata/i);
  expect(f.calls).not.toContain('plugin add edu@edu --json');
});
it.each(['after-preflight', 'during-backup'])('aborts before native mutation when host configuration appears %s', async phase => {
  const f = await fixture();
  const { planCodexRefresh } = await import('./codex-upgrade.js');
  const migration = await import('../update/migrate.js');
  const mutate = () => writeFile(join(f.home, 'codex home/config.toml'), 'changed local source');
  const execute = await planCodexRefresh({ home: f.home, packageRoot: f.packageRoot, previousPackageRoot: f.packageRoot, brainRoot: f.brainRoot, runner: f.runner, platform });
  if (phase === 'after-preflight') await mutate();
  else {
    const original = migration.backupUpgradeFiles;
    vi.spyOn(migration, 'backupUpgradeFiles').mockImplementation(async (...args) => { const result = await original(...args); await mutate(); return result; });
  }
  await expect(execute()).rejects.toThrow(/provenance|metadata/i);
  expect(f.calls).not.toContain('plugin add edu@edu --json');
});

it('rejects changed effective host registration even when local source/cache are unchanged', async () => {
  const f = await fixture();
  const { planCodexRefresh } = await import('./codex-upgrade.js');
  const execute = await planCodexRefresh({ home: f.home, packageRoot: f.packageRoot, previousPackageRoot: f.packageRoot, brainRoot: f.brainRoot, runner: f.runner, platform });
  f.setMode('origin');
  await expect(execute()).rejects.toThrow(/provenance/i);
  expect(f.calls).not.toContain('plugin add edu@edu --json');
});

it.each(['cache', 'source'] as const)('refuses symlinked %s roots without changing their contents', async target => {
  const f = await fixture(); const path = target === 'cache' ? f.base : f.source, actual = path + '-preserved';
  await rename(path, actual); await symlink(actual, path, 'junction');
  const before = await readFile(join(actual, target === 'cache' ? baseline + '/skills/edu-brief/SKILL.md' : 'skills/edu-brief/SKILL.md'));
  await expect(f.run()).rejects.toThrow(/manual conflict/i);
  expect(f.calls).not.toContain('plugin add edu@edu --json');
  expect(await readFile(join(actual, target === 'cache' ? baseline + '/skills/edu-brief/SKILL.md' : 'skills/edu-brief/SKILL.md'))).toEqual(before);
});
it.each(['after-preflight', 'during-backup'] as const)('rechecks source and cache bytes at %s', async phase => {
  for (const target of ['cache', 'source'] as const) {
    const f = await fixture();
    const { planCodexRefresh } = await import('./codex-upgrade.js');
    const migration = await import('../update/migrate.js');
    const path = join(target === 'cache' ? f.oldRoot : f.source, 'skills/edu-brief/SKILL.md');
    const execute = await planCodexRefresh({ home: f.home, packageRoot: f.packageRoot, previousPackageRoot: f.packageRoot, brainRoot: f.brainRoot, runner: f.runner, platform });
    const mutate = () => writeFile(path, 'CHANGED AT BOUNDARY');
    if (phase === 'after-preflight') await mutate();
    else {
      const original = migration.backupUpgradeFiles;
      vi.spyOn(migration, 'backupUpgradeFiles').mockImplementationOnce(async (...args) => { const backup = await original(...args); await mutate(); return backup; });
    }
    await expect(execute()).rejects.toThrow(/changed during/i);
    expect(f.calls).not.toContain('plugin add edu@edu --json');
    expect(await readFile(path, 'utf8')).toBe('CHANGED AT BOUNDARY');
    vi.restoreAllMocks();
  }
});

});
