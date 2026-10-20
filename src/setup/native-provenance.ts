/** Snapshot resolution inputs; this is detection, not an atomic vendor/OS transaction. */
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { sha256 } from '../adapters/operations.js';
import type { SetupRunner } from './index.js';

export async function captureNativeProvenance(options: { host: 'claude' | 'codex'; home: string; packageRoot: string; runner: SetupRunner; expectedRegistration: string }): Promise<() => Promise<void>> {
  const { host, home, packageRoot, runner } = options;
  const envName = host === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR';
  const envHome = process.env[envName]; const cwd = process.cwd();
  const hostHome = resolve(envHome || join(home, `.${host}`));
  const marketplace = join(packageRoot, host === 'codex' ? '.agents/plugins/marketplace.json' : '.claude-plugin/marketplace.json');
  const pluginRoot = join(packageRoot, 'plugins', host === 'codex' ? 'codex' : 'claude-code');
  const paths = [marketplace, join(packageRoot, 'package.json'), join(home, '.edu/plugin-setup.json'),
    join(pluginRoot, host === 'codex' ? '.codex-plugin/plugin.json' : '.claude-plugin/plugin.json'), join(pluginRoot, '.mcp.json')];
  if (host === 'codex') paths.push(join(hostHome, 'config.toml'));
  else paths.push(...['settings.json', 'settings.local.json', 'plugins/known_marketplaces.json', 'plugins/installed_plugins.json'].map(p => join(hostHome, p)));
  // Project/ancestor resolution may override the global registration. No auth/key files.
  for (let dir = cwd; ; dir = dirname(dir)) {
    paths.push(...(host === 'codex' ? ['.codex/config.toml'] : ['.claude/settings.json', '.claude/settings.local.json']).map(p => join(dir, p)));
    if (dirname(dir) === dir) break;
  }
  const unique = [...new Set(paths)];
  const files = async () => Promise.all(unique.map(async path => {
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || await realpath(path) !== resolve(path)) throw new Error(`unsupported provenance path: ${path}`);
      // Opaque digest only: never parse, log, copy or return config contents.
      return sha256(await readFile(path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'absent';
      throw error;
    }
  }));
  const registration = async () => {
    const list = await runner({ cli: host, command: host, args: ['plugin', 'list', '--json'] });
    if (list.exitCode !== 0) throw new Error('plugin provenance list failed');
    const parsed = JSON.parse(list.stdout ?? '');
    const entries = host === 'codex' ? parsed.installed : parsed;
    if (!Array.isArray(entries)) throw new Error('unsupported plugin provenance list');
    const plugin = entries.filter(e => (host === 'codex' ? e?.pluginId : e?.id) === 'edu@edu');
    if (host === 'codex') return JSON.stringify(plugin);
    const listed = await runner({ cli: host, command: host, args: ['plugin', 'marketplace', 'list', '--json'] });
    if (listed.exitCode !== 0) throw new Error('marketplace provenance list failed');
    const markets = JSON.parse(listed.stdout ?? '');
    if (!Array.isArray(markets)) throw new Error('unsupported marketplace provenance list');
    return JSON.stringify([plugin, markets.filter(m => m?.name === 'edu')]);
  };
  const baseline = await files(); const recorded = await registration();
  if (recorded !== options.expectedRegistration) throw new Error('Manual conflict: registered provenance changed during preflight');
  const checkFiles = async () => {
    if (process.env[envName] !== envHome || process.cwd() !== cwd || JSON.stringify(await files()) !== JSON.stringify(baseline)) throw new Error(`${host} provenance metadata changed`);
  };
  await checkFiles(); // A list command must not silently change the snapshot it describes.
  return async () => {
    try {
      await checkFiles();
      if (await registration() !== recorded) throw new Error('registered marketplace/plugin provenance changed');
      await checkFiles(); // Recheck after querying the host, immediately before caller mutation.
    } catch (error) { throw new Error(`Manual conflict: ${host} provenance metadata: ${error instanceof Error ? error.message : error}`); }
  };
}
