/**
 * `edu connect hermes`: register Edu's MCP server in Hermes (~/.hermes/config.yaml).
 *
 * Facts this relies on (Hermes source, hermes-agent):
 * - stdio MCP servers live under top-level `mcp_servers.<name>` with `command`, `args`, `timeout`,
 *   `connect_timeout`, `enabled` (tools/mcp_tool.py). Hermes spawns them with a filtered environment
 *   (PATH, HOME, USER, LANG, LC_ALL, TERM, SHELL, TMPDIR, XDG_*) plus the entry's own `env`.
 * - Every enabled MCP server reaches every platform, Telegram included, unless that platform's
 *   `platform_toolsets` list names MCP servers explicitly (then it is an allowlist) or contains
 *   `no_mcp` (hermes_cli/tools_config.py `_get_platform_tools`).
 * - `hermes mcp add` asks questions on stdin and rewrites the whole file, so Edu edits the YAML
 *   itself with a minimal text splice and keeps a byte-exact backup for `--undo`.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { isMap, isScalar, isSeq } from 'yaml';
import { whichSync, type McpLaunch } from '../platform/index.js';
import { appendToSequence, findPair, parseYaml, removeNestedEntry, sameValue, setNestedEntry } from './yaml.js';

export const HERMES_SERVER = 'edu';

export function hermesConfigPath(env: NodeJS.ProcessEnv, home: string, explicit?: string): string {
  if (explicit) return resolve(explicit);
  const hermesHome = env.HERMES_HOME?.trim();
  return join(hermesHome ? resolve(hermesHome) : join(home, '.hermes'), 'config.yaml');
}

export interface HermesEntry { command: string; args: string[]; timeout: number; connect_timeout: number; enabled: boolean }

export function hermesEntry(launch: McpLaunch, project?: string): HermesEntry {
  return { command: launch.command, args: [...launch.args, ...(project ? ['--project', project] : [])], timeout: 120, connect_timeout: 60, enabled: true };
}

export interface DeadServer { name: string; command: string }

/** MCP servers whose stdio command no longer exists (absolute path missing, or bare name not on PATH). */
export function deadServers(text: string, commandExists: (command: string) => boolean): DeadServer[] {
  const servers = findPair(parseYaml(text).contents as never, 'mcp_servers')?.value;
  if (!isMap(servers)) return [];
  const dead: DeadServer[] = [];
  for (const pair of servers.items) {
    if (!isScalar(pair.key) || pair.key.value === HERMES_SERVER || !isMap(pair.value)) continue;
    const command = pair.value.get('command');
    if (typeof command === 'string' && command.trim() && !commandExists(command.trim())) dead.push({ name: String(pair.key.value), command });
  }
  return dead;
}

export function commandExistsOn(env: NodeJS.ProcessEnv, home: string): (command: string) => boolean {
  return (command) => {
    const expanded = command.startsWith('~/') ? join(home, command.slice(2)) : command;
    return isAbsolute(expanded) || /[\\/]/.test(expanded) ? existsSync(expanded) : Boolean(whichSync(expanded, env));
  };
}

export interface HermesPlan { before: string; after: string; changes: string[]; dead: DeadServer[]; warnings: string[] }

/**
 * Pure planning: the config text Edu would write. Idempotent — planning against its own output
 * yields no changes.
 */
export function planHermesConnect(before: string, input: { entry: HermesEntry; removeDead?: boolean; commandExists: (command: string) => boolean }): HermesPlan {
  const changes: string[] = [];
  const warnings: string[] = [];
  let after = before;
  const current = (parseYaml(before).toJS() as Record<string, Record<string, unknown> | undefined> | null)?.mcp_servers?.[HERMES_SERVER];
  if (!sameValue(current, input.entry)) {
    after = setNestedEntry(after, 'mcp_servers', HERMES_SERVER, input.entry);
    changes.push(current === undefined ? 'add mcp_servers.edu' : 'update mcp_servers.edu');
  }
  const dead = deadServers(after, input.commandExists);
  if (input.removeDead) {
    for (const server of dead) {
      after = removeNestedEntry(after, 'mcp_servers', server.name);
      changes.push(`remove dead mcp_servers.${server.name} (${server.command} not found)`);
    }
  }
  // Telegram: an explicit MCP name in its toolset list turns the list into an allowlist.
  const doc = parseYaml(after);
  const servers = findPair(doc.contents as never, 'mcp_servers')?.value;
  const serverNames = new Set(isMap(servers) ? servers.items.map(pair => String((pair.key as { value: unknown }).value)) : []);
  const toolsets = findPair(doc.contents as never, 'platform_toolsets')?.value;
  const telegram = isMap(toolsets) ? toolsets.get('telegram') : undefined;
  if (isSeq(telegram)) {
    const names = telegram.items.map(item => (isScalar(item) ? String(item.value) : ''));
    if (names.includes('no_mcp')) warnings.push('platform_toolsets.telegram contains no_mcp: Telegram sees no MCP tools. Remove no_mcp to use Edu from Telegram.');
    else if (names.some(name => name !== HERMES_SERVER && serverNames.has(name)) && !names.includes(HERMES_SERVER)) {
      const next = appendToSequence(after, 'platform_toolsets', 'telegram', HERMES_SERVER);
      if (next !== after) { after = next; changes.push('allow edu in platform_toolsets.telegram'); }
    }
  }
  return { before, after, changes, dead: input.removeDead ? [] : dead, warnings };
}

// ── Backups: byte-exact, like `edu detach` ─────────────────────────────────────────────────────

export interface ConnectManifest { id: string; target: 'hermes'; path: string; createdAt: string; sha256Before: string; sha256After: string; changes: string[]; undoneAt?: string }

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const backupRoot = (eduHome: string) => join(eduHome, 'backups', 'connect');

/** Atomic replace that keeps the file's permission bits (Hermes configs can hold secrets). */
async function atomicWrite(path: string, data: string | Buffer): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  let mode = 0o600;
  try { mode = (await stat(path)).mode & 0o777; } catch { /* new file: owner-only */ }
  try { await writeFile(temp, data, { mode }); await chmod(temp, mode); await rename(temp, path); }
  catch (error) { await rm(temp, { force: true }); throw error; }
}

/** Writes the plan after saving the original bytes; refuses when the file changed since planning. */
export async function applyHermesPlan(eduHome: string, path: string, plan: HermesPlan): Promise<ConnectManifest> {
  const original = await readFile(path);
  if (original.toString('utf8') !== plan.before) throw new Error(`Hermes config changed since planning: ${path}`);
  const id = `hermes-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const dir = join(backupRoot(eduHome), id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'config.yaml'), original, { mode: 0o600 });
  const manifest: ConnectManifest = { id, target: 'hermes', path, createdAt: new Date().toISOString(), sha256Before: sha256(original), sha256After: sha256(plan.after), changes: plan.changes };
  await writeFile(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await atomicWrite(path, plan.after);
  return manifest;
}

export async function listHermesBackups(eduHome: string): Promise<ConnectManifest[]> {
  let ids: string[];
  try { ids = (await readdir(backupRoot(eduHome))).filter(id => /^hermes-[\w-]+$/.test(id)).sort().reverse(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const manifests: ConnectManifest[] = [];
  for (const id of ids) {
    try { manifests.push(JSON.parse(await readFile(join(backupRoot(eduHome), id, 'manifest.json'), 'utf8')) as ConnectManifest); }
    catch { /* incomplete backup folder */ }
  }
  return manifests.filter(manifest => !manifest.undoneAt);
}

/** Restores the latest (or named) backup byte for byte; refuses a file edited since unless forced. */
export async function undoHermes(eduHome: string, input: { id?: string; path?: string; force?: boolean } = {}): Promise<ConnectManifest> {
  const active = await listHermesBackups(eduHome);
  const manifest = input.id ? active.find(m => m.id === input.id) : active.find(m => !input.path || resolve(m.path) === resolve(input.path));
  if (!manifest) throw new Error('No Hermes connect backup to restore.');
  const dir = join(backupRoot(eduHome), manifest.id);
  const original = await readFile(join(dir, 'config.yaml'));
  if (sha256(original) !== manifest.sha256Before) throw new Error(`Backup checksum mismatch: ${dir}`);
  let current: Buffer | undefined;
  try { current = await readFile(manifest.path); } catch { current = undefined; }
  if (!input.force && (!current || sha256(current) !== manifest.sha256After)) {
    throw new Error(`Refusing to overwrite ${manifest.path}: it changed after edu connect (Hermes or you edited it). Use --force to restore the backup anyway.`);
  }
  await mkdir(dirname(manifest.path), { recursive: true });
  await atomicWrite(manifest.path, original);
  manifest.undoneAt = new Date().toISOString();
  await writeFile(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
