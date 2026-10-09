import { createHash } from 'node:crypto';
import { access, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { InstallAction } from '../core/contracts.js';
import type { PlannedAction } from './types.js';
import { upsertManagedBlock } from './blocks.js';
import { mergeJson, mergeToml } from './merge.js';

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
    case 'json-merge': return Buffer.from(mergeJson(text, action.jsonPatch ?? {}), 'utf8');
    case 'toml-merge': return Buffer.from(mergeToml(text, action.tomlBody ?? ''), 'utf8');
    default: throw new Error(`Unsupported action kind: ${action.kind}`);
  }
}

export async function ensureParents(path: string, createdDirs: string[]): Promise<void> {
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
    if (!createdDirs.includes(next)) createdDirs.push(next);
  }
}

/** Direct CliIntegration.apply support; the orchestrated installer owns durable manifests. */
export async function applyStandaloneActions(actions: PlannedAction[], home: string): Promise<InstallAction[]> {
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
