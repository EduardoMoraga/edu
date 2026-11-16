import { configuredBases, installDirs, pinConfiguredBases, sharedTargetPaths } from './paths.js';
import { assertContained } from '../skills/bundle.js';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import type { CliId, InstallAction, InstallManifest, InstallScope } from '../core/contracts.js';
import { packageTemplatesDir, packageVersion } from '../platform/package.js';
import { createClaudeIntegration } from './claude.js';
import { createCodexIntegration } from './codex.js';
import { createPiIntegration } from './pi.js';
import { createOpenCodeIntegration } from './opencode.js';
import { createAgyIntegration } from './agy.js';
import { ensureParents, materialize, readTarget, sha256, FileTransaction, validateBundleAction } from './operations.js';
import { managedBlock, managedBlockBody, removeManagedBlock, sectionDigest, upsertManagedBlock } from './blocks.js';
import { containsPatch, EDU_MCP_TOML_PATH, mergeToml, parseJsonFile, resolveJsonPatch, tomlDefines, tomlSectionsDigest, unmergeJsonFile, unmergeToml, withoutTomlTable } from './merge.js';
import { withInstallLock } from './install-lock.js';
import { CLI_IDS, type InstallPlan, type PlannedAction, type RetiredAction } from './types.js';

interface StoredAction extends InstallAction {
  bundle?: Omit<NonNullable<PlannedAction['bundle']>, 'source'>; clis?: CliId[]; shared?: boolean; jsonPatch?: Record<string, unknown>; tomlBody?: string;
  /** Digest of Edu's own block or TOML sections as Edu wrote them (line endings normalized). */
  blockSha256?: string;
}
interface StoredManifest extends InstallManifest { actions: StoredAction[]; createdDirs?: string[]; home?: string }
interface SharedTarget { sha256: string; owners: string[]; backup?: string }
interface SharedRegistry { version: 1; targets: Record<string, SharedTarget>; createdDirs: string[] }

function sharedRegistryPath(home: string): string { return join(home, '.edu/shared-targets.json'); }

/** Edu's own part of a file Edu shares with the user: the managed block or the TOML sections. */
function ownDigest(kind: InstallAction['kind'], content: Buffer): string | undefined {
  const text = content.toString('utf8');
  try {
    if (kind === 'managed-block') { const block = managedBlock(text); return block === undefined ? undefined : sectionDigest(block); }
    if (kind === 'toml-merge') return tomlSectionsDigest(text);
  } catch { /* A malformed block is not Edu's. */ }
  return undefined;
}

/**
 * Whether Edu's own part of a target is still as Edu left it. Only that part counts: host CLIs rewrite
 * files such as ~/.claude.json or ~/.codex/config.toml (trust entries) all the time, and users add their
 * own lines next to Edu's block. A JSON merge owns its patched keys, a managed block its block, a TOML
 * merge its delimited sections; a plain file is compared byte for byte.
 */
export async function isActionIntact(action: StoredAction, current: Buffer | undefined): Promise<boolean> {
  if (!current) return false;
  if (action.sha256 && sha256(current) === action.sha256) return true;
  const text = current.toString('utf8');
  try {
    switch (action.kind) {
      case 'json-merge': return !!action.jsonPatch && containsPatch(parseJsonFile(action.path, text), action.jsonPatch);
      case 'managed-block': {
        const block = managedBlock(text);
        if (block === undefined) return false;
        if (action.blockSha256) return sectionDigest(block) === action.blockSha256;
        // Edu 5.x recorded only the whole file it wrote, which was its block upserted into the backup.
        const before = action.backup ? await readTarget(action.backup) : Buffer.alloc(0);
        return !!before && !!action.sha256 && sha256(upsertManagedBlock(before.toString('utf8'), managedBlockBody(block), '\n')) === action.sha256;
      }
      case 'toml-merge': {
        const digest = tomlSectionsDigest(text);
        if (!digest) return false;
        if (action.blockSha256) return digest === action.blockSha256;
        return !!action.tomlBody && tomlSectionsDigest(mergeToml(unmergeToml(text), action.tomlBody)) === digest;
      }
      default: return false;
    }
  } catch { return false; }
}

function driftError(path: string): Error {
  return new Error(`Edu installation drift: ${path} changed inside the part Edu manages. Restore that part, or run edu uninstall --force to remove Edu's part anyway.`);
}

function keptNote(unit: string, path: string): string {
  const hint = unit === 'statusLine' ? ' (set its command to "edu statusline" to use the Edu statusline)' : '';
  return `Kept your own ${unit} in ${path}; Edu did not change it${hint}.`;
}

async function loadSharedRegistry(home: string): Promise<SharedRegistry> {
  const path = sharedRegistryPath(home);
  const content = await readTarget(path);
  if (!content) return { version: 1, targets: {}, createdDirs: [] };
  const value: unknown = parseStateFile(path, content);
  if (!value || typeof value !== 'object' || (value as SharedRegistry).version !== 1 ||
      !(value as SharedRegistry).targets || !Array.isArray((value as SharedRegistry).createdDirs)) {
    throw new Error(`Invalid Edu shared-target registry: ${path}`);
  }
  return value as SharedRegistry;
}

async function saveSharedRegistry(home: string, registry: SharedRegistry, transaction?: FileTransaction): Promise<void> {
  const path = sharedRegistryPath(home);
  if (!Object.keys(registry.targets).length) {
    await (transaction ? transaction.remove(path) : unlink(path)).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
    return;
  }
  await ensureParents(path, registry.createdDirs, transaction);
  const temp = `${path}.${randomUUID()}.tmp`;
  await (transaction ? transaction.write(temp, `${JSON.stringify(registry, null, 2)}\n`) : writeFile(temp, `${JSON.stringify(registry, null, 2)}\n`));
  await (transaction ? transaction.move(temp, path) : rename(temp, path));
}

export interface PlanInstallOptions {
  clis: CliId[] | 'all';
  selectedHosts?: CliId[];
  scope: InstallScope;
  root: string;
  home?: string;
  templatesDir?: string;
  /** Host overrides (CODEX_HOME, PI_CODING_AGENT_DIR); none when omitted, so tests never follow the real environment. */
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

/** Edu's own state files (manifests, the shared registry): a corrupt one is named, never a bare SyntaxError. */
function parseStateFile(path: string, content: Buffer): unknown {
  try { return JSON.parse(content.toString('utf8')); }
  catch (error) { throw new Error(`Edu state file ${path} is not valid JSON (${error instanceof Error ? error.message : String(error)}). Restore it from a backup or remove it, then run again.`); }
}

export function getManifestPath(scope: InstallScope, root: string, home: string): string {
  return join(scope === 'project' ? root : home, '.edu/manifest.json');
}

export async function planInstall(options: PlanInstallOptions): Promise<InstallPlan> {
  const root = resolve(options.root);
  const home = resolve(options.home ?? homedir());
  const templatesDir = resolve(options.templatesDir ?? packageTemplatesDir());
  const clis = options.clis === 'all' ? CLI_IDS : [...new Set(options.clis)];
  for (const cli of clis) if (!CLI_IDS.includes(cli)) throw new Error(`Unknown CLI: ${cli}`);
  const notes = clis.includes('agy') ? ['agy MCP: manual step'] : [];
  const dirs = installDirs(home, options.env ?? {});
  const bases = await pinConfiguredBases(root, home, dirs);
  const settings = { home, templatesDir, bases, dirs, platform: options.platform, selectedHosts: options.selectedHosts ?? clis, notes };
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
  return { scope: options.scope, root, home, templatesDir, actions, notes, bases, dirs };
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
  const value: unknown = parseStateFile(path, content);
  if (!value || typeof value !== 'object' || (value as StoredManifest).version !== 1 || !Array.isArray((value as StoredManifest).actions)) {
    throw new Error(`Invalid Edu manifest: ${path}`);
  }
  return value as StoredManifest;
}

function publicAction(action: PlannedAction, after: Buffer, backup?: string, shared = false, hash = sha256(after)): StoredAction {
  const blockSha256 = ownDigest(action.kind, after);
  return { ...(action.bundle ? { bundle: { name: action.bundle.name, root: action.bundle.root, anchor: action.bundle.anchor, scope: action.bundle.scope, relative: action.bundle.relative } } : {}), cli: action.cli, clis: action.clis ?? [action.cli], kind: action.kind, path: action.path, description: action.description, sha256: hash, ...(backup ? { backup } : {}), ...(shared ? { shared: true } : {}), ...(action.jsonPatch ? { jsonPatch: action.jsonPatch } : {}), ...(action.tomlBody ? { tomlBody: action.tomlBody } : {}), ...(blockSha256 ? { blockSha256 } : {}) };
}

/** Backups may land in a git repository (a project, a synced ~/.edu): a `*` ignore file keeps them out of commits. */
const BACKUP_IGNORE = '*\n';
async function ignoreBackups(dir: string, createdDirs: string[], transaction: FileTransaction): Promise<void> {
  const path = join(dir, '.gitignore');
  await ensureParents(path, createdDirs, transaction);
  if (!await readTarget(path)) await transaction.write(path, BACKUP_IGNORE);
}
/** Drops that ignore file once its backup folder holds nothing else, so the folder itself can go. */
async function dropBackupIgnore(dir: string, transaction: FileTransaction): Promise<void> {
  const entries = await readdir(dir).catch(() => undefined);
  if (entries?.length === 1 && entries[0] === '.gitignore' && (await readTarget(join(dir, '.gitignore')))?.toString('utf8') === BACKUP_IGNORE) {
    await transaction.remove(join(dir, '.gitignore'));
  }
}

/** The action another installation recorded for a shared HOME target (what Edu wrote there). */
async function ownerAction(owners: readonly string[], path: string): Promise<StoredAction | undefined> {
  for (const owner of owners) {
    const action = (await loadManifest(owner).catch(() => undefined))?.actions.find(item => item.path === path);
    if (action) return action;
  }
  return undefined;
}

export async function applyInstall(plan: InstallPlan, options: { manifestPath?: string; transaction?: FileTransaction } = {}): Promise<InstallManifest> {
  return withInstallLock(plan.home, async () => {
    const transaction = options.transaction ?? new FileTransaction();
    try { return await applyPreparedInstall(plan, transaction, options.manifestPath); }
    catch (error) {
      try { await transaction.rollback(); } catch (rollback) { throw new AggregateError([error, rollback], 'Installation failed and rollback incomplete'); }
      throw error;
    }
  });
}

async function applyPreparedInstall(plan: InstallPlan, transaction: FileTransaction, explicitManifest?: string): Promise<InstallManifest> {
  const manifestPath = explicitManifest ?? getManifestPath(plan.scope, plan.root, plan.home);
  transaction.anchors.add(resolve(plan.root));
  transaction.anchors.add(resolve(plan.home));
  const dirs = plan.dirs ?? installDirs(plan.home);
  const sharedPaths = new Set(sharedTargetPaths(plan.home, dirs));
  const isSharedTarget = (path: string) => sharedPaths.has(path);
  const allowedBases = configuredBases(plan.root, plan.home, dirs);
  const bases = [...(plan.bases ?? await pinConfiguredBases(plan.root, plan.home, dirs)), ...plan.actions.flatMap(a => a.bundle?.bases ?? [])];
  for (const pin of bases) {
    if (!allowedBases.includes(pin.path)) throw new Error(`Untrusted install base: ${pin.path}`);
    await assertContained(pin.path, pin.path, pin.canonical); transaction.bases.set(pin.path, pin.canonical);
  }
  await transaction.check(manifestPath);
  await transaction.check(sharedRegistryPath(plan.home));
  for (const action of plan.actions) {
    if (action.bundle && action.bundle.anchor !== (plan.scope === 'project' ? plan.root : plan.home)) throw new Error('Bundle anchor does not match install scope');
    await validateBundleAction(action, bases);
  }
  const previous = await loadManifest(manifestPath);
  if (previous && previous.scope !== plan.scope) throw new Error('Existing manifest has a different scope');
  const shared = await loadSharedRegistry(plan.home);
  const otherScope: InstallScope = plan.scope === 'project' ? 'global' : 'project';
  const otherPath = getManifestPath(otherScope, plan.root, plan.home);
  if (otherPath !== manifestPath) {
    // From cwd == HOME under a symlink (macOS /var → /private/var) both paths name the same file:
    // only a manifest recorded for the other scope counts.
    const found = await loadManifest(otherPath);
    const other = found?.scope === otherScope ? found : undefined;
    const otherTargets = new Set(other?.actions.map(action => action.path) ?? []);
    const conflict = plan.actions.find(action => otherTargets.has(action.path) && (!isSharedTarget(action.path) || !shared.targets[action.path]));
    if (conflict) throw new Error(`Target already managed by ${otherScope} installation: ${conflict.path}`);
  }
  const planned = new Set(plan.actions.map(action => action.path));
  const bundleRoots = new Set(plan.actions.flatMap(action => action.bundle ? [action.bundle.root] : []));
  const retiring = (previous?.actions ?? []).filter(action => !planned.has(action.path) && (isRetired(action, plan.retire ?? []) || (action.bundle && bundleRoots.has(action.bundle.root))));
  for (const action of retiring) if (action.bundle) await validateBundleAction(action as PlannedAction, bases);
  const existing = new Map((previous?.actions ?? []).map(action => [`${action.kind}:${action.path}`, action]));
  // Refuse drift before any write, including actions omitted from a repeat install.
  for (const action of previous?.actions ?? []) {
    if (retiring.includes(action)) continue;
    const current = await readTarget(action.path);
    if (!await isActionIntact(action, current)) throw driftError(action.path);
    if (action.shared && !shared.targets[action.path]?.owners.includes(manifestPath)) throw new Error(`Missing shared ownership: ${action.path}`);
  }
  const paths = new Set<string>();
  const prepared = await Promise.all(plan.actions.map(async planned => {
    if (paths.has(planned.path)) throw new Error(`Multiple operations target ${planned.path}`);
    paths.add(planned.path);
    const before = await readTarget(planned.path);
    const prior = existing.get(`${planned.kind}:${planned.path}`);
    const owner = isSharedTarget(planned.path) ? shared.targets[planned.path] : undefined;
    const recorded = prior ?? (owner ? await ownerAction(owner.owners, planned.path) : undefined);
    // Never overwrite a value the user defined: Edu writes only what is absent or already its own.
    let action = planned;
    if (planned.kind === 'json-merge' && planned.jsonPatch) {
      const resolved = resolveJsonPatch(planned.path, before?.toString('utf8') ?? '', planned.jsonPatch, recorded?.jsonPatch ?? (owner && !recorded ? planned.jsonPatch : undefined));
      for (const unit of resolved.kept) plan.notes.push(keptNote(unit, planned.path));
      action = { ...planned, jsonPatch: resolved.patch };
    } else if (planned.kind === 'toml-merge' && planned.tomlBody && before) {
      let user: string;
      try { user = unmergeToml(before.toString('utf8')); } catch (error) { throw new Error(`${planned.path}: ${error instanceof Error ? error.message : String(error)}`); }
      if (tomlDefines(user, EDU_MCP_TOML_PATH) && tomlDefines(planned.tomlBody, EDU_MCP_TOML_PATH)) {
        plan.notes.push(keptNote(`[${EDU_MCP_TOML_PATH.join('.')}]`, planned.path));
        action = { ...planned, tomlBody: withoutTomlTable(planned.tomlBody, EDU_MCP_TOML_PATH) };
      }
    }
    const after = materialize(action, before);
    if (action.bundle && before !== undefined && !prior) throw new Error(`Unowned bundle target collision: ${action.path}. Preserve the entire legacy skill directory in a user-selected backup outside skills/, retain its accepted proposal record, review the new proposal, then explicitly accept into the vacant name; keep the backup until verified. A new reviewed skill name also avoids replacement.`);
    if (owner) {
      if (!await isActionIntact(recorded ?? { ...action, sha256: owner.sha256 }, before)) throw driftError(action.path);
      const changesEduPart = action.kind === 'toml-merge' ? ownDigest(action.kind, before ?? Buffer.alloc(0)) !== ownDigest(action.kind, after) : !before?.equals(after);
      if (changesEduPart && owner.owners.some(path => path !== manifestPath)) throw new Error(`Shared target has another owner: ${action.path}`);
    }
    return { action, before, after, prior };
  }));
  const createdDirs = [...(previous?.createdDirs ?? [])];
  const nextActions = (previous?.actions ?? []).filter(action => !retiring.includes(action));
  const backupStamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const legacyBackups: string[] = [];
  let sharedChanged = false;
  for (const [index, { action, before, after, prior }] of prepared.entries()) {
    await validateBundleAction(action, bases);
    const key = `${action.kind}:${action.path}`;
    if (isSharedTarget(action.path)) {
      let target = shared.targets[action.path];
      // Everything Edu would add is already there and Edu never wrote it (the user's own
      // [mcp_servers.edu], say): it stays the user's, untracked, exactly like an unshared file.
      if (!target && before?.equals(after) && !prior) continue;
      if (!target) {
        let backup: string | undefined;
        if (prior?.backup || before) {
          const backups = join(plan.home, '.edu/shared-backups');
          backup = join(backups, `${backupStamp}-${index}-${basename(action.path)}`);
          await ensureParents(backup, shared.createdDirs, transaction);
          await ignoreBackups(backups, shared.createdDirs, transaction);
          if (prior?.backup) {
            await transaction.write(backup, await readFile(prior.backup));
            legacyBackups.push(prior.backup);
          } else await transaction.write(backup, before!);
        }
        target = { sha256: sha256(after), owners: [], ...(backup ? { backup } : {}) };
        shared.targets[action.path] = target;
      }
      if (!before?.equals(after)) {
        await ensureParents(action.path, shared.createdDirs, transaction);
        await transaction.write(action.path, after);
        target.sha256 = sha256(after);
      }
      if (!target.owners.includes(manifestPath)) target.owners.push(manifestPath);
      const owners = [...new Set([...(prior?.clis ?? (prior ? [prior.cli] : [])), ...(action.clis ?? [action.cli])])];
      const saved = publicAction({ ...action, clis: owners }, after, target.backup, true, target.sha256);
      const oldIndex = nextActions.findIndex(item => `${item.kind}:${item.path}` === key);
      if (oldIndex >= 0) nextActions[oldIndex] = saved;
      else nextActions.push(saved);
      sharedChanged = true;
      continue;
    }
    if (before?.equals(after)) {
      if (prior) {
        const oldIndex = nextActions.findIndex(item => `${item.kind}:${item.path}` === key);
        // An Edu 5.x record learns the digest of its (verified intact) block, so later checks need no backup.
        const digest = prior.blockSha256 ?? ownDigest(prior.kind, before);
        nextActions[oldIndex] = { ...prior, clis: [...new Set([...(prior.clis ?? [prior.cli]), ...(action.clis ?? [action.cli])])], ...(digest ? { blockSha256: digest } : {}) };
      }
      continue;
    }
    let backup = prior?.backup;
    if (before && !prior) {
      const backups = join(dirname(manifestPath), 'backups');
      backup = join(backups, backupStamp, `${index}-${basename(action.path)}`);
      await ensureParents(backup, createdDirs, transaction);
      await ignoreBackups(backups, createdDirs, transaction);
      await transaction.write(backup, before);
    }
    await ensureParents(action.path, createdDirs, transaction);
    await transaction.write(action.path, after);
    const owners = [...new Set([...(prior?.clis ?? (prior ? [prior.cli] : [])), ...(action.clis ?? [action.cli])])];
    const saved = publicAction({ ...action, clis: owners }, after, backup);
    const oldIndex = nextActions.findIndex(item => `${item.kind}:${item.path}` === key);
    if (oldIndex >= 0) nextActions[oldIndex] = saved;
    else nextActions.push(saved);
  }
  for (const action of retiring) await retireAction(action, createdDirs, transaction);
  const manifest: StoredManifest = {
    version: 1, eduVersion: packageVersion(), installedAt: previous?.installedAt ?? new Date().toISOString(),
    scope: plan.scope, actions: nextActions, createdDirs, home: plan.home,
  };
  await ensureParents(manifestPath, createdDirs, transaction);
  manifest.createdDirs = createdDirs;
  if (sharedChanged) await saveSharedRegistry(plan.home, shared, transaction);
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if ((await readTarget(manifestPath))?.toString('utf8') === serialized) return manifest;
  const temp = `${manifestPath}.${randomUUID()}.tmp`;
  await transaction.write(temp, serialized);
  await transaction.move(temp, manifestPath);
  for (const backup of legacyBackups) await transaction.remove(backup);
  return manifest;
}

function isRetired(action: StoredAction, retire: RetiredAction[]): boolean {
  return !action.shared && retire.some(item => item.kind === action.kind && item.path === action.path &&
    (!item.jsonPatch || JSON.stringify(item.jsonPatch) === JSON.stringify(action.jsonPatch)));
}

/**
 * Undo one action an earlier Edu version recorded, leniently: a file is removed only while it is
 * still byte-identical to what Edu wrote, a JSON merge loses only Edu's keys or entries (comments in
 * JSONC kept), and anything missing or unparseable is left alone. Its backup is dropped either way.
 */
async function retireAction(action: StoredAction, createdDirs: string[], transaction?: FileTransaction): Promise<void> {
  if (action.bundle) await validateBundleAction(action as PlannedAction, [...(transaction?.bases ?? [])].map(([path, canonical]) => ({ path, canonical })));
  const write = transaction ? transaction.write.bind(transaction) : writeFile;
  const remove = transaction ? transaction.remove.bind(transaction) : unlink;
  const current = await readTarget(action.path).catch(() => undefined);
  if (current && action.kind === 'file' && action.sha256 && sha256(current) === action.sha256) {
    if (action.backup) await write(action.path, await readFile(action.backup));
    else await remove(action.path);
  } else if (current && action.kind === 'json-merge' && action.jsonPatch) {
    let remaining: string | undefined;
    try { remaining = unmergeJsonFile(action.path, current.toString('utf8'), action.jsonPatch); } catch { /* Not ours to repair. */ }
    if (remaining !== undefined && remaining !== current.toString('utf8')) {
      // Delete only a plain-JSON file Edu created that held nothing else; never one with user comments.
      if (!action.backup && isPlainJson(current.toString('utf8')) && isEmptyJson(remaining)) await remove(action.path);
      else await write(action.path, remaining);
    }
  }
  if (action.backup) await remove(action.backup).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
  // Drop directories Edu created for it once they are empty (e.g. ~/.config/opencode/tui-plugins).
  for (let dir = dirname(action.path); createdDirs.includes(dir); dir = dirname(dir)) {
    try { if (transaction) await transaction.removeEmptyDirectory(dir); else await rmdir(dir); }
    catch (error) {
      if (['ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) break;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    createdDirs.splice(createdDirs.indexOf(dir), 1);
  }
}

export async function uninstall(options: { manifestPath: string; force?: boolean }): Promise<void> {
  const found = await loadManifest(options.manifestPath);
  if (!found) throw new Error(`Edu manifest not found: ${options.manifestPath}`);
  await withInstallLock(found.home ?? dirname(dirname(options.manifestPath)), async () => {
    const manifest = await loadManifest(options.manifestPath);
    if (!manifest) throw new Error(`Edu manifest not found: ${options.manifestPath}`);
    // One transaction: a failure half-way restores every file, so a retry finds the installation intact.
    const transaction = new FileTransaction();
    try { await uninstallPrepared(manifest, options.manifestPath, Boolean(options.force), transaction); }
    catch (error) {
      try { await transaction.rollback(); } catch (rollback) { throw new AggregateError([error, rollback], 'Uninstall failed and rollback incomplete'); }
      throw error;
    }
  });
}

async function uninstallPrepared(manifest: StoredManifest, manifestPath: string, force: boolean, transaction: FileTransaction): Promise<void> {
  const bases = await pinConfiguredBases(manifest.actions.find(a => a.bundle)?.bundle?.anchor ?? dirname(dirname(manifestPath)), manifest.home ?? dirname(dirname(manifestPath)));
  for (const action of manifest.actions) if (action.bundle) await validateBundleAction(action as PlannedAction, bases);
  if (force) {
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
    if (!shared?.targets[action.path]?.owners.includes(manifestPath)) {
      throw new Error(`Missing shared ownership: ${action.path}`);
    }
  }
  if (!force) {
    for (const action of manifest.actions) {
      if (!await isActionIntact(action, await readTarget(action.path))) throw driftError(action.path);
    }
  }
  const sharedBackups: string[] = [];
  let sharedChanged = false;
  for (const action of [...manifest.actions].reverse()) {
    if (action.shared) {
      const target = shared!.targets[action.path]!;
      target.owners = target.owners.filter(owner => owner !== manifestPath);
      if (!target.owners.length) {
        await revertAction(action, transaction, target.sha256, target.backup);
        if (target.backup) sharedBackups.push(target.backup);
        delete shared!.targets[action.path];
      }
      sharedChanged = true;
      continue;
    }
    await revertAction(action, transaction, action.sha256, action.backup);
  }
  const removeIfPresent = (path: string) => transaction.remove(path).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
  for (const backup of manifest.actions.filter(action => !action.shared).map(action => action.backup).filter((value): value is string => !!value)) await removeIfPresent(backup);
  await transaction.remove(manifestPath);
  const registryEmptied = sharedChanged && !Object.keys(shared!.targets).length;
  if (sharedChanged) {
    await saveSharedRegistry(manifest.home!, shared!, transaction);
    for (const backup of sharedBackups) await removeIfPresent(backup);
  }
  const backupRoots = new Set([join(dirname(manifestPath), 'backups'), ...(registryEmptied ? [join(manifest.home!, '.edu/shared-backups')] : [])]);
  // Deepest first, both lists together: ~/.edu/shared-backups goes before ~/.edu, so no empty ~/.edu stays behind.
  const dirs = [...new Set([...(manifest.createdDirs ?? []), ...(registryEmptied ? shared!.createdDirs : [])])].sort((a, b) => b.length - a.length);
  for (const dir of dirs) {
    if (backupRoots.has(dir)) await dropBackupIgnore(dir, transaction);
    await transaction.removeEmptyDirectory(dir).catch(error => {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    });
  }
}

/**
 * Removes Edu's part of one target. The install-time snapshot comes back only when the file is still
 * byte for byte what Edu wrote; otherwise only Edu's keys, block or sections leave the CURRENT file, so
 * everything the user or the host changed since install (an oauthAccount, new permissions, another MCP
 * server) stays. A plain file Edu owns is restored or deleted (that needs --force when it was edited).
 */
async function revertAction(action: StoredAction, transaction: FileTransaction, written: string | undefined, backup: string | undefined): Promise<void> {
  const restore = async () => {
    const original = await readTarget(backup!);
    if (!original) throw new Error(`Cannot restore ${action.path}: its backup ${backup} is missing`);
    await transaction.write(action.path, original);
  };
  const current = await readTarget(action.path);
  if (!current) { if (backup) await restore(); return; }
  if (written && sha256(current) === written) { if (backup) await restore(); else await transaction.remove(action.path); return; }
  const text = current.toString('utf8');
  let remaining: string | undefined;
  if (action.kind === 'json-merge' && action.jsonPatch) remaining = unmergeJsonFile(action.path, text, action.jsonPatch);
  else if (action.kind === 'managed-block' || action.kind === 'toml-merge') {
    try { remaining = action.kind === 'managed-block' ? removeManagedBlock(text) : unmergeToml(text); }
    catch (error) { throw new Error(`${action.path}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (remaining === undefined) { if (backup) await restore(); else await transaction.remove(action.path); return; }
  if (remaining === text) return;
  const empty = action.kind === 'json-merge' ? isEmptyJson(remaining) : !remaining.trim();
  // Delete only a file Edu created that now holds nothing; a file that existed before install stays.
  if (empty && !backup) await transaction.remove(action.path);
  else await transaction.write(action.path, remaining);
}

function isPlainJson(value: string): boolean {
  try { JSON.parse(value); return true; } catch { return false; }
}

function isEmptyJson(value: string): boolean {
  try { return Object.keys(JSON.parse(value) as Record<string, unknown>).length === 0; }
  catch { return false; }
}
