/** Versioned, local-only upgrades. Never run lifecycle maintenance while migrating old memory. */
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveBrainDir } from '../brain/location.js';
import { compareVersions } from './release.js';
import { packageVersion } from '../cli/package.js';
import { getCapabilities } from '../release/capabilities.js';
import { readProjects } from '../vault/registry.js';

export type MigrationStatus = 'migrated' | 'missing' | 'no-brain' | 'failed';
export interface WorkspaceMigration { name: string; root: string; status: MigrationStatus; detail?: string }
export interface MigrationOptions { version?: string }
const revision = 2;
const start = '<!-- edu:capabilities:start -->';
const end = '<!-- edu:capabilities:end -->';
async function optional(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
async function plainPath(path: string, root: string): Promise<void> {
  for (let current = resolve(path); ; current = dirname(current)) {
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error(`Refusing migration through symlink: ${current}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (current === resolve(root) || dirname(current) === current) break;
  }
}
const legacyProtocol = "**Protocol.** Start with `edu_brief` (shell: `edu brief`). Pull on demand: `edu_recall`, then `edu_read`;\ncite ids like `[[D-…]]`. `edu_remember` decisions, hypotheses, commitments and lessons\nas they happen; `edu_feedback` when a note helped or misled. End with\n`edu_session_close` and an honest summary.";
const currentProtocol = "**Protocol.** Reuse an injected Edu brief; otherwise call `edu_brief` once. Retain an injected session id; otherwise call `edu_session_open(title, source)` and keep its exact returned id per workspace. Recall with `edu_recall`, then `edu_read`; cite ids, scope, claim bands and evidence. Use `edu_remember` for durable decisions and lessons. Memory is stored notes, not model training; `edu_feedback` is advisory, never proof. Close with `edu_session_close(id, summary)` using that exact id, and report failures honestly. Check `edu_capabilities`; unavailable means unknown.";
function contract(text: string, version: string): string {
  // Only the exact shipped paragraph is ours. Unknown edits require human reconciliation.
  if (text.includes('**Protocol.**')) {
    const matches = text.match(/\*\*Protocol\.\*\*[^]*?(?=\n\n|\n<!--|$)/g) ?? [];
    if (matches.length !== 1 || ![legacyProtocol, currentProtocol].includes(matches[0]!)) throw new Error('Manual conflict: custom legacy EDU.md protocol; preserve and reconcile manually');
    text = text.replace(legacyProtocol, currentProtocol);
  }
  const block = `${start}
Installed Edu: ${version}.
Capabilities on demand: state/capabilities.json, \`edu capabilities --json\`, or MCP \`edu_capabilities\` (unavailable = unknown).
Restart hosts/MCP after update. Feedback is advisory, not proof. Reuse the injected session id; otherwise open once and close with the exact returned id per workspace.
${end}`;
  const a = text.indexOf(start); const b = text.indexOf(end);
  if ((a < 0) !== (b < 0) || (a >= 0 && (b < a || text.indexOf(start, a + start.length) >= 0 || text.indexOf(end, b + end.length) >= 0))) throw new Error('Malformed Edu capabilities block');
  if (a >= 0) return text.slice(0, a) + block + text.slice(b + end.length);
  // Inside legacy core so model-facing contract truncation still exposes the upgrade.
  const coreEnd = text.indexOf('<!-- /edu:core -->');
  if (coreEnd >= 0) return text.slice(0, coreEnd) + block + '\n' + text.slice(coreEnd);
  return text + (text.endsWith('\n') ? '\n' : '\n\n') + block + '\n';
}
/** Back up every replaced file before the first write. Local backups never contain a copy of the brain. */
async function replaceFiles(root: string, files: { path: string; content: string }[], version: string, now: Date, backupOnly = false): Promise<string> {
  for (const file of files) await plainPath(file.path, root);
  const backupRoot = join(root, 'backups'); await plainPath(backupRoot, root);
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  const backup = join(backupRoot, `upgrade-${now.toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`);
  await mkdir(backup, { mode: 0o700 });
  const manifest: { path: string; file?: string; absent?: boolean }[] = [];
  for (const [i, file] of files.entries()) {
    const before = await optional(file.path);
    if (before === undefined) manifest.push({ path: file.path, absent: true });
    else { const name = `${i}.bak`; await writeFile(join(backup, name), before, { mode: 0o600, flag: 'wx' }); manifest.push({ path: file.path, file: name }); }
  }
  await writeFile(join(backup, 'manifest.json'), JSON.stringify({ version, revision, at: now.toISOString(), files: manifest }, null, 2), { mode: 0o600, flag: 'wx' });
  if (backupOnly) return backup;
  for (const file of files) {
    await mkdir(dirname(file.path), { recursive: true, mode: 0o700 });
    const mode = await lstat(file.path).then(stat => stat.mode & 0o777, error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0o600;
      throw error;
    });
    const temp = `${file.path}.${randomUUID()}.tmp`;
    try { await writeFile(temp, file.content, { mode, flag: 'wx' }); await rename(temp, file.path); }
    finally { await rm(temp, { force: true }); }
  }
  return backup;
}

/** Snapshot setup-managed targets before any host integration mutation. No memory scan. */
export async function backupUpgradeFiles(root: string, paths: string[]): Promise<string> {
  return replaceFiles(root, paths.map(path => ({ path, content: '' })), packageVersion(), new Date(), true);
}

export async function migrateWorkspaces(eduHome: string, now = new Date(), options: MigrationOptions = {}): Promise<WorkspaceMigration[]> {
  const version = options.version ?? packageVersion();
  const results: WorkspaceMigration[] = [];
  let projects: Awaited<ReturnType<typeof readProjects>>['projects'] = [];
  try { projects = (await readProjects(eduHome)).projects; }
  catch (error) { results.push({ name: 'registry', root: eduHome, status: 'failed', detail: String(error) }); }
  const targets = [{ name: 'global', root: eduHome, eduRoot: eduHome }, ...projects.map(p => ({ name: p.name, root: p.root, eduRoot: join(p.root, '.edu') }))];
  const seen = new Set<string>();
  for (const target of targets) {
    const { eduRoot, ...base } = target;
    if (seen.has(resolve(eduRoot))) continue;
    seen.add(resolve(eduRoot));
    try {
      try { await lstat(target.root); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { results.push({ ...base, status: 'missing' }); continue; } throw error; }
      await plainPath(eduRoot, eduRoot);
      const text = await optional(join(eduRoot, 'EDU.md'));
      if (text === undefined) { results.push({ ...base, status: 'no-brain' }); continue; }
      const rawConfig = await optional(join(eduRoot, 'config.json'));
      const config = rawConfig === undefined ? {} : JSON.parse(rawConfig);
      if (!config || typeof config !== 'object' || Array.isArray(config) || (config.brainDir !== undefined && typeof config.brainDir !== 'string')) throw new Error('Invalid workspace config');
      resolveBrainDir(eduRoot, config.brainDir); // Validate; never move, rewrite, or scan memory.
      const statePath = join(eduRoot, 'state', 'upgrade.json');
      const prior = await optional(statePath);
      const state = prior === undefined ? undefined : JSON.parse(prior);
      if (state !== undefined && (!state || typeof state.version !== 'string' || typeof state.revision !== 'number')) throw new Error('Invalid upgrade checkpoint');
      if (state && compareVersions(state.version, version) > 0) throw new Error(`Refusing to downgrade migrated contract ${state.version} to ${version}`);
      const nextContract = contract(text, version);
      const capabilityPath = join(eduRoot, 'state', 'capabilities.json');
      const capabilities = `${JSON.stringify(getCapabilities(version), null, 2)}\n`;
      if (state?.version === version && state?.revision === revision && text === nextContract && await optional(capabilityPath) === capabilities) {
        results.push({ ...base, status: 'migrated', detail: 'already current; no writes' }); continue;
      }
      const backup = await replaceFiles(eduRoot, [
        { path: join(eduRoot, 'EDU.md'), content: nextContract },
        { path: capabilityPath, content: capabilities },
        { path: statePath, content: `${JSON.stringify({ version, revision, previousVersion: state?.version ?? 'legacy/unversioned', completedAt: now.toISOString() }, null, 2)}\n` },
      ], version, now);
      results.push({ ...base, status: 'migrated', detail: `managed contract updated; backup ${backup}; restart hosts` });
    } catch (error) { results.push({ ...base, status: 'failed', detail: error instanceof Error ? error.message : String(error) }); }
  }
  // Registry paths are derived metadata. Back up the original before refresh; preserve missing entries.
  try {
    const path = join(eduHome, 'projects.json'); const before = await optional(path);
    if (before !== undefined) {
      const live = await readProjects(eduHome);
      const stored = JSON.parse(before);
      if (live.projects.some((p, i) => p.brain !== stored.projects[i]?.brain)) {
        const projects = stored.projects.map((p: Record<string, unknown>, i: number) => ({ ...p, brain: live.projects[i]!.brain }));
        await replaceFiles(eduHome, [{ path, content: `${JSON.stringify({ ...stored, projects }, null, 2)}\n` }], version, now);
      }
    }
  } catch (error) { results.push({ name: 'registry', root: eduHome, status: 'failed', detail: String(error) }); }
  return results;
}
