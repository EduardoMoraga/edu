import { captureNativeProvenance } from './native-provenance.js';
/** Claude's documented user-scope update, constrained to a pristine public Edu plugin. */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { backupUpgradeFiles } from '../update/migrate.js';
import { compareVersions } from '../update/release.js';
import { tree, equal, version, type Hashes } from './native-files.js';
import { claudeBaselineForVersion } from './claude-baseline.js';
import type { SetupRunner } from './index.js';

export async function planClaudeRefresh(options: { home: string; packageRoot: string; previousPackageRoot?: string; brainRoot: string; runner: SetupRunner; platform?: NodeJS.Platform }): Promise<() => Promise<void>> {
  const { home, packageRoot, previousPackageRoot, brainRoot, runner } = options;
  const command = (args: string[]) => runner({ cli: 'claude', command: 'claude', args });
  const sourceRoot = join(packageRoot, 'plugins/claude-code');
  const base = join(resolve(process.env.CLAUDE_CONFIG_DIR || join(home, '.claude')), 'plugins/cache/edu/edu');
  const listedPlugin = async () => {
    const result = await command(['plugin', 'list', '--json']);
    const entries = JSON.parse(result.stdout ?? '');
    const matches = Array.isArray(entries) ? entries.filter(e => e?.id === 'edu@edu') : [];
    const entry = matches[0];
    if (result.exitCode !== 0 || matches.length !== 1 || entry.scope !== 'user' || entry.enabled !== true || entry.errors?.length) throw new Error('unknown or ambiguous user-scope installation');
    return entry;
  };
  let checkProvenance: () => Promise<void>;
  let before: Hashes; let candidate: Hashes; let nextVersion: string;
  // Every retained version must be a complete exact known tree, older than the
  // registered active version. The active candidate must equal the source tree.
  const matchesCache = (cache: Hashes, active: string): boolean => {
    const releases = new Set(Object.keys(cache).map(path => path.split('/')[0]!));
    if (!releases.has(active)) return false;
    const expected: Hashes = {};
    for (const release of releases) {
      if (release !== active && compareVersions(release, active) >= 0) return false;
      const hashes = release === nextVersion && release === active ? candidate : claudeBaselineForVersion(release, options.platform ?? process.platform);
      if (!hashes) return false;
      for (const [path, hash] of Object.entries(hashes)) expected[`${release}/${path}`] = hash;
    }
    return equal(cache, expected);
  };
  try {
    const entry = await listedPlugin();
    if (previousPackageRoot !== packageRoot) throw new Error('registered source path changed');
    if (entry.readFromFolder === sourceRoot) return async () => {}; // Existing documented load-in-place mode.
    if (!version(entry.version) || entry.readFromFolder || entry.installPath !== join(base, entry.version)) throw new Error('unsupported native cache path/layout');
    const result = await command(['plugin', 'marketplace', 'list', '--json']);
    const markets = JSON.parse(result.stdout ?? '');
    const matches = Array.isArray(markets) ? markets.filter(m => m?.name === 'edu') : [];
    if (result.exitCode !== 0 || matches.length !== 1 || matches[0].source !== 'directory' || matches[0].path !== packageRoot || matches[0].installLocation !== packageRoot) throw new Error('marketplace local provenance is unknown');
    checkProvenance = await captureNativeProvenance({ host: 'claude', home, packageRoot, runner, expectedRegistration: JSON.stringify([[entry], matches]) });
    const marketplace = JSON.parse(await readFile(join(packageRoot, '.claude-plugin/marketplace.json'), 'utf8'));
    const plugins = marketplace.plugins?.filter((p: { name?: string }) => p.name === 'edu');
    if (marketplace.name !== 'edu' || plugins?.length !== 1 || plugins[0].source !== './plugins/claude-code' || plugins[0].headersHelper || plugins[0].dependencies) throw new Error('unsupported marketplace plugin source/dependencies');
    candidate = await tree(sourceRoot);
    const manifest = JSON.parse(await readFile(join(sourceRoot, '.claude-plugin/plugin.json'), 'utf8'));
    if (manifest.name !== 'edu' || !version(manifest.version) || manifest.dependencies || (plugins[0].version !== undefined && plugins[0].version !== manifest.version)) throw new Error('invalid candidate manifest/version/dependencies');
    nextVersion = manifest.version;
    if (compareVersions(nextVersion, entry.version) < 0) throw new Error('candidate plugin downgrade refused');
    before = await tree(base);
    if (!matchesCache(before, entry.version)) throw new Error('cache differs from complete exact published version trees (unknown version, custom, missing or extra files)');
    if (entry.version === nextVersion) return async () => {};
  } catch (error) {
    throw new Error(`Manual conflict: Claude native cache: ${error instanceof Error ? error.message : error}`);
  }
  return async () => {
    await checkProvenance();
    if (!equal(await tree(base), before) || !equal(await tree(sourceRoot), candidate)) throw new Error('Manual conflict: Claude native cache/source changed during preflight');
    const backup = await backupUpgradeFiles(brainRoot, Object.keys(before).map(p => join(base, p)));
    if (!equal(await tree(base), before) || !equal(await tree(sourceRoot), candidate)) throw new Error('Manual conflict: Claude native cache/source changed during backup');
    await checkProvenance();
    try {
      const result = await command(['plugin', 'update', 'edu@edu', '--scope', 'user']);
      if (result.exitCode !== 0) throw new Error(`host exit ${result.exitCode}: ${result.stderr ?? ''}`);
      const installed = await listedPlugin();
      if (installed.version !== nextVersion || installed.installPath !== join(base, nextVersion) || installed.readFromFolder) throw new Error('unexpected installed version/path');
      const after = await tree(base);
      if (!matchesCache(after, nextVersion)) throw new Error('installed cache does not match candidate hashes');
    } catch (error) {
      throw new Error(`Claude native refresh failed: ${error instanceof Error ? error.message : error}. Backup: ${backup}. No automatic host rollback; restart only after repair.`);
    }
  };
}
