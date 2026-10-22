import { lstat, readdir, readFile, mkdir, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { assertContained } from '../skills/bundle.js';
import { sha256, pathKey, workspacePath, type ExperimentSpec } from './contract.js';

export type Entry = { kind: 'directory' } | { kind: 'file'; bytes: Buffer; executable: number };
export type Snapshot = Map<string, Entry>;
const excluded = (name: string) => /^(?:\.git|\.edu|\.cloudroom|\.codex|\.claude|\.pi|\.gemini|node_modules|\.ssh|\.aws|\.azure|\.gcloud|\.config|\.npm|\.gnupg|\.kube|credentials?|secrets?)(?:$|\.)/i.test(name) || /^\.env(?:$|\.)/i.test(name) || /\.(?:pem|key|p12|pfx)$/i.test(name) || /^(?:id_rsa|id_ed25519|\.netrc|\.npmrc|\.pypirc|\.mcp\.json)$/i.test(name);
export const entryDigest = (entry: Entry) => entry.kind === 'directory' ? { kind: entry.kind } : { kind: entry.kind, sha256: sha256(entry.bytes), executable: entry.executable };
export const snapshotDigests = (files: Snapshot) => Object.fromEntries([...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, entry]) => [path, entryDigest(entry)]));
export const snapshotHash = (files: Snapshot) => sha256(JSON.stringify(snapshotDigests(files)));

/** Named exclusions are a convenience, never a guarantee that source files contain no secrets. */
export async function snapshot(root: string, limits: ExperimentSpec['limits'], source = false, monitor = false): Promise<Snapshot> {
  await assertContained(root, root);
  const files: Snapshot = new Map(); let bytes = 0, entries = 0; const names = new Set<string>();
  const walk = async (directory: string, prefix: string) => {
    for (const name of (await readdir(directory)).sort()) {
      if (source && excluded(name)) continue;
      const path = prefix ? `${prefix}/${name}` : name;
      workspacePath(path);
      if (names.has(pathKey(path))) throw new Error(`Workspace case/Unicode collision: ${path}`); names.add(pathKey(path));
      if (++entries > limits.files) throw new Error('Workspace file/entry limit exceeded');
      const target = join(root, path);
      try {
        await assertContained(root, target);
        const stat = await lstat(target);
        if (stat.isDirectory()) { files.set(path, { kind: 'directory' }); await walk(target, path); }
        else if (stat.isFile()) {
          bytes += stat.size;
          if (bytes > limits.workspaceBytes) throw new Error('Workspace byte limit exceeded');
          if (monitor) continue;
          const value = await readFile(target);
          if (value.length !== stat.size) throw new Error(`Workspace changed during snapshot: ${path}`);
          files.set(path, { kind: 'file', bytes: value, executable: process.platform === 'win32' ? 0 : stat.mode & 0o111 });
        } else throw new Error(`Refusing symlink or special workspace file: ${path}`);
      } catch (error) {
        if (!monitor || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        // A live command may rename/remove its own temporary files during monitoring.
      }
    }
  };
  await walk(root, ''); return files;
}
export async function materialize(root: string, files: Snapshot): Promise<void> {
  await mkdir(root, { recursive: true });
  for (const [path, entry] of files) {
    await assertContained(root, join(root, path));
    if (entry.kind === 'directory') await mkdir(join(root, path), { recursive: true });
    else {
      await writeFile(join(root, path), entry.bytes, { flag: 'wx', mode: 0o644 | entry.executable });
      if (process.platform !== 'win32') await chmod(join(root, path), 0o644 | entry.executable);
    }
  }
}
/** Add only declared overlay files, preserving existing executable bits. */
export function overlaySnapshot(initial: Snapshot, overlay: Record<string, string>, limits: ExperimentSpec['limits']): Snapshot {
  const files = new Map(initial);
  for (const [path, content] of Object.entries(overlay)) {
    const previous = files.get(path);
    if (previous?.kind === 'directory') throw new Error(`Overlay file/directory collision: ${path}`);
    files.set(path, { kind: 'file', bytes: Buffer.from(content), executable: previous?.executable ?? 0 });
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('/');
      if (files.get(parent)?.kind === 'file') throw new Error(`Overlay file/parent collision: ${parent}`);
      if (!files.has(parent)) files.set(parent, { kind: 'directory' });
    }
  }
  const names = new Set<string>(); let bytes = 0;
  for (const [path, entry] of files) {
    if (names.has(pathKey(path))) throw new Error(`Workspace case/Unicode collision: ${path}`); names.add(pathKey(path));
    if (entry.kind === 'file') bytes += entry.bytes.length;
  }
  if (files.size > limits.files || bytes > limits.workspaceBytes) throw new Error('Workspace inventory limit exceeded');
  return files;
}
