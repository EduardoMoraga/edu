/**
 * Antigravity native refresh. `agy plugin install <dir>` copies a plugin into Antigravity's own plugin folder,
 * so an upgrade re-installs the current package's plugin through the public CLI. The installed copy is backed up
 * first; if the reinstall fails, the backup is installed again through the same command.
 */
import { cp, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SetupRunner } from './index.js';

interface AgyPlugin { name?: string; version?: string; path?: string; enabled?: boolean }

async function listEdu(runner: SetupRunner): Promise<AgyPlugin | undefined> {
  const listed = await runner({ cli: 'agy', command: 'agy', args: ['plugin', 'list', '--json'] });
  if (listed.exitCode !== 0) throw new Error(`agy plugin list failed: ${listed.stderr ?? ''}`.trim());
  const plugins = JSON.parse(listed.stdout ?? '[]') as AgyPlugin[];
  const matches = Array.isArray(plugins) ? plugins.filter(p => p.name === 'edu') : [];
  if (matches.length > 1) throw new Error('more than one plugin named edu is installed');
  return matches[0];
}

/** Preflights the refresh and returns the deferred mutation (a no-op when the installed copy is already current). */
export async function planAgyRefresh(options: { packageRoot: string; brainRoot: string; runner: SetupRunner; now?: () => Date }): Promise<() => Promise<void>> {
  const { packageRoot, brainRoot, runner } = options;
  const source = join(packageRoot, 'plugins/agy');
  let installed: AgyPlugin | undefined;
  let next: string;
  try {
    const manifest = JSON.parse(await readFile(join(source, 'plugin.json'), 'utf8')) as { name?: string; version?: string };
    if (manifest.name !== 'edu' || !manifest.version) throw new Error('invalid candidate plugin manifest');
    next = manifest.version;
    installed = await listEdu(runner);
    if (installed?.path) {
      // Edu-owned: the installed copy declares itself as Edu's plugin.
      const own = JSON.parse(await readFile(join(installed.path, 'plugin.json'), 'utf8').catch(() => '{}')) as { name?: string };
      if (own.name !== 'edu') throw new Error(`installed plugin at ${installed.path} is not Edu's`);
    }
  } catch (error) {
    throw new Error(`Manual conflict: agy native plugin: ${error instanceof Error ? error.message : error}`);
  }
  if (installed?.version === next) return async () => {};
  return async () => {
    let backup: string | undefined;
    if (installed?.path) {
      const stamp = (options.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-');
      backup = join(brainRoot, 'backups', `agy-plugin-${stamp}`);
      await mkdir(join(brainRoot, 'backups'), { recursive: true });
      await cp(installed.path, backup, { recursive: true, errorOnExist: true, force: false });
    }
    try {
      const result = await runner({ cli: 'agy', command: 'agy', args: ['plugin', 'install', source] });
      if (result.exitCode !== 0) throw new Error(`host exit ${result.exitCode}: ${result.stderr ?? ''}`.trim());
      const now = await listEdu(runner);
      if (now?.version !== next) throw new Error(`installed version is ${now?.version ?? 'missing'}, expected ${next}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (backup) {
        const restored = await runner({ cli: 'agy', command: 'agy', args: ['plugin', 'install', backup] }).catch(() => undefined);
        if (restored?.exitCode === 0) throw new Error(`agy native refresh failed (${reason}); the previous plugin was reinstalled from ${backup}`);
        throw new Error(`agy native refresh failed (${reason}) and the previous plugin could not be reinstalled. Restore it with: agy plugin install "${backup}"`);
      }
      throw new Error(`agy native refresh failed: ${reason}`);
    }
  };
}
