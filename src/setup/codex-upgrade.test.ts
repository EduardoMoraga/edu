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
  const calls: string[] = []; let installedVersion = baseline; let mode = 'ok'; let registeredRoot = packageRoot;
  // Host registration state, with one-shot failure injection; `failRest` also fails every later mutation (rollback).
  let pluginPresent = true; let marketPresent = true; const failing = new Set<string>(); let failRest = false; let failed = false;
  const runner: SetupRunner = async c => {
    const args = c.args.join(' '); calls.push(args);
    const mutating = !args.startsWith('plugin list') && args !== '--version';
    if (mutating && (failing.delete(args) || (failRest && failed))) { failed = true; return { exitCode: 1, stderr: 'injected host failure' }; }
    if (mode === 'throw' && args === 'plugin add edu@edu --json') throw new Error('spawn failed');
    if (args === '--version') return { exitCode: 0, stdout: mode === 'old-host' ? 'codex-cli 0.162.0' : mode === 'newer' ? 'codex-cli 0.167.0' : 'codex-cli 0.163.0' };
    if (args.startsWith('plugin list')) {
      const root = mode === 'origin' ? '/another/package' : registeredRoot;
      return { exitCode: 0, stdout: JSON.stringify({ installed: pluginPresent ? [{ pluginId: 'edu@edu', name: 'edu', marketplaceName: 'edu', version: installedVersion, installed: true, enabled: true, source: { source: 'local', path: join(root, 'plugins/codex') }, marketplaceSource: { sourceType: mode === 'remote-source' ? 'git' : 'local', source: mode === 'extended' ? `\\\\?\\${root}` : root } }] : [] }) };
    }
    if (args === 'plugin remove edu@edu') { if (!pluginPresent) return { exitCode: 1, stderr: 'not installed' }; await rm(base, { recursive: true, force: true }); pluginPresent = false; return { exitCode: 0 }; }
    if (args === 'plugin marketplace remove edu') { if (!marketPresent) return { exitCode: 1, stderr: 'not found' }; marketPresent = false; return { exitCode: 0 }; }
    if (args.startsWith('plugin marketplace add ')) { if (marketPresent) return { exitCode: 1, stderr: 'already exists' }; registeredRoot = c.args[3]!; marketPresent = true; return { exitCode: 0 }; }
    expect(args).toBe('plugin add edu@edu --json');
    if (!marketPresent) return { exitCode: 1, stderr: 'no marketplace' };
    if (registeredRoot !== packageRoot) {
      // Re-adding a previous package root (rollback): the host copies that root's plugin.
      const from = join(registeredRoot, 'plugins/codex');
      const previous = JSON.parse(await readFile(join(from, '.codex-plugin/plugin.json'), 'utf8')).version;
      await rm(base, { recursive: true, force: true }); await cp(from, join(base, previous), { recursive: true });
      installedVersion = previous; pluginPresent = true;
      return { exitCode: 0, stdout: JSON.stringify({ pluginId: 'edu@edu', version: previous, installedPath: join(base, previous) }) };
    }
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
    if (mode !== 'retained-old') await rm(base, { recursive: true, force: true }); await cp(source, nextRoot, { recursive: true }); installedVersion = manifest.version; pluginPresent = true;
    if (mode === 'corrupt') await writeFile(join(nextRoot, 'skills/edu-brief/SKILL.md'), 'STALE');
    return { exitCode: 0, stdout: JSON.stringify({ pluginId: 'edu@edu', version: manifest.version, installedPath: mode === 'wrong-path' ? '/other/cache' : nextRoot }) };
  };
  const run = async () => applySetup(await planSetup({ home, packageRoot, clis: ['codex'], runner }), { runner, brainRoot, platform });
  return { home, brainRoot, packageRoot, runner, source, base, oldRoot, nextRoot, other, calls, run, files, setRegisteredRoot: (value: string) => { registeredRoot = value; }, setInstalledVersion: (value: string) => { installedVersion = value; }, setMode: (value: string) => { mode = value; },
  failOnce: (args: string) => { failing.add(args); }, failRollback: (value: boolean) => { failRest = value; failed = false; },
  host: () => ({ plugin: pluginPresent, marketplace: marketPresent, root: registeredRoot, version: installedVersion }),
  /** A previous package root on disk (as a Node manager leaves it), holding the published `baseline` plugin. */
  oldPackage: async () => {
    const root = join(home, 'old-node/lib/node_modules/edu-agent');
    for (const [path, content] of Object.entries(files)) { await mkdir(dirname(join(root, 'plugins/codex', path)), { recursive: true }); await writeFile(join(root, 'plugins/codex', path), content); }
    registeredRoot = root;
    await writeFile(join(brainRoot, 'plugin-setup.json'), JSON.stringify({ version: 1, packageRoot: root, native: ['codex'], fallback: [] }));
    return root;
  } };
}
async function backedUp(brainRoot: string, path: string): Promise<string | undefined> {
  for (const backup of await readdir(join(brainRoot, 'backups'))) {
    const record = JSON.parse(await readFile(join(brainRoot, 'backups', backup, 'manifest.json'), 'utf8'));
    for (const file of record.files) if (file.path === path && file.file) return readFile(join(brainRoot, 'backups', backup, file.file), 'utf8');
  }
  return undefined;
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
it('accepts an exact current cache on a newer host without invoking native install again', async () => {
  const f = await fixture(); await f.run();
  const backups = await readdir(join(f.brainRoot, 'backups'));
  f.setMode('old-host');
  await f.run();
  expect(f.calls.filter(c => c === 'plugin add edu@edu --json')).toHaveLength(1);
  expect(await readdir(join(f.brainRoot, 'backups'))).toEqual(backups);
  await writeFile(join(f.nextRoot, 'skills/edu-brief/SKILL.md'), 'CUSTOM');
  await expect(f.run()).rejects.toThrow(/manual conflict.*0\.163\.0 or newer/i);
  expect(await readFile(join(f.nextRoot, 'skills/edu-brief/SKILL.md'), 'utf8')).toBe('CUSTOM');
  expect(f.calls).not.toContain('plugin remove edu@edu');
});
it('accepts Codex 0.167.0 and replaces an Edu-owned custom cache through remove + add after a backup', async () => {
  const f = await fixture(); f.setMode('newer');
  const path = join(f.oldRoot, 'skills/edu-brief/SKILL.md'); await writeFile(path, 'CUSTOM');
  await f.run();
  expect(f.calls.filter(c => !c.startsWith('plugin list') && c !== '--version')).toEqual(['plugin remove edu@edu', 'plugin add edu@edu --json']);
  expect(await readFile(join(f.nextRoot, 'skills/edu-brief/SKILL.md'), 'utf8')).toBe('NEW PROTOCOL');
  expect(await backedUp(f.brainRoot, path)).toBe('CUSTOM');
  expect(await readFile(f.other, 'utf8')).toBe('OTHER CUSTOM');
});
it.each(['edited', 'extra', 'missing', 'unknown-directory'])('backs up an Edu-owned non-baseline cache (%s) and reinstalls through public commands', async mode => {
  const f = await fixture();
  const path = join(f.oldRoot, 'skills/edu-brief/SKILL.md');
  if (mode === 'edited') await writeFile(path, 'CUSTOM');
  if (mode === 'extra') await writeFile(join(f.oldRoot, 'custom.txt'), 'CUSTOM');
  if (mode === 'missing') await rm(join(f.oldRoot, '.mcp.json'));
  if (mode === 'unknown-directory') { await mkdir(join(f.base, 'unknown')); await writeFile(join(f.base, 'unknown/custom'), 'CUSTOM'); }
  await f.run();
  expect(f.calls).toContain('plugin remove edu@edu');
  expect(f.calls).not.toContain('plugin marketplace remove edu');
  if (mode === 'edited') expect(await backedUp(f.brainRoot, path)).toBe('CUSTOM');
  if (mode === 'extra') expect(await backedUp(f.brainRoot, join(f.oldRoot, 'custom.txt'))).toBe('CUSTOM');
  expect(await readFile(f.other, 'utf8')).toBe('OTHER CUSTOM');
});
it('re-registers a relocated package root (Node manager moved it) and records the new root; a second run is a no-op', async () => {
  const f = await fixture(); f.setMode('newer');
  const oldPackage = join(f.home, 'old-node/lib/node_modules/edu-agent');
  f.setRegisteredRoot(oldPackage);
  await writeFile(join(f.brainRoot, 'plugin-setup.json'), JSON.stringify({ version: 1, packageRoot: oldPackage, native: ['codex'], fallback: [] }));
  await f.run();
  expect(f.calls.filter(c => !c.startsWith('plugin list') && c !== '--version')).toEqual(['plugin remove edu@edu', 'plugin marketplace remove edu', `plugin marketplace add ${f.packageRoot}`, 'plugin add edu@edu --json']);
  expect(await backedUp(f.brainRoot, join(f.oldRoot, '.codex-plugin/plugin.json'))).toBe(f.files['.codex-plugin/plugin.json']);
  expect(await readFile(join(f.nextRoot, 'skills/edu-brief/SKILL.md'), 'utf8')).toBe('NEW PROTOCOL');
  expect(JSON.parse(await readFile(join(f.brainRoot, 'plugin-setup.json'), 'utf8')).packageRoot).toBe(f.packageRoot);
  const count = f.calls.length; const backups = await readdir(join(f.brainRoot, 'backups'));
  await f.run();
  expect(f.calls.slice(count).every(c => c.startsWith('plugin list') || c === '--version')).toBe(true);
  expect(await readdir(join(f.brainRoot, 'backups'))).toEqual(backups);
});
it('refuses a relocated registration that points at an unrecorded custom checkout', async () => {
  const f = await fixture(); f.setRegisteredRoot(join(f.home, 'dev/edu'));
  await expect(f.run()).rejects.toThrow(/manual conflict.*not an Edu package/i);
  expect(f.calls.filter(c => !c.startsWith('plugin list') && c !== '--version')).toEqual([]);
});
it.each(['symlink', 'origin', 'remote-source', 'old-host', 'unknown-version', 'empty-directory'])('preserves custom/unknown cache (%s) without invoking install', async mode => {
  const f = await fixture(); f.setMode(mode);
  const path = join(f.oldRoot, 'skills/edu-brief/SKILL.md');
  if (mode === 'unknown-version') f.setInstalledVersion('8.0.0');
  if (mode === 'empty-directory') await mkdir(join(f.base, 'empty'));
  if (mode === 'symlink') { await rm(path); await symlink(f.other, path); }
  await expect(f.run()).rejects.toThrow(/manual conflict/i);
  expect(f.calls).not.toContain('plugin add edu@edu --json');
  expect(f.calls).not.toContain('plugin remove edu@edu');
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
it('backs up a modified old Windows launch before replacing it instead of blessing any cmd wrapper', async () => {
  const f = await fixture('win32'); const path = join(f.oldRoot, '.mcp.json');
  const custom = (await readFile(path, 'utf8')).replace('"/c"', '"/k"'); await writeFile(path, custom);
  await f.run();
  expect(await backedUp(f.brainRoot, path)).toBe(custom);
  expect(f.calls).toContain('plugin remove edu@edu');
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

const recoveryFile = (home: string) => join(home, '.edu/state/plugin-recovery.json');
const present = (path: string) => readFile(path).then(() => true, () => false);
const mutations = (calls: string[]) => calls.filter(c => !c.startsWith('plugin list') && c !== '--version');
it('upgrades a normal 4.x cache (no recorded baseline) at an unchanged root through a backed-up remove + add', async () => {
  const f = await nativeFixture('linux', '0.10.2');
  await cp(f.oldRoot, join(f.base, '4.1.0'), { recursive: true }); f.setInstalledVersion('4.1.0');
  await f.run();
  expect(mutations(f.calls)).toEqual(['plugin remove edu@edu', 'plugin add edu@edu --json']);
  expect(await backedUp(f.brainRoot, join(f.base, '4.1.0/.codex-plugin/plugin.json'))).toBe(f.files['.codex-plugin/plugin.json']);
  expect(f.host()).toEqual({ plugin: true, marketplace: true, root: f.packageRoot, version: candidateVersion });
  expect(await present(recoveryFile(f.home))).toBe(false);
});
it('rolls back a failed same-root reinstall to the previous registration', async () => {
  const f = await nativeFixture('linux', '0.10.2');
  await writeFile(join(f.oldRoot, 'skills/edu-brief/SKILL.md'), 'CUSTOM');
  f.failOnce('plugin add edu@edu --json');
  await expect(f.run()).rejects.toThrow(/native refresh failed.*rolled back/i);
  expect(f.host()).toMatchObject({ plugin: true, marketplace: true, root: f.packageRoot });
  expect(await present(recoveryFile(f.home))).toBe(false);
});

describe('relocation rollback', () => {
  const steps = (root: string) => ['plugin remove edu@edu', 'plugin marketplace remove edu', `plugin marketplace add ${root}`, 'plugin add edu@edu --json'];
  it.each([0, 1, 2, 3])('restores the previous registration when destructive step %i fails', async index => {
    const f = await nativeFixture('linux', '0.10.2');
    const old = await f.oldPackage();
    f.failOnce(steps(f.packageRoot)[index]!);
    await expect(f.run()).rejects.toThrow(/native refresh failed.*rolled back.*registration/i);
    expect(f.host()).toEqual({ plugin: true, marketplace: true, root: old, version: '0.10.2' });
    expect(await readFile(join(f.base, '0.10.2/.codex-plugin/plugin.json'), 'utf8')).toBe(f.files['.codex-plugin/plugin.json']);
    expect(await present(recoveryFile(f.home))).toBe(false);
    expect(JSON.parse(await readFile(join(f.brainRoot, 'plugin-setup.json'), 'utf8')).packageRoot).toBe(old);
  });
  it('restores the previous registration when post-install validation fails', async () => {
    const f = await nativeFixture('linux', '0.10.2');
    const old = await f.oldPackage();
    f.setMode('corrupt');
    await expect(f.run()).rejects.toThrow(/native refresh failed.*rolled back/i);
    expect(f.host()).toEqual({ plugin: true, marketplace: true, root: old, version: '0.10.2' });
  });
  it('keeps a recovery record with exact restore commands when rollback fails, and the next setup repairs it', async () => {
    const f = await nativeFixture('linux', '0.10.2');
    const old = await f.oldPackage();
    f.failOnce('plugin add edu@edu --json'); f.failRollback(true);
    const error = await f.run().then(() => undefined, (e: Error) => e);
    expect(error?.message).toMatch(/rollback failed/i);
    expect(error?.message).toContain(recoveryFile(f.home));
    expect(error?.message).toContain(`codex plugin marketplace add ${old} && codex plugin add edu@edu --json`);
    const record = JSON.parse(await readFile(recoveryFile(f.home), 'utf8'));
    expect(record.hosts.codex).toMatchObject({ previous: { root: old, version: '0.10.2' }, target: f.packageRoot });
    expect(f.host()).toMatchObject({ plugin: false });
    // The next setup repairs the registration first (the old root still exists), then relocates again.
    f.failRollback(false);
    await f.run();
    expect(f.host()).toEqual({ plugin: true, marketplace: true, root: f.packageRoot, version: candidateVersion });
    expect(await present(recoveryFile(f.home))).toBe(false);
  });
  it('repairs toward the current package when the previous root is gone', async () => {
    const f = await nativeFixture('linux', '0.10.2');
    const old = await f.oldPackage();
    f.failOnce('plugin add edu@edu --json'); f.failRollback(true);
    await expect(f.run()).rejects.toThrow(/rollback failed/i);
    await rm(old, { recursive: true });
    f.failRollback(false);
    await f.run();
    expect(f.host()).toMatchObject({ plugin: true, marketplace: true, root: f.packageRoot, version: candidateVersion });
    expect(await present(recoveryFile(f.home))).toBe(false);
  });
});
describe('Codex extended Windows paths', () => {
  it('reduces only the drive-letter extended form', async () => {
    const { nativePath } = await import('./native-files.js');
    expect(nativePath(String.raw`\\?\C:\Users\me\npm\node_modules\edu-agent`)).toBe(String.raw`C:\Users\me\npm\node_modules\edu-agent`);
    expect(nativePath(String.raw`C:\plain`)).toBe(String.raw`C:\plain`);
    expect(nativePath(String.raw`\\?\UNC\server\share`)).toBe(String.raw`\\?\UNC\server\share`);
    expect(nativePath('/tmp/edu')).toBe('/tmp/edu');
    expect(nativePath(undefined)).toBeUndefined();
  });
  it.runIf(process.platform === 'win32')('refreshes a registration whose marketplace root Codex reports in extended form', async () => {
    const f = await nativeFixture('win32'); f.setMode('extended');
    await f.run();
    expect(await readFile(join(f.nextRoot, 'skills/edu-brief/SKILL.md'), 'utf8')).toBe('NEW PROTOCOL');
    expect(f.calls).not.toContain('plugin marketplace remove edu');
  });
});
