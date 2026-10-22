import { assertContained, portablePath } from '../skills/bundle.js';
import { createHash } from 'node:crypto';
import { access, lstat, mkdir, readFile, writeFile, rename, unlink, rmdir, chmod } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { InstallAction } from '../core/contracts.js';
import type { PlannedAction } from './types.js';
import { upsertManagedBlock } from './blocks.js';
import { mergeJsonFile, mergeToml } from './merge.js';

export function sha256(content: Buffer | string): string { return createHash('sha256').update(content).digest('hex'); }

export async function readTarget(path: string): Promise<Buffer | undefined> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile()) throw new Error(`Refusing non-regular target: ${path}`);
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export function materialize(action: PlannedAction, before: Buffer | undefined): Buffer {
  const text = before?.toString('utf8') ?? '';
  switch (action.kind) {
    case 'managed-block': return Buffer.from(upsertManagedBlock(text, action.content ?? ''), 'utf8');
    case 'file': return Buffer.from(action.content ?? '', 'utf8');
    case 'json-merge': return Buffer.from(mergeJsonFile(action.path, text, action.jsonPatch ?? {}), 'utf8');
    case 'toml-merge': return Buffer.from(mergeToml(text, action.tomlBody ?? ''), 'utf8');
    default: throw new Error(`Unsupported action kind: ${action.kind}`);
  }
}

export async function ensureParents(path: string, createdDirs: string[], transaction?: FileTransaction): Promise<void> {
  const missing: string[] = [];
  let dir = dirname(path);
  while (true) {
    try { await access(dir); break; }
    catch {
      missing.push(dir);
      const parent = dirname(dir);
      if (parent === dir) throw new Error(`No existing ancestor for ${path}`);
      dir = parent;
    }
  }
  for (const next of missing.reverse()) {
    await mkdir(next);
    transaction?.createdDirs.add(next);
    if (!createdDirs.includes(next)) createdDirs.push(next);
  }
}

/** Direct CliIntegration.apply support; the orchestrated installer owns durable manifests. */
export async function applyStandaloneActions(actions: PlannedAction[], home: string): Promise<InstallAction[]> {
  const bundle = actions.find(action => action.bundle)?.bundle;
  if (bundle) {
    const { applyInstall, resolveTemplatesDir } = await import('./installer.js');
    const manifest = await applyInstall({ scope: bundle.scope, root: bundle.anchor, home, templatesDir: resolveTemplatesDir(), notes: [], actions });
    return manifest.actions.filter(action => actions.some(planned => planned.path === action.path));
  }
  const result: InstallAction[] = [];
  const created: string[] = [];
  for (const [index, action] of actions.entries()) {
    const before = await readTarget(action.path);
    const after = materialize(action, before);
    if (before?.equals(after)) continue;
    let backup: string | undefined;
    if (before !== undefined) {
      backup = join(home, '.edu/backups', `standalone-${Date.now()}`, `${index}-${sha256(action.path)}`);
      await ensureParents(backup, created);
      await writeFile(backup, before);
    }
    await ensureParents(action.path, created);
    await writeFile(action.path, after);
    result.push({ cli: action.cli, kind: action.kind, path: action.path, description: action.description, sha256: sha256(after), backup });
  }
  return result;
}

/** In-process rollback records every changed file, including manifests, staging files and backups. */
export class FileTransaction {
  private before = new Map<string, { content: Buffer; mode: number } | undefined>();
  readonly createdDirs = new Set<string>();
  readonly anchors = new Set<string>();
  private async check(path: string): Promise<void> {
    if (!this.anchors.size) return;
    const absolute = resolve(path);
    const anchor = [...this.anchors].filter(root => absolute === root || absolute.startsWith(root + sep)).sort((a, b) => b.length - a.length)[0];
    if (!anchor) throw new Error(`Installer path escapes containment: ${path}`);
    await assertContained(anchor, absolute);
  }
  private async capture(path: string): Promise<void> {
    await this.check(path);
    if (this.before.has(path)) return;
    const content = await readTarget(path);
    this.before.set(path, content === undefined ? undefined : { content, mode: (await lstat(path)).mode & 0o777 });
  }
  async write(path: string, content: Buffer | string): Promise<void> { await this.capture(path); await writeFile(path, content); }
  async remove(path: string): Promise<void> { await this.capture(path); await unlink(path); }
  async move(from: string, to: string): Promise<void> { await this.capture(from); await this.capture(to); await rename(from, to); }
  async rollback(): Promise<void> {
    const failures: unknown[] = [];
    for (const [path, before] of [...this.before].reverse()) {
      try {
        await this.check(path);
        if (before) { await writeFile(path, before.content); await chmod(path, before.mode); }
        else await unlink(path).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
      } catch (error) { failures.push(error); }
    }
    for (const path of [...this.createdDirs].reverse()) await rmdir(path).catch(error => { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) failures.push(error); });
    this.before.clear(); this.createdDirs.clear();
    if (failures.length) throw new AggregateError(failures, 'Installation rollback incomplete');
  }
}

export async function validateBundleAction(action: PlannedAction): Promise<void> {
  if (!action.bundle) return;
  const { root, anchor, relative, source } = action.bundle;
  portablePath(relative);
  if (action.kind !== 'file' || action.path !== join(root, relative)) throw new Error(`Invalid bundle target: ${action.path}`);
  await assertContained(anchor, root);
  await assertContained(anchor, action.path);
  if (source) {
    await assertContained(source.anchor, source.path);
    const current = await readTarget(source.path);
    if (!current || sha256(current) !== source.sha256 || sha256(action.content ?? '') !== source.sha256) throw new Error(`Bundle source changed after planning: ${source.path}`);
  }
}
