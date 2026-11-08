/**
 * Host registration rollback for native plugin re-registration (relocated package roots, reinstalls).
 *
 * The hosts give the marketplace a fixed name (`edu`), so a new registration cannot be added next to
 * the old one. Before the first destructive host command, the previous registration is recorded in
 * `~/.edu/state/plugin-recovery.json`. On any later failure, public host commands re-register the
 * previous source. When that also fails, the record stays, the error names the exact restore commands,
 * and the next `edu setup` repairs the registration before planning anything else.
 */
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { SetupResult, SetupRunner } from './index.js';

export type RecoverableHost = 'claude' | 'codex' | 'pi';

export interface RecoveryRecord {
  host: RecoverableHost;
  startedAt: string;
  /** The registration that worked before: marketplace (Claude, Codex) or package (Pi) source root. */
  previous: { root: string; pluginId?: string; version?: string; scope?: string; enabled?: boolean };
  /** The package root the interrupted refresh was registering. */
  target: string;
  /** Host commands that completed before the failure. */
  completed: string[];
}

interface RecoveryFile { version: 1; hosts: Partial<Record<RecoverableHost, RecoveryRecord>> }

export function pluginRecoveryPath(home: string): string { return join(resolve(home), '.edu/state/plugin-recovery.json'); }

async function readRecoveryFile(home: string): Promise<RecoveryFile> {
  try {
    const parsed = JSON.parse(await readFile(pluginRecoveryPath(home), 'utf8')) as RecoveryFile;
    if (parsed?.version !== 1 || typeof parsed.hosts !== 'object' || !parsed.hosts) throw new Error(`Invalid plugin recovery record: ${pluginRecoveryPath(home)}`);
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, hosts: {} };
    throw error;
  }
}

export async function readRecovery(home: string, host: RecoverableHost): Promise<RecoveryRecord | undefined> {
  return (await readRecoveryFile(home)).hosts[host];
}

async function storeRecovery(home: string, host: RecoverableHost, record: RecoveryRecord | undefined): Promise<void> {
  const path = pluginRecoveryPath(home);
  const file = await readRecoveryFile(home);
  if (record) file.hosts[host] = record; else delete file.hosts[host];
  if (!Object.keys(file.hosts).length) {
    await unlink(path).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`);
  await rename(temporary, path);
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

/** Public host commands that re-register `root`; for Pi, `other` is the package to drop. */
export function restoreCommands(host: RecoverableHost, root: string, other?: string): string[][] {
  if (host === 'claude') return [['plugin', 'uninstall', 'edu@edu', '--scope', 'user'], ['plugin', 'marketplace', 'remove', 'edu'], ['plugin', 'marketplace', 'add', root], ['plugin', 'install', 'edu@edu', '--scope', 'user']];
  if (host === 'codex') return [['plugin', 'remove', 'edu@edu'], ['plugin', 'marketplace', 'remove', 'edu'], ['plugin', 'marketplace', 'add', root], ['plugin', 'add', 'edu@edu', '--json']];
  return [...(other && other !== root ? [['remove', other]] : []), ['install', root]];
}

/** Leading commands that only clear a partial registration; their failure is expected and ignored. */
function cleanupCount(host: RecoverableHost, root: string, other?: string): number {
  return host === 'pi' ? (other && other !== root ? 1 : 0) : 2;
}

function quote(arg: string): string { return /^[\w@%+=:,./\\-]+$/.test(arg) ? arg : `"${arg.replaceAll('"', '\\"')}"`; }
function shell(host: RecoverableHost, args: string[]): string { return [host, ...args].map(quote).join(' '); }

function json(result: SetupResult): unknown {
  if (result.exitCode !== 0) throw new Error(`host list exit ${result.exitCode}`);
  return JSON.parse(result.stdout ?? '');
}

/** True when the host's live registration points at `root` (and, for Pi, no longer at `other`). */
export async function registeredAt(host: RecoverableHost, runner: SetupRunner, root: string, other?: string): Promise<boolean> {
  const run = (args: string[]) => runner({ cli: host, command: host, args });
  if (host === 'pi') {
    const listed = await run(['list']);
    if (listed.exitCode !== 0) throw new Error(`pi list exit ${listed.exitCode}`);
    const lines = (listed.stdout ?? '').split(/\r?\n/).map(line => line.trim());
    return lines.includes(root) && (!other || other === root || !lines.includes(other));
  }
  if (host === 'codex') {
    const parsed = json(await run(['plugin', 'list', '--json'])) as { installed?: Array<Record<string, any>> };
    const matches = Array.isArray(parsed?.installed) ? parsed.installed.filter(e => e?.pluginId === 'edu@edu') : [];
    const entry = matches[0];
    return matches.length === 1 && entry!.installed === true && entry!.enabled === true && entry!.marketplaceSource?.sourceType === 'local' &&
      entry!.marketplaceSource.source === root && entry!.source?.path === join(root, 'plugins/codex');
  }
  const plugins = json(await run(['plugin', 'list', '--json']));
  const entries = Array.isArray(plugins) ? plugins.filter(e => e?.id === 'edu@edu') : [];
  if (entries.length !== 1 || entries[0].scope !== 'user' || entries[0].enabled !== true || entries[0].errors?.length) return false;
  const markets = json(await run(['plugin', 'marketplace', 'list', '--json']));
  const edu = Array.isArray(markets) ? markets.filter(m => m?.name === 'edu') : [];
  return edu.length === 1 && edu[0].source === 'directory' && edu[0].path === root;
}

/** Re-registers `root` through public commands and verifies it; throws when the host does not end there. */
async function reRegister(host: RecoverableHost, runner: SetupRunner, root: string, other?: string): Promise<void> {
  if (await registeredAt(host, runner, root, other).catch(() => false)) return;
  if (!(await exists(root))) throw new Error(`the source ${root} no longer exists`);
  const commands = restoreCommands(host, root, other);
  const ignorable = cleanupCount(host, root, other);
  for (const [index, args] of commands.entries()) {
    let result: SetupResult;
    try { result = await runner({ cli: host, command: host, args }); }
    catch (error) { if (index < ignorable) continue; throw new Error(`${shell(host, args)}: ${error instanceof Error ? error.message : error}`); }
    if (result.exitCode !== 0 && index >= ignorable) throw new Error(`${shell(host, args)}: host exit ${result.exitCode}: ${(result.stderr ?? '').trim()}`);
  }
  if (!(await registeredAt(host, runner, root, other))) throw new Error(`the ${host} registration does not point at ${root} after restore`);
}

function instructions(host: RecoverableHost, root: string, other?: string): string {
  return restoreCommands(host, root, other).map(args => shell(host, args)).join(' && ');
}

/**
 * Runs the destructive part of a native refresh with a persisted recovery record. `body` receives a
 * `step` that runs one host command and fails on a non-zero exit. On success the record is removed;
 * on failure the previous registration is restored, or the record is kept with exact instructions.
 */
export async function withRegistrationRecovery(
  options: { host: RecoverableHost; home: string; runner: SetupRunner; previous: RecoveryRecord['previous']; target: string },
  body: (step: (args: string[]) => Promise<SetupResult>) => Promise<void>,
): Promise<void> {
  const { host, home, runner, previous, target } = options;
  const record: RecoveryRecord = { host, startedAt: new Date().toISOString(), previous, target, completed: [] };
  // Persist before the first destructive step: a crash from here on is still repairable.
  await storeRecovery(home, host, record);
  const step = async (args: string[]): Promise<SetupResult> => {
    const result = await runner({ cli: host, command: host, args });
    if (result.exitCode !== 0) throw new Error(`${host} ${args.join(' ')}: host exit ${result.exitCode}: ${(result.stderr ?? '').trim()}`);
    record.completed.push(args.join(' '));
    await storeRecovery(home, host, record);
    return result;
  };
  try {
    await body(step);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const other = host === 'pi' ? target : undefined;
    try {
      await reRegister(host, runner, previous.root, other);
    } catch (rollback) {
      throw new Error(`${message}. Rollback failed: ${rollback instanceof Error ? rollback.message : rollback}. ` +
        `The previous registration is recorded in ${pluginRecoveryPath(home)}; restore it with: ${instructions(host, previous.root, other)} ` +
        '(or run edu setup again, which repairs it first)');
    }
    await storeRecovery(home, host, undefined);
    throw new Error(`${message}. Rolled back to the previous ${host} registration (${previous.root})`);
  }
  await storeRecovery(home, host, undefined);
}

/**
 * Repairs a registration a previous run left behind (rollback failed or the process died mid-way).
 * Ends at the previous registration when its source still exists, else at the current package.
 * Clears the record on success; otherwise throws a manual conflict with the exact commands.
 */
export async function resumeRegistrationRecovery(options: { host: RecoverableHost; home: string; runner: SetupRunner; packageRoot: string }): Promise<'none' | 'completed' | 'restored'> {
  const { host, home, runner, packageRoot } = options;
  const record = await readRecovery(home, host);
  if (!record) return 'none';
  const previous = record.previous.root;
  // The interrupted refresh may have finished before the process stopped.
  if (record.target === packageRoot && await registeredAt(host, runner, packageRoot, host === 'pi' && previous !== packageRoot ? previous : undefined).catch(() => false)) {
    await storeRecovery(home, host, undefined);
    return 'completed';
  }
  const root = await exists(previous) ? previous : packageRoot;
  const other = host === 'pi' ? (root === previous ? record.target : previous) : undefined;
  try { await reRegister(host, runner, root, other); }
  catch (error) {
    throw new Error(`Manual conflict: ${host} plugin registration is incomplete after an interrupted refresh (${pluginRecoveryPath(home)}): ` +
      `${error instanceof Error ? error.message : error}. Restore it with: ${instructions(host, root, other)}`);
  }
  await storeRecovery(home, host, undefined);
  return root === previous ? 'restored' : 'completed';
}
