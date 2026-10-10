import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { hostFiles, type HostId } from '../doctor/hosts.js';
import { editContent } from './edit.js';
import { assertDetachable, type ToolId } from './signatures.js';

export interface DetachFile {
  host: HostId;
  path: string;
  relative: string;
  before: Buffer;
  after: Buffer;
  sha256Before: string;
  sha256After: string;
  changes: string[];
  tokensSaved: number;
}
export interface DetachPlan { home: string; hosts: HostId[]; tools: ToolId[]; files: DetachFile[]; tokensSaved: number }
export interface DetachManifestFile { host: HostId; path: string; sha256Before: string; sha256After: string; changes: string[] }
export interface DetachManifest { id: string; createdAt: string; tools: ToolId[]; hosts: HostId[]; files: DetachManifestFile[]; undoneAt?: string }

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const backupRoot = (home: string) => join(home, '.edu', 'backups');

async function existingFile(path: string): Promise<Buffer | undefined> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`Refusing symlinked host configuration: ${path}`);
    if (!info.isFile()) return undefined;
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function referencedTokens(home: string, config: string, changes: string[]): Promise<number> {
  let tokens = 0;
  for (const key of ['model_instructions_file', 'experimental_compact_prompt_file']) {
    if (!changes.includes(`config: ${key}`)) continue;
    const value = new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, 'm').exec(config)?.[1];
    if (!value) continue;
    const path = value.startsWith('~/') ? join(home, value.slice(2)) : resolve(home, value);
    try { inside(home, path); const bytes = await existingFile(path); if (bytes) tokens += Math.round(bytes.toString('utf8').length / 4); }
    catch { /* External or symlinked files are not read for savings estimates. */ }
  }
  return tokens;
}

function inside(home: string, path: string): string {
  const rel = relative(resolve(home), resolve(path));
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw new Error(`Host file is outside the supplied home: ${path}`);
  return rel;
}

export async function createDetachPlan(input: { home: string; env: NodeJS.ProcessEnv; hosts: HostId[]; tools: string[] }): Promise<DetachPlan> {
  const tools = assertDetachable(input.tools);
  if (!tools.length) throw new Error('Name at least one tool to detach.');
  const home = resolve(input.env.USERPROFILE || input.home);
  const files: DetachFile[] = [];
  for (const file of hostFiles(home, input.env, input.hosts)) {
    const rel = inside(home, file.path);
    const before = await existingFile(file.path);
    if (!before) continue;
    const result = editContent(file.kind, file.host, before.toString('utf8'), tools);
    const after = Buffer.from(result.text);
    if (after.equals(before)) continue;
    const tokensSaved = file.kind === 'instructions' ? Math.max(0, Math.round((before.toString('utf8').length - result.text.length) / 4))
      : file.kind === 'toml' ? await referencedTokens(home, before.toString('utf8'), result.changes) : 0;
    files.push({ host: file.host, path: file.path, relative: rel, before, after, sha256Before: hash(before), sha256After: hash(after), changes: result.changes, tokensSaved });
  }
  return { home, hosts: input.hosts, tools, files, tokensSaved: files.reduce((n, file) => n + file.tokensSaved, 0) };
}

async function atomicWrite(path: string, bytes: Buffer): Promise<void> {
  const temp = join(dirname(path), `.edu-detach-${randomUUID()}.tmp`);
  const mode = (await stat(path)).mode;
  try {
    await writeFile(temp, bytes, { mode });
    await rename(temp, path);
  } catch (error) {
    await import('node:fs/promises').then((fs) => fs.rm(temp, { force: true }));
    throw error;
  }
}

export async function applyDetach(plan: DetachPlan): Promise<DetachManifest> {
  if (!plan.files.length) throw new Error('No matching integrations found; nothing to detach.');
  // Preflight every file before any mutation, preventing a stale plan from clobbering edits.
  for (const file of plan.files) if (hash((await existingFile(file.path)) ?? Buffer.alloc(0)) !== file.sha256Before) throw new Error(`Host configuration changed since planning: ${file.path}`);
  const id = `detach-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const root = join(backupRoot(plan.home), id);
  const manifest: DetachManifest = {
    id, createdAt: new Date().toISOString(), tools: plan.tools, hosts: plan.hosts,
    files: plan.files.map((file) => ({ host: file.host, path: file.relative, sha256Before: file.sha256Before, sha256After: file.sha256After, changes: file.changes })),
  };
  for (const file of plan.files) {
    const backup = join(root, file.relative);
    await mkdir(dirname(backup), { recursive: true });
    await writeFile(backup, file.before);
  }
  await writeFile(join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const applied: DetachFile[] = [];
  try {
    for (const file of plan.files) { await atomicWrite(file.path, file.after); applied.push(file); }
  } catch (error) {
    for (const file of applied.reverse()) await atomicWrite(file.path, file.before);
    throw error;
  }
  return manifest;
}

export async function listDetachBackups(home: string): Promise<string[]> {
  try {
    const ids = (await readdir(backupRoot(home))).filter((id) => /^detach-[\w-]+$/.test(id)).sort().reverse();
    const active: string[] = [];
    for (const id of ids) {
      try { const manifest = JSON.parse(await readFile(join(backupRoot(home), id, 'manifest.json'), 'utf8')) as DetachManifest; if (!manifest.undoneAt) active.push(id); } catch { /* Ignore incomplete backup directories. */ }
    }
    return active;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function undoDetach(input: { home: string; id?: string; force?: boolean }): Promise<{ id: string; restored: string[] }> {
  const id = input.id ?? (await listDetachBackups(input.home))[0];
  if (!id || !/^detach-[\w-]+$/.test(id)) throw new Error('No matching detach backup found.');
  const root = join(backupRoot(input.home), id);
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as DetachManifest;
  if (manifest.id !== id || manifest.undoneAt) throw new Error('Detach backup is invalid or already restored.');
  const restore: Array<{ path: string; before: Buffer }> = [];
  for (const file of manifest.files) {
    const path = join(input.home, file.path);
    inside(input.home, path);
    const before = await readFile(join(root, file.path));
    if (hash(before) !== file.sha256Before) throw new Error(`Backup checksum mismatch: ${file.path}`);
    const current = await existingFile(path);
    if (!current || (!input.force && hash(current) !== file.sha256After)) throw new Error(`Refusing drifted file: ${file.path}; use --force to overwrite`);
    restore.push({ path, before });
  }
  for (const file of restore) await atomicWrite(file.path, file.before);
  manifest.undoneAt = new Date().toISOString();
  await writeFile(join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { id, restored: manifest.files.map((file) => file.path) };
}
