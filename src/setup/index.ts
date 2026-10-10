import { eduMcpLaunch, spawnCli, type McpLaunch } from '../platform/index.js';
import { access, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { CliId } from '../core/contracts.js';
import { instructionActions } from '../adapters/common.js';
import { applyInstall, getManifestPath, planInstall, uninstall } from '../adapters/installer.js';
import type { InstallPlan, PlannedAction } from '../adapters/types.js';
import { initBrain } from '../cli/setup.js';

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
export interface SetupReport { installed: CliId[]; fallback: CliId[]; alreadyInstalled: CliId[]; failed: Array<{ cli: CliId; message: string }> }

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
export async function localizePluginsForPlatform(packageRoot: string, platform: NodeJS.Platform = process.platform): Promise<string[]> {
  if (platform !== 'win32') return [];
  const launch = eduMcpLaunch(platform);
  const targets: Array<[string, (edu: McpLaunch) => unknown]> = [
    ['plugins/claude-code/.mcp.json', edu => ({ edu })],
    ['plugins/codex/.mcp.json', edu => ({ mcpServers: { edu } })],
    ['plugins/agy/mcp_config.json', edu => ({ mcpServers: { edu } })],
  ];
  const written: string[] = [];
  for (const [relative, shape] of targets) {
    const path = join(packageRoot, relative);
    try { await access(path); } catch { continue; }
    await writeFile(path, `${JSON.stringify(shape(launch), null, 2)}\n`);
    written.push(path);
  }
  return written;
}

export async function applySetup(plan: SetupPlan, options: ApplySetupOptions = {}): Promise<SetupReport> {
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
    adapterPlan = await planInstall({ clis: [...pending], scope: 'global', root: plan.packageRoot, home: plan.home, templatesDir: options.templatesDir ?? join(plan.packageRoot, 'templates') });
    if (pending.has('opencode')) await appendOpenCodeAssets(adapterPlan, plan.packageRoot);
    report.fallback.push(...pending);
  }

  const codexInstalled = successful.has('codex') || plan.alreadyInstalled.includes('codex');
  if (codexInstalled && !pending.has('codex')) {
    // Codex plugin hooks are not guaranteed to fire, so preserve the global identity block.
    const templatesDir = options.templatesDir ?? join(plan.packageRoot, 'templates');
    const identityActions = instructionActions('codex', 'global', plan.packageRoot, { home: plan.home, templatesDir });
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
    await applyInstall(adapterPlan);
    adapterManifestPath = getManifestPath('global', plan.packageRoot, plan.home);
  }

  const brainRoot = resolve(options.brainRoot ?? process.env.EDU_HOME ?? join(plan.home, '.edu'));
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
