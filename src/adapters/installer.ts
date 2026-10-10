import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CliId, InstallAction, InstallManifest, InstallScope } from '../core/contracts.js';
import { createClaudeIntegration } from './claude.js';
import { createCodexIntegration } from './codex.js';
import { createPiIntegration } from './pi.js';
import { createOpenCodeIntegration } from './opencode.js';
import { createAgyIntegration } from './agy.js';
import { ensureParents, materialize, readTarget, sha256 } from './operations.js';
import { removeManagedBlock } from './blocks.js';
import { unmergeJson, unmergeToml } from './merge.js';
import { CLI_IDS, type InstallPlan, type PlannedAction } from './types.js';

interface StoredAction extends InstallAction { clis?: CliId[]; shared?: boolean; jsonPatch?: Record<string, unknown>; tomlBody?: string }
interface StoredManifest extends InstallManifest { actions: StoredAction[]; createdDirs?: string[]; home?: string }
interface SharedTarget { sha256: string; owners: string[]; backup?: string }
interface SharedRegistry { version: 1; targets: Record<string, SharedTarget>; createdDirs: string[] }

function sharedRegistryPath(home: string): string { return join(home, '.edu/shared-targets.json'); }

/**
 * Whether an Edu-managed target is still as Edu left it. For JSON merges Edu owns only its patched
 * keys: host CLIs rewrite files such as ~/.claude.json constantly, so a whole-file hash would report
 * drift on every run. Everything else is compared byte for byte.
 */
function isIntact(action: StoredAction, current: Buffer | undefined): boolean {
  if (!current) return false;
  if (action.kind === 'json-merge' && action.jsonPatch) {
    try { return containsPatch(JSON.parse(current.toString('utf8')), action.jsonPatch); } catch { return false; }
  }
  return Boolean(action.sha256) && sha256(current) === action.sha256;
}

function containsPatch(target: unknown, patch: unknown): boolean {
  if (Array.isArray(patch)) {
    return Array.isArray(target) && patch.every(item => target.some(candidate => JSON.stringify(candidate) === JSON.stringify(item)));
  }
  if (patch && typeof patch === 'object') {
    if (!target || typeof target !== 'object') return false;
    return Object.entries(patch as Record<string, unknown>).every(([key, value]) => containsPatch((target as Record<string, unknown>)[key], value));
  }
  return JSON.stringify(target) === JSON.stringify(patch);
}

function isSharedTarget(path: string, home: string): boolean {
  return path === join(home, '.codex/config.toml') || path === join(home, '.pi/agent/mcp.json');
}

async function loadSharedRegistry(home: string): Promise<SharedRegistry> {
  const path = sharedRegistryPath(home);
  const content = await readTarget(path);
  if (!content) return { version: 1, targets: {}, createdDirs: [] };
  const value: unknown = JSON.parse(content.toString('utf8'));
  if (!value || typeof value !== 'object' || (value as SharedRegistry).version !== 1 ||
      !(value as SharedRegistry).targets || !Array.isArray((value as SharedRegistry).createdDirs)) {
    throw new Error(`Invalid Edu shared-target registry: ${path}`);
  }
  return value as SharedRegistry;
}

async function saveSharedRegistry(home: string, registry: SharedRegistry): Promise<void> {
  const path = sharedRegistryPath(home);
  if (!Object.keys(registry.targets).length) {
    await unlink(path).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
    return;
  }
  await ensureParents(path, registry.createdDirs);
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(registry, null, 2)}\n`);
  await rename(temp, path);
}

export interface PlanInstallOptions {
  clis: CliId[] | 'all';
  scope: InstallScope;
  root: string;
  home?: string;
  templatesDir?: string;
}

/** Walk toward the package root, working from both src/ and bundled dist/. */
export function resolveTemplatesDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (true) {
    const packagePath = join(dir, 'package.json');
    if (existsSync(packagePath)) {
      try {
        const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as { name?: string };
        if (pkg.name === 'edu-agent') return join(dir, 'templates');
      } catch { /* Keep walking. */ }
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Could not locate edu-agent package root');
    dir = parent;
  }
}

export function getManifestPath(scope: InstallScope, root: string, home: string): string {
  return join(scope === 'project' ? root : home, '.edu/manifest.json');
}

export async function planInstall(options: PlanInstallOptions): Promise<InstallPlan> {
  const root = resolve(options.root);
  const home = resolve(options.home ?? homedir());
  const templatesDir = resolve(options.templatesDir ?? resolveTemplatesDir());
  const clis = options.clis === 'all' ? CLI_IDS : [...new Set(options.clis)];
  for (const cli of clis) if (!CLI_IDS.includes(cli)) throw new Error(`Unknown CLI: ${cli}`);
  const settings = { home, templatesDir };
  const integrations = {
    claude: createClaudeIntegration(settings), codex: createCodexIntegration(settings),
    pi: createPiIntegration(settings), opencode: createOpenCodeIntegration(settings), agy: createAgyIntegration(settings),
  };
  const actions: PlannedAction[] = [];
  const seen = new Map<string, PlannedAction>();
  for (const cli of clis) {
    for (const action of await integrations[cli].plan(options.scope, root) as PlannedAction[]) {
      if (!isAbsolute(action.path)) throw new Error(`Non-absolute target: ${action.path}`);
      const key = `${action.kind}:${action.path}`;
      const prior = seen.get(key);
      if (prior) {
        if (JSON.stringify({ content: prior.content, jsonPatch: prior.jsonPatch, tomlBody: prior.tomlBody }) !== JSON.stringify({ content: action.content, jsonPatch: action.jsonPatch, tomlBody: action.tomlBody })) {
          throw new Error(`Conflicting shared action: ${action.path}`);
        }
        prior.clis = [...new Set([...(prior.clis ?? [prior.cli]), action.cli])];
        continue;
      }
      seen.set(key, action);
      actions.push(action);
    }
  }
  return { scope: options.scope, root, home, templatesDir, actions, notes: clis.includes('agy') ? ['agy MCP: manual step'] : [] };
}

export function describePlan(plan: InstallPlan): string {
  return [
    `Edu ${plan.scope} installation: ${plan.actions.length} file actions`,
    ...plan.actions.map(action => `- ${action.cli}: ${action.description} → ${action.path}`),
    ...plan.notes.map(note => `Note: ${note}`),
  ].join('\n');
}

async function loadManifest(path: string): Promise<StoredManifest | undefined> {
  const content = await readTarget(path);
  if (!content) return undefined;
  const value: unknown = JSON.parse(content.toString('utf8'));
  if (!value || typeof value !== 'object' || (value as StoredManifest).version !== 1 || !Array.isArray((value as StoredManifest).actions)) {
    throw new Error(`Invalid Edu manifest: ${path}`);
  }
  return value as StoredManifest;
}

function publicAction(action: PlannedAction, hash: string, backup?: string, shared = false): StoredAction {
  return { cli: action.cli, clis: action.clis ?? [action.cli], kind: action.kind, path: action.path, description: action.description, sha256: hash, ...(backup ? { backup } : {}), ...(shared ? { shared: true } : {}), ...(action.jsonPatch ? { jsonPatch: action.jsonPatch } : {}), ...(action.tomlBody ? { tomlBody: action.tomlBody } : {}) };
}

export async function applyInstall(plan: InstallPlan): Promise<InstallManifest> {
  const manifestPath = getManifestPath(plan.scope, plan.root, plan.home);
  const previous = await loadManifest(manifestPath);
  if (previous && previous.scope !== plan.scope) throw new Error('Existing manifest has a different scope');
  const shared = await loadSharedRegistry(plan.home);
  const otherScope: InstallScope = plan.scope === 'project' ? 'global' : 'project';
  const otherPath = getManifestPath(otherScope, plan.root, plan.home);
  if (otherPath !== manifestPath) {
    const other = await loadManifest(otherPath);
    const otherTargets = new Set(other?.actions.map(action => action.path) ?? []);
    const conflict = plan.actions.find(action => otherTargets.has(action.path) && (!isSharedTarget(action.path, plan.home) || !shared.targets[action.path]));
    if (conflict) throw new Error(`Target already managed by ${otherScope} installation: ${conflict.path}`);
  }
  const existing = new Map((previous?.actions ?? []).map(action => [`${action.kind}:${action.path}`, action]));
  // Refuse drift before any write, including actions omitted from a repeat install.
  for (const action of previous?.actions ?? []) {
    const current = await readTarget(action.path);
    if (!isIntact(action, current)) throw new Error(`Edu installation drift: ${action.path}`);
    if (action.shared && !shared.targets[action.path]?.owners.includes(manifestPath)) throw new Error(`Missing shared ownership: ${action.path}`);
  }
  const paths = new Set<string>();
  const prepared = await Promise.all(plan.actions.map(async action => {
    if (paths.has(action.path)) throw new Error(`Multiple operations target ${action.path}`);
    paths.add(action.path);
    const before = await readTarget(action.path);
    const after = materialize(action, before);
    const owner = shared.targets[action.path];
    if (isSharedTarget(action.path, plan.home) && owner) {
      if (!before || sha256(before) !== owner.sha256) throw new Error(`Edu installation drift: ${action.path}`);
      if (sha256(after) !== owner.sha256 && owner.owners.some(path => path !== manifestPath)) {
        throw new Error(`Shared target has another owner: ${action.path}`);
      }
    }
    return { action, before, after, prior: existing.get(`${action.kind}:${action.path}`) };
  }));
  const packageFile = join(dirname(resolveTemplatesDir()), 'package.json');
  const pkg = JSON.parse(await readFile(packageFile, 'utf8')) as { version: string };
  const createdDirs = [...(previous?.createdDirs ?? [])];
  const nextActions = [...(previous?.actions ?? [])];
  const backupStamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const legacyBackups: string[] = [];
  let sharedChanged = false;
  for (const [index, { action, before, after, prior }] of prepared.entries()) {
    const key = `${action.kind}:${action.path}`;
    if (isSharedTarget(action.path, plan.home)) {
      let target = shared.targets[action.path];
      if (!target && before?.equals(after) && !prior) throw new Error(`Untracked shared Edu target: ${action.path}`);
      if (!target) {
        let backup: string | undefined;
        if (prior?.backup) {
          backup = join(plan.home, '.edu/shared-backups', `${backupStamp}-${index}-${basename(action.path)}`);
          await ensureParents(backup, shared.createdDirs);
          await writeFile(backup, await readFile(prior.backup));
          legacyBackups.push(prior.backup);
        } else if (before) {
          backup = join(plan.home, '.edu/shared-backups', `${backupStamp}-${index}-${basename(action.path)}`);
          await ensureParents(backup, shared.createdDirs);
          await writeFile(backup, before);
        }
        target = { sha256: sha256(after), owners: [], ...(backup ? { backup } : {}) };
        shared.targets[action.path] = target;
      }
      if (!before?.equals(after)) {
        await ensureParents(action.path, shared.createdDirs);
        await writeFile(action.path, after);
        target.sha256 = sha256(after);
      }
      if (!target.owners.includes(manifestPath)) target.owners.push(manifestPath);
      const owners = [...new Set([...(prior?.clis ?? (prior ? [prior.cli] : [])), ...(action.clis ?? [action.cli])])];
      const saved = publicAction({ ...action, clis: owners }, target.sha256, target.backup, true);
      const oldIndex = nextActions.findIndex(item => `${item.kind}:${item.path}` === key);
      if (oldIndex >= 0) nextActions[oldIndex] = saved;
      else nextActions.push(saved);
      sharedChanged = true;
      continue;
    }
    if (before?.equals(after)) {
      if (prior) {
        const oldIndex = nextActions.findIndex(item => `${item.kind}:${item.path}` === key);
        nextActions[oldIndex] = { ...prior, clis: [...new Set([...(prior.clis ?? [prior.cli]), ...(action.clis ?? [action.cli])])] };
      }
      continue;
    }
    let backup = prior?.backup;
    if (before && !prior) {
      backup = join(dirname(manifestPath), 'backups', backupStamp, `${index}-${basename(action.path)}`);
      await ensureParents(backup, createdDirs);
      await writeFile(backup, before);
    }
    await ensureParents(action.path, createdDirs);
    await writeFile(action.path, after);
    const owners = [...new Set([...(prior?.clis ?? (prior ? [prior.cli] : [])), ...(action.clis ?? [action.cli])])];
    const saved = publicAction({ ...action, clis: owners }, sha256(after), backup);
    const oldIndex = nextActions.findIndex(item => `${item.kind}:${item.path}` === key);
    if (oldIndex >= 0) nextActions[oldIndex] = saved;
    else nextActions.push(saved);
  }
  const manifest: StoredManifest = {
    version: 1, eduVersion: pkg.version, installedAt: previous?.installedAt ?? new Date().toISOString(),
    scope: plan.scope, actions: nextActions, createdDirs, home: plan.home,
  };
  await ensureParents(manifestPath, createdDirs);
  manifest.createdDirs = createdDirs;
  if (sharedChanged) await saveSharedRegistry(plan.home, shared);
  const temp = `${manifestPath}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(temp, manifestPath);
  for (const backup of legacyBackups) await unlink(backup);
  return manifest;
}

export async function uninstall(options: { manifestPath: string; force?: boolean }): Promise<void> {
  const manifest = await loadManifest(options.manifestPath);
  if (!manifest) throw new Error(`Edu manifest not found: ${options.manifestPath}`);
  if (options.force) {
    for (const action of manifest.actions) {
      if (action.kind !== 'json-merge' || action.jsonPatch) continue;
      const current = await readTarget(action.path);
      if (!current || !action.sha256 || sha256(current) !== action.sha256) {
        throw new Error(`Cannot safely force-uninstall legacy JSON merge without ownership metadata: ${action.path}`);
      }
    }
  }
  const shared = manifest.home ? await loadSharedRegistry(manifest.home) : undefined;
  for (const action of manifest.actions.filter(action => action.shared)) {
    if (!shared?.targets[action.path]?.owners.includes(options.manifestPath)) {
      throw new Error(`Missing shared ownership: ${action.path}`);
    }
  }
  if (!options.force) {
    for (const action of manifest.actions) {
      const current = await readTarget(action.path);
      if (!isIntact(action, current)) throw new Error(`Edu installation drift: ${action.path}`);
    }
  }
  const sharedBackups: string[] = [];
  let sharedChanged = false;
  for (const action of [...manifest.actions].reverse()) {
    if (action.shared) {
      const target = shared!.targets[action.path]!;
      target.owners = target.owners.filter(owner => owner !== options.manifestPath);
      if (!target.owners.length) {
        const current = await readTarget(action.path);
        if (current && action.kind === 'json-merge' && action.jsonPatch) {
          const remaining = unmergeJson(current.toString('utf8'), action.jsonPatch);
          if (!options.force && target.backup) await writeFile(action.path, await readFile(target.backup));
          else if (options.force && target.backup) await writeFile(action.path, remaining);
          else if (isEmptyJson(remaining)) await unlink(action.path).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
          else await writeFile(action.path, remaining);
          if (!options.force && target.backup) sharedBackups.push(target.backup);
        } else if (current && action.kind === 'toml-merge') {
          const remaining = unmergeToml(current.toString('utf8'));
          if (!options.force && target.backup) await writeFile(action.path, await readFile(target.backup));
          else if (options.force && target.backup) await writeFile(action.path, remaining);
          else if (!remaining.trim()) await unlink(action.path).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
          else await writeFile(action.path, remaining);
          if (!options.force && target.backup) sharedBackups.push(target.backup);
        } else if (current && action.kind === 'managed-block') {
          const remaining = removeManagedBlock(current.toString('utf8'));
          if (options.force && target.backup) await writeFile(action.path, remaining);
          else if (!remaining.trim()) await unlink(action.path).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
          else await writeFile(action.path, remaining);
        } else if (target.backup) {
          await writeFile(action.path, await readFile(target.backup));
          sharedBackups.push(target.backup);
        } else {
          await unlink(action.path).catch(error => {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          });
        }
        delete shared!.targets[action.path];
      }
      sharedChanged = true;
      continue;
    }
    const current = await readTarget(action.path);
    if (!options.force && action.backup) {
      await writeFile(action.path, await readFile(action.backup));
    } else if (action.kind === 'managed-block' && current) {
      const remaining = removeManagedBlock(current.toString('utf8'));
      if (!remaining.trim() && options.force && action.backup) await writeFile(action.path, remaining);
      else if (!remaining.trim()) await unlink(action.path).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
      else await writeFile(action.path, remaining);
    } else if (action.kind === 'json-merge' && current && action.jsonPatch) {
      const remaining = unmergeJson(current.toString('utf8'), action.jsonPatch);
      if (options.force && action.backup) await writeFile(action.path, remaining);
      else if (isEmptyJson(remaining)) await unlink(action.path).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
      else await writeFile(action.path, remaining);
    } else if (action.kind === 'toml-merge' && current) {
      const remaining = unmergeToml(current.toString('utf8'));
      if (options.force && action.backup) await writeFile(action.path, remaining);
      else if (!remaining.trim()) await unlink(action.path).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
      else await writeFile(action.path, remaining);
    } else if (action.backup) {
      const original = await readFile(action.backup);
      await writeFile(action.path, original);
    } else {
      await unlink(action.path).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
    }
  }
  for (const backup of manifest.actions.filter(action => !action.shared).map(action => action.backup).filter((value): value is string => !!value)) await unlink(backup);
  await unlink(options.manifestPath);
  if (sharedChanged) {
    await saveSharedRegistry(manifest.home!, shared!);
    for (const backup of sharedBackups) await unlink(backup);
  }
  for (const dir of [...(manifest.createdDirs ?? [])].reverse()) {
    await rmdir(dir).catch(error => {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    });
  }
  if (sharedChanged && !Object.keys(shared!.targets).length) {
    for (const dir of [...shared!.createdDirs].reverse()) {
      await rmdir(dir).catch(error => {
        if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      });
    }
  }
}

function isEmptyJson(value: string): boolean {
  try { return Object.keys(JSON.parse(value) as Record<string, unknown>).length === 0; }
  catch { return false; }
}
