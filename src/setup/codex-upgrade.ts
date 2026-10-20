import { captureNativeProvenance } from './native-provenance.js';
/** Codex 0.163.0 native refresh. Never write a native cache directly. */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tree, equal, version, type Hashes } from './native-files.js';
import { backupUpgradeFiles } from '../update/migrate.js';
import { compareVersions } from '../update/release.js';
import { codexBaselineFor } from './codex-baseline.js';
import type { SetupRunner } from './index.js';

/** Preflight every target before returning a deferred native mutation. */
export async function planCodexRefresh(options: { home: string; packageRoot: string; previousPackageRoot?: string; brainRoot: string; runner: SetupRunner; platform?: NodeJS.Platform }): Promise<() => Promise<void>> {
  const { home, packageRoot, previousPackageRoot, brainRoot, runner } = options;
  const command = (args: string[]) => runner({ cli: 'codex', command: 'codex', args });
  const sourceRoot = join(packageRoot, 'plugins/codex');
  const base = join(resolve(process.env.CODEX_HOME || join(home, '.codex')), 'plugins/cache/edu/edu');
  let checkProvenance: () => Promise<void>;
  let before: Hashes; let candidate: Hashes; let installedVersion: string; let nextVersion: string;
  try {
    const result = await command(['plugin', 'list', '--json']);
    const listed = JSON.parse(result.stdout ?? '');
    const matches = Array.isArray(listed.installed) ? listed.installed.filter((e: { pluginId?: string }) => e.pluginId === 'edu@edu') : [];
    const entry = matches[0];
    if (result.exitCode !== 0 || matches.length !== 1 || !entry.installed || !entry.enabled ||
        entry.name !== 'edu' || entry.marketplaceName !== 'edu' ||
        entry.source?.source !== 'local' || entry.source.path !== sourceRoot ||
        entry.marketplaceSource?.sourceType !== 'local' || entry.marketplaceSource.source !== packageRoot || previousPackageRoot !== packageRoot || !version(entry.version)) {
      throw new Error('installed plugin identity or local provenance is unknown');
    }
    const host = await command(['--version']);
    if (host.exitCode !== 0 || host.stdout?.trim() !== 'codex-cli 0.163.0') throw new Error('only Codex 0.163.0 cache semantics are verified');
    checkProvenance = await captureNativeProvenance({ host: 'codex', home, packageRoot, runner, expectedRegistration: JSON.stringify([entry]) });
    const marketplace = JSON.parse(await readFile(join(packageRoot, '.agents/plugins/marketplace.json'), 'utf8'));
    const plugins = marketplace.plugins?.filter((p: { name?: string }) => p.name === 'edu');
    if (marketplace.name !== 'edu' || plugins?.length !== 1 || plugins[0].source?.source !== 'local' || plugins[0].source.path !== './plugins/codex') throw new Error('candidate marketplace does not resolve exactly to Edu');
    candidate = await tree(sourceRoot);
    const manifest = JSON.parse(await readFile(join(sourceRoot, '.codex-plugin/plugin.json'), 'utf8'));
    if (manifest.name !== 'edu' || !version(manifest.version)) throw new Error('invalid candidate plugin manifest');
    nextVersion = manifest.version; installedVersion = entry.version;
    if (compareVersions(nextVersion, installedVersion) < 0) throw new Error('candidate plugin downgrade refused');
    before = await tree(base);
    const expectedCurrent = Object.fromEntries(Object.entries(candidate).map(([p, hash]) => [`${nextVersion}/${p}`, hash]));
    if (installedVersion === nextVersion && equal(before, expectedCurrent)) return async () => {};
    const expectedOld = Object.fromEntries(Object.entries(codexBaselineFor(options.platform ?? process.platform)).map(([p, hash]) => [`0.10.2/${p}`, hash]));
    if (installedVersion !== '0.10.2' || !equal(before, expectedOld)) throw new Error('cache differs from the public 0.10.2 baseline (custom, missing or extra files)');
  } catch (error) {
    throw new Error(`Manual conflict: Codex native cache: ${error instanceof Error ? error.message : error}`);
  }
  return async () => {
    await checkProvenance();
    // Check again at the mutation boundary; another setup may have touched the same cache.
    if (!equal(await tree(base), before) || !equal(await tree(sourceRoot), candidate)) throw new Error('Manual conflict: Codex native cache/source changed during preflight');
    const backup = await backupUpgradeFiles(brainRoot, Object.keys(before).map(p => join(base, p)));
    if (!equal(await tree(base), before) || !equal(await tree(sourceRoot), candidate)) throw new Error('Manual conflict: Codex native cache/source changed during backup');
    await checkProvenance();
    try {
      const result = await command(['plugin', 'add', 'edu@edu', '--json']);
      if (result.exitCode !== 0) throw new Error(`host exit ${result.exitCode}: ${result.stderr ?? ''}`);
      const installed = JSON.parse(result.stdout ?? '');
      const expectedPath = join(base, nextVersion);
      if (installed.pluginId !== 'edu@edu' || installed.version !== nextVersion || installed.installedPath !== expectedPath) throw new Error('unexpected install identity/version/path');
      const expected = Object.fromEntries(Object.entries(candidate).map(([p, hash]) => [`${nextVersion}/${p}`, hash]));
      if (!equal(await tree(base), expected)) throw new Error('installed cache does not match candidate hashes');
    } catch (error) {
      throw new Error(`Codex native refresh failed: ${error instanceof Error ? error.message : error}. Backup: ${backup}. No automatic host rollback; restart only after repair.`);
    }
  };
}
