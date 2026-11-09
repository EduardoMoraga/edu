import { captureNativeProvenance } from './native-provenance.js';
/** Claude's documented user-scope update, constrained to a pristine public Edu plugin. */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { backupUpgradeFiles } from '../update/migrate.js';
import { compareVersions } from '../update/release.js';
import { tree, treeOrEmpty, equal, version, eduOwnedRoot, type Hashes } from './native-files.js';
import { claudeBaselineForVersion } from './claude-baseline.js';
import { withRegistrationRecovery } from './plugin-recovery.js';
import type { SetupRunner } from './index.js';

/**
 * Same package root, complete exact published trees: documented `plugin update`.
 * Same package root, any other cache (a release without a recorded baseline, such as 4.x, or
 * edited files): the registration is Edu's own marketplace for this package, so back up the cache,
 * then a clean public uninstall + install. Moved package root (a Node manager relocated the global
 * install) with an Edu-owned directory marketplace: back up, then uninstall, marketplace
 * re-registration and install. Destructive paths record the previous registration first and roll
 * it back on failure. Non-Edu registrations stay a manual conflict.
 */
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
  const listedMarketplace = async () => {
    const result = await command(['plugin', 'marketplace', 'list', '--json']);
    const markets = JSON.parse(result.stdout ?? '');
    const matches = Array.isArray(markets) ? markets.filter(m => m?.name === 'edu') : [];
    if (result.exitCode !== 0 || matches.length !== 1 || matches[0].source !== 'directory' || typeof matches[0].path !== 'string' || matches[0].installLocation !== matches[0].path) throw new Error('marketplace local provenance is unknown');
    return matches;
  };
  let checkProvenance: () => Promise<void>;
  let before: Hashes; let candidate: Hashes; let nextVersion: string; let relocated = false; let reinstall = false;
  let previous: { root: string; version: string; scope: string; enabled: boolean };
  const releaseTree = (cache: Hashes, release: string): Hashes =>
    Object.fromEntries(Object.entries(cache).filter(([path]) => path.startsWith(`${release}/`)).map(([path, hash]) => [path.slice(release.length + 1), hash]));
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
  // The active tree is exactly the candidate. Retained older releases Claude keeps are inert: a
  // published release must still match its baseline, one without a recorded baseline is left alone.
  const currentCache = (cache: Hashes): boolean => {
    const releases = new Set(Object.keys(cache).map(path => path.split('/')[0]!));
    if (!releases.has(nextVersion) || !equal(releaseTree(cache, nextVersion), candidate)) return false;
    for (const release of releases) {
      if (release === nextVersion) continue;
      if (!version(release) || compareVersions(release, nextVersion) >= 0) return false;
      const baseline = claudeBaselineForVersion(release, options.platform ?? process.platform);
      if (baseline && !equal(releaseTree(cache, release), baseline)) return false;
    }
    return true;
  };
  try {
    const entry = await listedPlugin();
    if (entry.readFromFolder === sourceRoot) return async () => {}; // Existing documented load-in-place mode.
    const markets = await listedMarketplace();
    const registeredRoot: string = markets[0].path;
    relocated = registeredRoot !== packageRoot;
    if (relocated && !eduOwnedRoot(registeredRoot, previousPackageRoot)) throw new Error('registered marketplace source is not an Edu package this setup recorded (custom or development checkout)');
    // Load-in-place is only Edu's when it reads the registered marketplace's plugin folder.
    if (entry.readFromFolder && (!relocated || entry.readFromFolder !== join(registeredRoot, 'plugins/claude-code'))) throw new Error('unsupported native load-in-place path');
    if (!version(entry.version) || (!entry.readFromFolder && entry.installPath !== join(base, entry.version))) throw new Error('unsupported native cache path/layout');
    previous = { root: registeredRoot, version: entry.version, scope: entry.scope, enabled: entry.enabled };
    checkProvenance = await captureNativeProvenance({ host: 'claude', home, packageRoot, runner, expectedRegistration: JSON.stringify([[entry], markets]) });
    const marketplace = JSON.parse(await readFile(join(packageRoot, '.claude-plugin/marketplace.json'), 'utf8'));
    const plugins = marketplace.plugins?.filter((p: { name?: string }) => p.name === 'edu');
    if (marketplace.name !== 'edu' || plugins?.length !== 1 || plugins[0].source !== './plugins/claude-code' || plugins[0].headersHelper || plugins[0].dependencies) throw new Error('unsupported marketplace plugin source/dependencies');
    candidate = await tree(sourceRoot);
    const manifest = JSON.parse(await readFile(join(sourceRoot, '.claude-plugin/plugin.json'), 'utf8'));
    if (manifest.name !== 'edu' || !version(manifest.version) || manifest.dependencies || (plugins[0].version !== undefined && plugins[0].version !== manifest.version)) throw new Error('invalid candidate manifest/version/dependencies');
    nextVersion = manifest.version;
    if (compareVersions(nextVersion, entry.version) < 0) throw new Error('candidate plugin downgrade refused');
    before = await treeOrEmpty(base);
    if (!relocated) {
      if (matchesCache(before, entry.version)) {
        if (entry.version === nextVersion) return async () => {};
      } else {
        // The registration is Edu's own directory marketplace for this very package: no published
        // baseline is needed to replace its cache, only a backup and the public reinstall.
        if (!Object.keys(before).some(path => path.startsWith(`${entry.version}/`))) throw new Error('the registered active version is missing from the cache');
        if (entry.version === nextVersion && equal(releaseTree(before, nextVersion), candidate)) {
          if (currentCache(before)) return async () => {};
          throw new Error('retained cache versions differ from complete exact published version trees (custom, missing or extra files)');
        }
        reinstall = true;
      }
    }
  } catch (error) {
    throw new Error(`Manual conflict: Claude native cache: ${error instanceof Error ? error.message : error}`);
  }
  return async () => {
    await checkProvenance();
    if (!equal(await treeOrEmpty(base), before) || !equal(await tree(sourceRoot), candidate)) throw new Error('Manual conflict: Claude native cache/source changed during preflight');
    const backup = await backupUpgradeFiles(brainRoot, Object.keys(before).map(p => join(base, p)));
    if (!equal(await treeOrEmpty(base), before) || !equal(await tree(sourceRoot), candidate)) throw new Error('Manual conflict: Claude native cache/source changed during backup');
    await checkProvenance();
    // Every installed state must resolve the current package with the candidate bytes.
    const verifyRegistration = async () => {
      const installed = await listedPlugin();
      const markets = await listedMarketplace();
      if (markets[0].path !== packageRoot || installed.version !== nextVersion) throw new Error('registration does not point at the current package');
      if (installed.readFromFolder) {
        if (installed.readFromFolder !== sourceRoot) throw new Error('unexpected load-in-place path');
      } else if (installed.installPath !== join(base, nextVersion) || !equal(await tree(join(base, nextVersion)), candidate)) throw new Error('installed cache does not match candidate hashes');
    };
    if (relocated || reinstall) {
      try {
        await withRegistrationRecovery({ host: 'claude', home, runner, previous, target: packageRoot }, async step => {
          await step(['plugin', 'uninstall', 'edu@edu', '--scope', 'user']);
          if (relocated) {
            await step(['plugin', 'marketplace', 'remove', 'edu']);
            await step(['plugin', 'marketplace', 'add', packageRoot]);
          }
          await step(['plugin', 'install', 'edu@edu', '--scope', 'user']);
          await verifyRegistration();
        });
      } catch (error) {
        throw new Error(`Claude native refresh failed: ${error instanceof Error ? error.message : error}. Backup: ${backup}. Restart only after the registration is confirmed.`);
      }
      return;
    }
    try {
      const args = ['plugin', 'update', 'edu@edu', '--scope', 'user'];
      const result = await command(args);
      if (result.exitCode !== 0) throw new Error(`claude ${args.join(' ')}: host exit ${result.exitCode}: ${result.stderr ?? ''}`);
      const installed = await listedPlugin();
      if (installed.version !== nextVersion || installed.installPath !== join(base, nextVersion) || installed.readFromFolder) throw new Error('unexpected installed version/path');
      const after = await tree(base);
      if (!matchesCache(after, nextVersion)) throw new Error('installed cache does not match candidate hashes');
    } catch (error) {
      throw new Error(`Claude native refresh failed: ${error instanceof Error ? error.message : error}. Backup: ${backup}. The registration was not removed (plugin update); restart only after repair.`);
    }
  };
}
