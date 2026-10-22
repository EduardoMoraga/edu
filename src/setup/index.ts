import { planClaudeRefresh } from './claude-upgrade.js';
import { planCodexRefresh } from './codex-upgrade.js';
import { eduMcpLaunch, spawnCli, type McpLaunch } from '../platform/index.js';
import { access, mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { CliId } from '../core/contracts.js';
import { instructionActions, skillActions } from '../adapters/common.js';
import { parse, type ParseError } from 'jsonc-parser';
import { UNION } from '../adapters/merge.js';
import { removeArrayItem } from '../detach/edit.js';
import { applyInstall, getManifestPath, planInstall, uninstall } from '../adapters/installer.js';
import type { InstallPlan, PlannedAction } from '../adapters/types.js';
import { initBrain } from '../cli/setup.js';
import { backupUpgradeFiles, migrateWorkspaces } from '../update/migrate.js';
import { removeManagedBlock, upsertManagedBlock } from '../adapters/blocks.js';
import { readTarget, sha256, validateBundleAction } from '../adapters/operations.js';
import { readProjects } from '../vault/registry.js';

export interface SetupCommand { cli: CliId; command: string; args: string[] }
export interface SetupResult { exitCode: number; stdout?: string; stderr?: string }
export type SetupRunner = (command: SetupCommand) => Promise<SetupResult>;

export interface SetupOptions {
  clis: CliId[];
  packageRoot: string;
  home: string;
  runner?: SetupRunner;
}
export interface SetupPlan extends SetupOptions {
  commands: SetupCommand[];
  fallback: CliId[];
  alreadyInstalled: CliId[];
}
export interface ApplySetupOptions { runner?: SetupRunner; templatesDir?: string; detected?: CliId[]; lang?: 'en' | 'es'; brainRoot?: string; platform?: NodeJS.Platform }
export interface SetupReport { installed: CliId[]; fallback: CliId[]; alreadyInstalled: CliId[]; failed: Array<{ cli: CliId; message: string }>; notes?: string[] }

interface SetupManifest { version: 1; packageRoot: string; native: CliId[]; fallback: CliId[]; adapterManifestPath?: string }

const LIST_COMMANDS: Record<CliId, SetupCommand> = {
  claude: { cli: 'claude', command: 'claude', args: ['plugin', 'list'] },
  codex: { cli: 'codex', command: 'codex', args: ['plugin', 'list', '--json'] },
  pi: { cli: 'pi', command: 'pi', args: ['list'] },
  opencode: { cli: 'opencode', command: 'opencode', args: ['mcp', 'list'] },
  agy: { cli: 'agy', command: 'agy', args: ['plugin', 'list'] },
};

const defaultRunner: SetupRunner = ({ command, args }) => new Promise((resolveResult) => {
  const child = spawnCli(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
  child.once('error', (error) => resolveResult({ exitCode: 127, stderr: error.message }));
  child.once('close', (code) => resolveResult({ exitCode: code ?? 1, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }));
});

function nativeCommands(cli: CliId, packageRoot: string): SetupCommand[] {
  switch (cli) {
    case 'claude': return [
      { cli, command: 'claude', args: ['plugin', 'marketplace', 'add', packageRoot] },
      { cli, command: 'claude', args: ['plugin', 'install', 'edu@edu'] },
    ];
    case 'codex': return [
      { cli, command: 'codex', args: ['plugin', 'marketplace', 'add', packageRoot] },
      { cli, command: 'codex', args: ['plugin', 'add', 'edu@edu'] },
    ];
    case 'pi': return [{ cli, command: 'pi', args: ['install', packageRoot] }];
    case 'agy': return [{ cli, command: 'agy', args: ['plugin', 'install', join(packageRoot, 'plugins/agy')] }];
    case 'opencode': return [];
  }
}

function isCodexInstalledJson(stdout: string): boolean {
  let value: unknown;
  try { value = JSON.parse(stdout); }
  catch { return false; }
  if (!value || typeof value !== 'object' || !Array.isArray((value as { installed?: unknown }).installed)) return false;
  return ((value as { installed: unknown[] }).installed).some((entry) => {
    if (typeof entry === 'string') return entry.toLowerCase() === 'edu@edu';
    if (!entry || typeof entry !== 'object') return false;
    const record = entry as Record<string, unknown>;
    const id = [record.id, record.pluginId, record.plugin_id, record.selector].find((item) => typeof item === 'string');
    if (typeof id === 'string' && id.toLowerCase() === 'edu@edu') return true;
    const name = [record.name, record.plugin].find((item) => typeof item === 'string');
    const marketplace = [record.marketplace, record.marketplaceName, record.marketplace_name].find((item) => typeof item === 'string');
    return typeof name === 'string' && name.toLowerCase() === 'edu' && typeof marketplace === 'string' && marketplace.toLowerCase() === 'edu';
  });
}

function isInstalled(result: SetupResult, cli: CliId): boolean {
  if (result.exitCode !== 0) return false;
  if (cli === 'codex') return isCodexInstalledJson(result.stdout ?? '');
  const knownIds = new Set(['edu', 'edu@edu', 'edu-agent']);
  return (result.stdout ?? '').split(/\r?\n/).some((line) => {
    const first = line.trim().replace(/^[*•✓✔\s]+/, '').split(/\s+/)[0]?.toLowerCase();
    const leaf = first?.split(/[/:]/).at(-1)?.replace(/\.git$/, '');
    return leaf !== undefined && knownIds.has(leaf);
  });
}

async function collectFiles(root: string, relative = ''): Promise<Array<{ path: string; content: string }>> {
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  const files: Array<{ path: string; content: string }> = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(root, path));
    else if (entry.isFile()) files.push({ path, content: await readFile(join(root, path), 'utf8') });
  }
  return files;
}

async function appendOpenCodeAssets(plan: InstallPlan, packageRoot: string): Promise<void> {
  const sourceRoot = join(packageRoot, 'plugins/opencode');
  const destinationRoot = join(plan.home, '.config/opencode');
  for (const category of ['commands', 'agents', 'plugins']) {
    const source = join(sourceRoot, category);
    let files: Array<{ path: string; content: string }>;
    try { files = await collectFiles(source); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`Generated OpenCode ${category} are missing from ${sourceRoot}`);
      throw error;
    }
    if (!files.length) throw new Error(`Generated OpenCode ${category} are empty in ${sourceRoot}`);
    for (const file of files) {
      const action: PlannedAction = {
        cli: 'opencode', kind: 'file', path: join(destinationRoot, category, file.path),
        description: `Install OpenCode ${category} file ${file.path}`, content: file.content,
      };
      plan.actions.push(action);
    }
  }
  await appendOpenCodeTui(plan, sourceRoot, destinationRoot);
  retireOpenCode1Tui(plan, destinationRoot);
}

/** Where the OpenCode 1 setup installed the Edu Deck, relative to ~/.config/opencode (OpenCode 2 never loads it). */
const OPENCODE1_TUI_PLUGIN = 'tui-plugins/edu.tsx';

/**
 * Edu 0.6 pre-releases installed the Deck as tui-plugins/edu.tsx and added its path to `plugin` in
 * tui.json (or tui.jsonc). Retire both from the manifest so a re-run removes them; uninstall stays exact.
 */
function retireOpenCode1Tui(plan: InstallPlan, destinationRoot: string): void {
  const stale = join(destinationRoot, OPENCODE1_TUI_PLUGIN);
  const jsonPatch = { plugin: { [UNION]: [stale] } };
  plan.retire = [
    ...(plan.retire ?? []),
    { kind: 'file', path: stale },
    { kind: 'json-merge', path: join(destinationRoot, 'tui.json'), jsonPatch },
    { kind: 'json-merge', path: join(destinationRoot, 'tui.jsonc'), jsonPatch },
  ];
}

/**
 * OpenCode 2 migrates tui.json into cli.json once, so the OpenCode 1 Edu Deck path can survive in
 * cli.json `plugins`, which Edu never recorded. Remove exactly that entry, editing in place so every
 * other entry and comment stays; leave a file that does not parse alone.
 */
async function removeOpenCode1TuiFromCliJson(home: string): Promise<void> {
  const destinationRoot = join(home, '.config/opencode');
  const path = join(destinationRoot, 'cli.json');
  let text: string;
  try { text = await readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  const errors: ParseError[] = [];
  const value = parse(text, errors, { allowTrailingComma: true }) as { plugins?: unknown } | undefined;
  if (errors.length || !value || typeof value !== 'object' || !Array.isArray(value.plugins)) return;
  const stale = join(destinationRoot, OPENCODE1_TUI_PLUGIN);
  const indexes = value.plugins.flatMap((item, index) => item === stale ? [index] : []);
  if (!indexes.length) return;
  let next = text;
  for (const index of indexes.reverse()) next = removeArrayItem(next, ['plugins', index]);
  await writeFile(path, next);
}

/** Where `edu setup` installs the OpenCode 2 TUI plugin, relative to ~/.config/opencode. */
export const OPENCODE_TUI_PLUGIN = 'plugins/edu-deck/tui.tsx';

/**
 * The Edu Deck for OpenCode 2: TUI plugin and `edu` theme. OpenCode 2 reads TUI plugins from
 * `plugins` in cli.json (directories or packages only; plain file paths are skipped) and also
 * discovers every `<config>/plugins/<dir>/` that has a `tui` entrypoint. Installing the plugin as
 * plugins/edu-deck/tui.tsx loads it with no config edit; the server side ignores the directory because
 * it has no `server`/`index` entrypoint. tui.json / tui.jsonc are OpenCode 1 files that 2.x never reads
 * (tui.json is only migrated once into cli.json), so setup only removes the entry an earlier Edu wrote
 * there (see retireOpenCode1Tui). The theme is installed
 * but never selected; that stays the user's choice.
 */
async function appendOpenCodeTui(plan: InstallPlan, sourceRoot: string, destinationRoot: string): Promise<void> {
  let tui: string;
  try { tui = await readFile(join(sourceRoot, 'tui/edu.tsx'), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  plan.actions.push({ cli: 'opencode', kind: 'file', path: join(destinationRoot, OPENCODE_TUI_PLUGIN), description: 'Install the Edu Deck OpenCode TUI plugin', content: tui });
  try {
    const theme = await readFile(join(sourceRoot, 'themes/edu.json'), 'utf8');
    plan.actions.push({ cli: 'opencode', kind: 'file', path: join(destinationRoot, 'themes/edu.json'), description: 'Install the edu OpenCode theme', content: theme });
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

/** Read-only list checks first, so already-installed plugins do not receive duplicate native install commands. */
export async function planSetup(options: SetupOptions): Promise<SetupPlan> {
  const runner = options.runner ?? defaultRunner;
  const commands: SetupCommand[] = [];
  const fallback: CliId[] = [];
  const alreadyInstalled: CliId[] = [];
  for (const cli of [...new Set(options.clis)]) {
    if (cli === 'opencode') { fallback.push(cli); continue; }
    const listed = await runner(LIST_COMMANDS[cli]);
    if (isInstalled(listed, cli)) { alreadyInstalled.push(cli); continue; }
    commands.push(...nativeCommands(cli, resolve(options.packageRoot)));
  }
  return { ...options, packageRoot: resolve(options.packageRoot), home: resolve(options.home), commands, fallback, alreadyInstalled };
}

async function writeManifest(path: string, manifest: SetupManifest): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(temp, path);
}

/** Installs selected CLIs, falls back to the existing managed-file adapters, and initializes the global brain. */
/**
 * Generated plugins say `edu mcp`. Windows hosts spawn MCP servers without a shell and cannot start
 * the `edu.cmd` shim by name, so rewrite the installed package's plugin MCP files before the native
 * installers copy them.
 */
export async function localizePluginsForPlatform(packageRoot: string, platform: NodeJS.Platform = process.platform, opts: { installedOnly?: boolean; clis?: CliId[] } = {}): Promise<string[]> {
  if (platform !== 'win32') return [];
  // Only an installed copy (inside node_modules) is ours to rewrite; never touch a development checkout.
  if ((opts.installedOnly ?? true) && !/[\\/]node_modules[\\/]/.test(packageRoot)) return [];
  const launch = eduMcpLaunch(platform);
  const targets: Array<[CliId, string, (edu: McpLaunch) => unknown]> = [
    ['claude', 'plugins/claude-code/.mcp.json', edu => ({ edu })],
    ['codex', 'plugins/codex/.mcp.json', edu => ({ mcpServers: { edu } })],
    ['agy', 'plugins/agy/mcp_config.json', edu => ({ mcpServers: { edu } })],
  ];
  const written: string[] = [];
  for (const [cli, relative, shape] of targets) {
    if (opts.clis && !opts.clis.includes(cli)) continue;
    const path = join(packageRoot, relative);
    try { await access(path); } catch { continue; }
    await writeFile(path, `${JSON.stringify(shape(launch), null, 2)}\n`);
    written.push(path);
  }
  return written;
}

/** Localize only canonical candidate MCP files in our installed package, never host/cache files. */
async function localizeUpgradeSources(plan: SetupPlan, options: ApplySetupOptions, brainRoot: string, native: CliId[]): Promise<void> {
  if ((options.platform ?? process.platform) !== 'win32') return;
  const clis = native.filter(cli => cli === 'claude' || cli === 'codex');
  if (!clis.length) return;
  if (!/[\\/]node_modules[\\/]edu-agent$/.test(plan.packageRoot) || await realpath(plan.packageRoot) !== resolve(plan.packageRoot)) throw new Error('Manual conflict: Windows native upgrade requires an owned installed edu-agent package');
  const changed: string[] = [];
  for (const cli of clis) {
    const path = join(plan.packageRoot, 'plugins', cli === 'claude' ? 'claude-code' : 'codex', '.mcp.json');
    if (await realpath(path) !== resolve(path)) throw new Error(`Manual conflict: symlinked candidate MCP ${path}`);
    const before = await readTarget(path);
    const shape = (launch: McpLaunch) => cli === 'claude' ? { edu: launch } : { mcpServers: { edu: launch } };
    const unix = `${JSON.stringify(shape(eduMcpLaunch('linux')), null, 2)}\n`;
    const windows = `${JSON.stringify(shape(eduMcpLaunch('win32')), null, 2)}\n`;
    if (before?.toString('utf8') !== unix && before?.toString('utf8') !== windows) throw new Error(`Manual conflict: custom candidate MCP ${path}`);
    if (before.toString('utf8') !== windows) changed.push(path);
  }
  if (!changed.length) return;
  await backupUpgradeFiles(brainRoot, changed);
  await localizePluginsForPlatform(plan.packageRoot, 'win32', { clis });
}

async function optionalSetupFile(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

/** The old updater calls NEW setup before NEW migration. Guard here, before native writes. */
async function prepareUpgrade(plan: SetupPlan, options: ApplySetupOptions, brainRoot: string): Promise<SetupReport | undefined> {
  const existingBrain = await optionalSetupFile(join(brainRoot, 'EDU.md')) !== undefined;
  const registry = await optionalSetupFile(join(brainRoot, 'projects.json'));
  if (existingBrain || registry !== undefined) {
    const results = await migrateWorkspaces(brainRoot);
    // A genuinely fresh global brain is initialized below; registered projects are never exempt.
    const failures = results.filter(r => r.status !== 'migrated' && !(r.name === 'global' && !existingBrain && ['missing', 'no-brain'].includes(r.status)));
    if (failures.length) throw new Error(`Setup upgrade migration incomplete: ${failures.map(r => `${r.name}: ${r.detail ?? r.status}`).join('; ')}`);
  }
  const manifestPath = await setupManifestPath(plan.home);
  const previousText = await optionalSetupFile(manifestPath);
  const adapterManifest = getManifestPath('global', plan.packageRoot, plan.home);
  const adapterText = await optionalSetupFile(adapterManifest);
  // An initialized brain alone is not proof that integrations have ever been installed.
  if (!existingBrain || (!previousText && !adapterText && !plan.alreadyInstalled.length)) return undefined;
  const previous = previousText ? JSON.parse(previousText) as SetupManifest : undefined;
  if (previous && (previous.version !== 1 || !Array.isArray(previous.native) || !Array.isArray(previous.fallback))) throw new Error('Invalid setup manifest');
  const templatesDir = options.templatesDir ?? join(plan.packageRoot, 'templates');
  const storedAdapter = adapterText ? JSON.parse(adapterText) : undefined;
  if (storedAdapter && !Array.isArray(storedAdapter.actions)) throw new Error('Invalid adapter manifest');
  const configured = new Set([...plan.alreadyInstalled, ...(previous?.native ?? []), ...(previous?.fallback ?? []),
    ...(storedAdapter?.actions ?? []).flatMap((a: { cli: CliId; clis?: CliId[] }) => a.clis ?? [a.cli])]);
  const unconfigured = plan.clis.filter(cli => !configured.has(cli));
  if (unconfigured.length) throw new Error(`Setup upgrade preserves existing integrations; configure new CLIs explicitly with edu install --scope global --cli ${unconfigured.join(',')}`);
  const scopes = [{ scope: 'global' as const, root: plan.packageRoot },
    ...(await readProjects(brainRoot)).projects.map(p => ({ scope: 'project' as const, root: p.root }))];
  const upgrades: InstallPlan[] = [];
  const notes: string[] = [];
  for (const scope of scopes) {
    const changed: PlannedAction[] = [];
    const actions = plan.clis.flatMap(cli => instructionActions(cli, scope.scope, scope.root, { home: plan.home, templatesDir, brainRoot }));
    for (const action of new Map(actions.map(a => [a.path, a])).values()) {
      const before = await optionalSetupFile(action.path);
      // A registered brain or native plugin is not consent to add host instructions.
      // The existing block is the authority; malformed/duplicate blocks fail validation.
      if (before === undefined || removeManagedBlock(before) === before) continue;
      if (upsertManagedBlock(before ?? '', action.content ?? '') !== before) changed.push(action);
    }
    const scopedManifestPath = getManifestPath(scope.scope, scope.root, plan.home);
    const scopedText = await optionalSetupFile(scopedManifestPath);
    const owned: PlannedAction[] = scopedText ? JSON.parse(scopedText).actions : [];
    if (!Array.isArray(owned)) throw new Error(`Invalid adapter manifest: ${scopedManifestPath}`);
    const bundleActions: PlannedAction[] = [];
    for (const cli of plan.clis) {
      for (const action of await skillActions(cli, scope.scope, scope.root, { home: plan.home, templatesDir, selectedHosts: plan.clis, notes })) {
        const prior = owned.find(a => a.kind === 'file' && a.path === action.path && (a.clis ?? [a.cli]).includes(cli));
        const document = action.bundle ? owned.find(a => a.kind === 'file' && a.path === join(action.bundle!.root, 'SKILL.md') && (a.clis ?? [a.cli]).includes(cli)) : undefined;
        if (!prior && !document) continue; // A name/prefix is not proof of ownership.
        await validateBundleAction(action);
        if (!prior) {
          const beforeDocument = await readTarget(document!.path);
          if (!beforeDocument || !document!.sha256 || sha256(beforeDocument) !== document!.sha256) throw new Error(`Manual conflict: custom or missing managed skill ${document!.path}`);
          if (await readTarget(action.path)) throw new Error(`Manual conflict: unowned bundle helper ${action.path}`);
          if (!changed.some(a => a.path === action.path)) changed.push(action);
          bundleActions.push(action);
          continue;
        }
        bundleActions.push(action);
        const before = await readTarget(action.path);
        if (!before || !prior.sha256 || sha256(before) !== prior.sha256) throw new Error(`Manual conflict: custom or missing managed skill ${action.path}`);
        if (before.toString('utf8') !== action.content && !changed.some(a => a.path === action.path)) changed.push(action);
      }
    }
    if (scope.scope === 'global' && plan.clis.includes('opencode')) {
      const destination = join(plan.home, '.config/opencode');
      const assets = owned.filter(a => a.kind === 'file' && (a.clis ?? [a.cli]).includes('opencode') &&
        ['commands', 'agents', 'plugins', 'themes', 'tui-plugins'].some(category => a.path.startsWith(join(destination, category) + sep)));
      if (assets.length) {
        const candidates: InstallPlan = { ...scope, home: plan.home, templatesDir, notes: [], actions: [] };
        await appendOpenCodeAssets(candidates, plan.packageRoot);
        // Do not pass retire or new targets to applyInstall during upgrade.
        for (const prior of assets) {
          const action = candidates.actions.find(a => a.kind === 'file' && a.path === prior.path);
          if (!action) throw new Error(`Manual conflict: retired or unsupported managed OpenCode asset ${prior.path}`);
          const before = await readTarget(prior.path);
          if (!before || !prior.sha256 || sha256(before) !== prior.sha256) throw new Error(`Manual conflict: custom or missing managed OpenCode asset ${prior.path}`);
          if (before.toString('utf8') !== action.content && !changed.some(a => a.path === action.path)) changed.push(action);
        }
      }
    }
    const bundleRoots = new Set(bundleActions.flatMap(a => a.bundle ? [a.bundle.root] : []));
    for (const action of owned) if (action.bundle && bundleRoots.has(action.bundle.root)) await validateBundleAction(action);
    const retiringBundle = owned.some(a => a.bundle && bundleRoots.has(a.bundle.root) && !bundleActions.some(next => next.path === a.path));
    if (changed.length || retiringBundle) upgrades.push({ ...scope, home: plan.home, templatesDir, notes: [], actions: [...new Map([...changed, ...bundleActions].map(a => [a.path, a])).values()] });
  }
  // Do not report an installed native plugin as refreshed merely because list succeeded.
  // Old manifests contain no cache baseline: never overwrite unknown custom plugin files.
  const runner = options.runner ?? plan.runner ?? defaultRunner;
  const native = [...new Set([...plan.alreadyInstalled, ...(previous?.native ?? [])])].filter(cli => plan.clis.includes(cli));
  await localizeUpgradeSources(plan, options, brainRoot, native);
  const nativeRefreshes: Array<() => Promise<void>> = [];
  for (const cli of native) {
    if (cli === 'codex') {
      nativeRefreshes.push(await planCodexRefresh({ home: plan.home, packageRoot: plan.packageRoot, previousPackageRoot: previous?.packageRoot, brainRoot, runner, platform: options.platform }));
      continue;
    }
    if (cli === 'claude') {
      nativeRefreshes.push(await planClaudeRefresh({ home: plan.home, packageRoot: plan.packageRoot, previousPackageRoot: previous?.packageRoot, brainRoot, runner, platform: options.platform }));
      continue;
    }
    if (cli === 'pi') {
      const listed = await runner(LIST_COMMANDS.pi);
      const local = listed.stdout?.split(/\r?\n/).some(line => line.trim() === plan.packageRoot);
      if (listed.exitCode === 0 && local && previous?.packageRoot === plan.packageRoot) continue; // Local Pi resources load in place on restart.
    }
    throw new Error(`Manual conflict: ${cli} native cache refresh cannot be verified from legacy setup metadata. Preserve custom files and back up the installed plugin before a targeted host update; restart required. No native update was run.`);
  }
  for (const refresh of nativeRefreshes) await refresh();
  if (upgrades.length) {
    await backupUpgradeFiles(brainRoot, upgrades.flatMap(p => [...p.actions.map(a => a.path), getManifestPath(p.scope, p.root, p.home)]));
    for (const upgrade of upgrades) await applyInstall(upgrade);
  }

  return { installed: [], fallback: previous?.fallback ?? [], alreadyInstalled: [...new Set([...plan.alreadyInstalled, ...(previous?.native ?? [])])], failed: [], ...(notes.length ? { notes } : {}) };
}

export async function applySetup(plan: SetupPlan, options: ApplySetupOptions = {}): Promise<SetupReport> {
  const brainRoot = resolve(options.brainRoot ?? process.env.EDU_HOME ?? join(plan.home, '.edu'));
  const upgraded = await prepareUpgrade(plan, options, brainRoot);
  if (upgraded) return upgraded;
  const runner = options.runner ?? plan.runner ?? defaultRunner;
  const report: SetupReport = { installed: [], fallback: [], alreadyInstalled: [...plan.alreadyInstalled], failed: [] };
  const pending = new Set(plan.fallback);
  const successful = new Set<CliId>();
  const failed = new Map<CliId, string>();
  await localizePluginsForPlatform(plan.packageRoot, options.platform);
  // Codex refuses to run when CODEX_HOME points to a missing directory (fresh machines, custom homes).
  if (plan.commands.some(c => c.cli === 'codex')) {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(process.env.CODEX_HOME || join(plan.home, '.codex'), { recursive: true }).catch(() => undefined);
  }
  for (const command of plan.commands) {
    if (failed.has(command.cli)) continue;
    const result = await runner(command);
    if (result.exitCode !== 0) failed.set(command.cli, (result.stderr || result.stdout || `exit ${result.exitCode}`).trim());
    else successful.add(command.cli);
  }
  for (const [cli, message] of failed) { pending.add(cli); report.failed.push({ cli, message }); }
  for (const cli of successful) if (!pending.has(cli)) report.installed.push(cli);

  let adapterPlan: InstallPlan | undefined;
  if (pending.size) {
    adapterPlan = await planInstall({ clis: [...pending], selectedHosts: plan.clis, scope: 'global', root: plan.packageRoot, home: plan.home, templatesDir: options.templatesDir ?? join(plan.packageRoot, 'templates') });
    if (pending.has('opencode')) await appendOpenCodeAssets(adapterPlan, plan.packageRoot);
    report.fallback.push(...pending);
  }

  const codexInstalled = successful.has('codex') || plan.alreadyInstalled.includes('codex');
  if (codexInstalled && !pending.has('codex')) {
    // Codex plugin hooks are not guaranteed to fire, so preserve the global identity block.
    const templatesDir = options.templatesDir ?? join(plan.packageRoot, 'templates');
    const identityActions = instructionActions('codex', 'global', plan.packageRoot, { home: plan.home, templatesDir, brainRoot });
    if (adapterPlan) {
      adapterPlan.actions.push(...identityActions);
    } else {
      adapterPlan = {
      scope: 'global', root: plan.packageRoot, home: plan.home, templatesDir, notes: [],
        actions: identityActions,
      };
    }
  }

  let adapterManifestPath: string | undefined;
  if (adapterPlan) {
    if (adapterPlan.notes.length) report.notes = adapterPlan.notes;
    await applyInstall(adapterPlan);
    adapterManifestPath = getManifestPath('global', plan.packageRoot, plan.home);
  }
  if (pending.has('opencode')) await removeOpenCode1TuiFromCliJson(plan.home);

  await initBrain({ location: { scope: 'global', root: brainRoot }, templatesDir: options.templatesDir ?? join(plan.packageRoot, 'templates'), detected: options.detected ?? plan.clis, lang: options.lang });
  const manifestPath = join(plan.home, '.edu/plugin-setup.json');
  let previous: SetupManifest | undefined;
  try { previous = JSON.parse(await readFile(manifestPath, 'utf8')) as SetupManifest; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const manifest: SetupManifest = {
    version: 1,
    packageRoot: plan.packageRoot,
    native: [...new Set([...(previous?.native ?? []), ...report.installed])],
    fallback: [...new Set([...(previous?.fallback ?? []), ...report.fallback])],
    ...(adapterManifestPath || previous?.adapterManifestPath ? { adapterManifestPath: adapterManifestPath ?? previous?.adapterManifestPath } : {}),
  };
  await writeManifest(join(plan.home, '.edu/plugin-setup.json'), manifest);
  return report;
}

export async function setupManifestPath(home: string): Promise<string> { return join(resolve(home), '.edu/plugin-setup.json'); }

export async function uninstallSetup(options: { home: string; runner?: SetupRunner; force?: boolean }): Promise<void> {
  const path = await setupManifestPath(options.home);
  let manifest: SetupManifest;
  try { manifest = JSON.parse(await readFile(path, 'utf8')) as SetupManifest; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const runner = options.runner ?? defaultRunner;
  const commands: Record<CliId, (root: string) => SetupCommand[]> = {
    claude: () => [
      { cli: 'claude', command: 'claude', args: ['plugin', 'uninstall', 'edu@edu'] },
      { cli: 'claude', command: 'claude', args: ['plugin', 'marketplace', 'remove', 'edu'] },
    ],
    codex: () => [
      { cli: 'codex', command: 'codex', args: ['plugin', 'remove', 'edu@edu'] },
      { cli: 'codex', command: 'codex', args: ['plugin', 'marketplace', 'remove', 'edu'] },
    ],
    pi: (root) => [{ cli: 'pi', command: 'pi', args: ['remove', root] }],
    opencode: () => [],
    agy: () => [{ cli: 'agy', command: 'agy', args: ['plugin', 'uninstall', 'edu'] }],
  };
  const failures: string[] = [];
  for (const cli of manifest.native) {
    for (const command of commands[cli](manifest.packageRoot)) {
      try {
        const result = await runner(command);
        if (result.exitCode !== 0) failures.push(`${command.command} ${command.args.join(' ')} failed: ${result.stderr || result.stdout || result.exitCode}`);
      } catch (error) {
        failures.push(`${command.command} ${command.args.join(' ')} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  if (manifest.adapterManifestPath) {
    try { await uninstall({ manifestPath: manifest.adapterManifestPath, force: options.force }); }
    catch (error) {
      failures.push(`Managed adapter cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new AggregateError(failures, failures.join('\n'));
    }
  }
  await unlink(path);
  if (failures.length) throw new AggregateError(failures, failures.join('\n'));
}

export async function needsFirstRunSetup(home: string): Promise<boolean> {
  try { await access(join(home, 'config.json')); return false; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true; throw error; }
}
