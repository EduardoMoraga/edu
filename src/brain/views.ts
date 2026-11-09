/**
 * Writes a brain's Obsidian views: the localized Base set in `0-index`, and for the orchestrator brain
 * (one sitting directly under the vault root) the Home dashboard next to it.
 */
import { existsSync, realpathSync } from 'node:fs';
import { readFile, rm, rmdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { BrainLocation } from '../core/contracts.js';
import { readProjects, type ProjectEntry } from '../vault/registry.js';
import { DASHBOARD_PATHS, buildBases, buildDashboard, isEduOwned, staleBaseFiles, type BaseLang, type BaseScope, type DashboardWorkspace } from './bases.js';
import { brainPath, readWorkspaceSettings, vaultFolder, vaultPlacement } from './location.js';
import { warnUnsafe } from './catalog.js';
import { assertInsideBrain } from './safe-path.js';
import { INDEX_DIR, atomicWrite } from './store.js';

export interface ViewOptions {
  /** Registered workspaces for the dashboard; defaults to `<eduHome>/projects.json`. */
  projects?: () => Promise<ProjectEntry[]>;
}

export interface ViewReport { bases: string[]; removed: string[]; dashboard?: { path: string; written: boolean } }

const defaultEduHome = (primary: BrainLocation) => primary.scope === 'global' ? primary.root : resolve(process.env.EDU_HOME || join(homedir(), '.edu'));

const real = (path: string) => { try { return realpathSync(path); } catch { return resolve(path); } };
const posix = (path: string) => path.split(sep).join('/');
const insideRel = (parent: string, child: string) => {
  const rel = relative(parent, child);
  return rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`) ? posix(rel) : undefined;
};

/** A registered workspace as the dashboard links it: its start page inside the vault, else its folder. */
export function dashboardWorkspace(vault: string, entry: ProjectEntry): DashboardWorkspace {
  if (!existsSync(entry.root)) return { name: entry.name, path: entry.root, missing: true };
  const root = real(entry.root);
  const rel = insideRel(vault, root);
  if (!rel) return { name: entry.name, path: root };
  const candidates = [`00-INICIO/${entry.name}.md`, '00-INICIO/README.md', `00-START/${entry.name}.md`, '00-START/README.md', 'README.md'];
  const page = candidates.find(candidate => existsSync(join(root, candidate)));
  return page ? { name: entry.name, link: `${rel}/${page.replace(/\.md$/, '')}`, path: rel } : { name: entry.name, path: rel };
}

async function readText(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8'); } catch { return undefined; }
}

export async function writeObsidianViews(primary: BrainLocation, options: ViewOptions = {}): Promise<ViewReport> {
  const lang: BaseLang = (await readWorkspaceSettings(primary.root)).lang ?? 'en';
  const placed = vaultPlacement(primary);
  const orchestrator = Boolean(placed && placed.brainRel && !placed.brainRel.includes('/'));
  const scope: BaseScope = orchestrator
    ? { mode: 'orchestrator', brainRel: placed!.brainRel }
    : { mode: 'workspace', brainRel: vaultFolder(primary, '').replace(/\/$/, '') };
  const brain = brainPath(primary);
  const indexDir = join(brain, INDEX_DIR);
  const report: ViewReport = { bases: [], removed: [] };
  // A view behind a symbolic link (e.g. one committed in a synced remote) is skipped with a warning, never written through.
  for (const file of buildBases(lang, scope)) {
    try { await atomicWrite(join(indexDir, file.name), file.content, { root: brain }); report.bases.push(file.name); }
    catch (error) { warnUnsafe(error); }
  }
  for (const name of staleBaseFiles(lang)) {
    if (!existsSync(join(indexDir, name))) continue;
    try { await assertInsideBrain(brain, join(indexDir, name)); } catch (error) { warnUnsafe(error); continue; }
    await rm(join(indexDir, name), { force: true }); report.removed.push(name);
  }
  if (!orchestrator) return report;

  const vault = placed!.vault;
  const target = join(vault, ...DASHBOARD_PATHS[lang].split('/'));
  const existing = await readText(target);
  if (existing !== undefined && !isEduOwned(existing)) { report.dashboard = { path: target, written: false }; return report; }
  let entries: ProjectEntry[] = [];
  try { entries = await (options.projects ?? (async () => (await readProjects(defaultEduHome(primary))).projects))(); }
  catch { /* an unreadable registry must not break maintenance: the dashboard just lists no workspaces */ }
  const content = buildDashboard(lang, `${placed!.brainRel}/${INDEX_DIR}`, entries.map(entry => dashboardWorkspace(vault, entry)));
  if (existing !== content) {
    try { await atomicWrite(target, content, { root: vault }); }
    catch (error) { warnUnsafe(error); report.dashboard = { path: target, written: false }; return report; }
  }
  report.dashboard = { path: target, written: true };
  const other = join(vault, ...DASHBOARD_PATHS[lang === 'es' ? 'en' : 'es'].split('/'));
  const otherText = await readText(other);
  if (otherText !== undefined && isEduOwned(otherText)) {
    try { await assertInsideBrain(vault, other); } catch (error) { warnUnsafe(error); return report; }
    await rm(other, { force: true });
    await rmdir(dirname(other)).catch(() => { /* keep a folder that still holds the user's files */ });
  }
  return report;
}
