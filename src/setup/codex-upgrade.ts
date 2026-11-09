import { captureNativeProvenance } from './native-provenance.js';
/** Codex native refresh through public `codex plugin` commands. Never write a native cache directly. */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tree, treeOrEmpty, equal, version, eduOwnedRoot, nativePath, type Hashes } from './native-files.js';
import { backupUpgradeFiles } from '../update/migrate.js';
import { compareVersions } from '../update/release.js';
import { codexBaselineForVersion } from './codex-baseline.js';
import { withRegistrationRecovery } from './plugin-recovery.js';
import type { SetupRunner } from './index.js';

/** Oldest Codex whose public plugin commands and cache layout this refresh verifies. */
export const MIN_CODEX_VERSION = '0.163.0';

/**
 * Preflight every target before returning a deferred native mutation.
 *
 * - Pristine published cache at the current root: `codex plugin add` over it.
 * - Edu-owned registration whose cache is not a published baseline, or whose marketplace
 *   still points at an older package root (a Node manager moved it): back up, then a clean
 *   public remove + (re-register) + add. Non-Edu registrations stay a manual conflict.
 */
export async function planCodexRefresh(options: { home: string; packageRoot: string; previousPackageRoot?: string; brainRoot: string; runner: SetupRunner; platform?: NodeJS.Platform }): Promise<() => Promise<void>> {
  const { home, packageRoot, previousPackageRoot, brainRoot, runner } = options;
  const command = (args: string[]) => runner({ cli: 'codex', command: 'codex', args });
  const sourceRoot = join(packageRoot, 'plugins/codex');
  const base = join(resolve(process.env.CODEX_HOME || join(home, '.codex')), 'plugins/cache/edu/edu');
  const listed = async () => {
    const result = await command(['plugin', 'list', '--json']);
    const parsed = JSON.parse(result.stdout ?? '');
    const matches = Array.isArray(parsed.installed) ? parsed.installed.filter((e: { pluginId?: string }) => e.pluginId === 'edu@edu') : [];
    if (result.exitCode !== 0 || matches.length !== 1) throw new Error('installed plugin identity or local provenance is unknown');
    return matches[0];
  };
  let checkProvenance: () => Promise<void>;
  let before: Hashes; let candidate: Hashes; let installedVersion: string; let nextVersion: string;
  let reinstall = false; let relocated = false;
  let previous: { root: string; pluginId: string; version: string; enabled: boolean };
  try {
    const entry = await listed();
    const registeredRoot = nativePath(entry.marketplaceSource?.source);
    // Edu-owned: edu@edu from a local marketplace named edu whose plugin path lives in that marketplace.
    if (!entry.installed || !entry.enabled || entry.name !== 'edu' || entry.marketplaceName !== 'edu' ||
        entry.source?.source !== 'local' || entry.marketplaceSource?.sourceType !== 'local' || typeof registeredRoot !== 'string' ||
        nativePath(entry.source.path) !== join(registeredRoot, 'plugins/codex') || !version(entry.version)) {
      throw new Error('installed plugin identity or local provenance is unknown');
    }
    relocated = registeredRoot !== packageRoot;
    previous = { root: registeredRoot, pluginId: 'edu@edu', version: entry.version, enabled: entry.enabled };
    if (relocated && !eduOwnedRoot(registeredRoot, previousPackageRoot)) throw new Error('registered marketplace source is not an Edu package this setup recorded (custom or development checkout)');
    const host = await command(['--version']);
    checkProvenance = await captureNativeProvenance({ host: 'codex', home, packageRoot, runner, expectedRegistration: JSON.stringify([entry]) });
    const marketplace = JSON.parse(await readFile(join(packageRoot, '.agents/plugins/marketplace.json'), 'utf8'));
    const plugins = marketplace.plugins?.filter((p: { name?: string }) => p.name === 'edu');
    if (marketplace.name !== 'edu' || plugins?.length !== 1 || plugins[0].source?.source !== 'local' || plugins[0].source.path !== './plugins/codex') throw new Error('candidate marketplace does not resolve exactly to Edu');
    candidate = await tree(sourceRoot);
    const manifest = JSON.parse(await readFile(join(sourceRoot, '.codex-plugin/plugin.json'), 'utf8'));
    if (manifest.name !== 'edu' || !version(manifest.version)) throw new Error('invalid candidate plugin manifest');
    nextVersion = manifest.version; installedVersion = entry.version;
    if (compareVersions(nextVersion, installedVersion) < 0) throw new Error('candidate plugin downgrade refused');
    before = await treeOrEmpty(base);
    const expectedCurrent = Object.fromEntries(Object.entries(candidate).map(([p, hash]) => [`${nextVersion}/${p}`, hash]));
    // An exact current cache at the current root needs no native mutation, regardless of host version.
    if (!relocated && installedVersion === nextVersion && equal(before, expectedCurrent)) return async () => {};
    const hostVersion = host.stdout?.trim().match(/^codex-cli (\d+\.\d+\.\d+)$/)?.[1];
    if (host.exitCode !== 0 || !hostVersion || compareVersions(hostVersion, MIN_CODEX_VERSION) < 0) throw new Error(`Codex ${MIN_CODEX_VERSION} or newer is required to refresh the plugin`);
    const baseline = codexBaselineForVersion(installedVersion, options.platform ?? process.platform);
    const expectedOld = baseline && Object.fromEntries(Object.entries(baseline).map(([p, hash]) => [`${installedVersion}/${p}`, hash]));
    // Unknown or custom bytes are backed up below, then replaced through the public remove + add path.
    reinstall = relocated || !expectedOld || !equal(before, expectedOld);
  } catch (error) {
    throw new Error(`Manual conflict: Codex native cache: ${error instanceof Error ? error.message : error}`);
  }
  return async () => {
    await checkProvenance();
    // Check again at the mutation boundary; another setup may have touched the same cache.
    if (!equal(await treeOrEmpty(base), before) || !equal(await tree(sourceRoot), candidate)) throw new Error('Manual conflict: Codex native cache/source changed during preflight');
    const backup = await backupUpgradeFiles(brainRoot, Object.keys(before).map(p => join(base, p)));
    if (!equal(await treeOrEmpty(base), before) || !equal(await tree(sourceRoot), candidate)) throw new Error('Manual conflict: Codex native cache/source changed during backup');
    await checkProvenance();
    const verify = async (result: { stdout?: string }) => {
      const installed = JSON.parse(result.stdout ?? '');
      const expectedPath = join(base, nextVersion);
      if (installed.pluginId !== 'edu@edu' || installed.version !== nextVersion || nativePath(installed.installedPath) !== expectedPath) throw new Error('unexpected install identity/version/path');
      const expected = Object.fromEntries(Object.entries(candidate).map(([p, hash]) => [`${nextVersion}/${p}`, hash]));
      if (!equal(await tree(base), expected)) throw new Error('installed cache does not match candidate hashes');
    };
    if (reinstall) {
      // Destructive: the previous registration is recorded first and restored on any failure.
      try {
        await withRegistrationRecovery({ host: 'codex', home, runner, previous, target: packageRoot }, async step => {
          await step(['plugin', 'remove', 'edu@edu']);
          if (relocated) {
            await step(['plugin', 'marketplace', 'remove', 'edu']);
            await step(['plugin', 'marketplace', 'add', packageRoot]);
          }
          await verify(await step(['plugin', 'add', 'edu@edu', '--json']));
          const entry = await listed();
          if (entry.marketplaceSource?.sourceType !== 'local' || nativePath(entry.marketplaceSource.source) !== packageRoot || nativePath(entry.source?.path) !== sourceRoot || entry.version !== nextVersion) throw new Error('registration does not point at the current package');
        });
      } catch (error) {
        throw new Error(`Codex native refresh failed: ${error instanceof Error ? error.message : error}. Backup: ${backup}. Restart only after the registration is confirmed.`);
      }
      return;
    }
    try {
      const result = await command(['plugin', 'add', 'edu@edu', '--json']);
      if (result.exitCode !== 0) throw new Error(`host exit ${result.exitCode}: ${result.stderr ?? ''}`);
      await verify(result);
    } catch (error) {
      throw new Error(`Codex native refresh failed: ${error instanceof Error ? error.message : error}. Backup: ${backup}. The registration was not removed (plugin add over it); restart only after repair.`);
    }
  };
}
