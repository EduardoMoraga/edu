/** A safe, linked Obsidian view of Edu brains. Brain notes are never copied. */
import { randomBytes } from 'node:crypto';
import { access, copyFile, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, posix, resolve, win32 } from 'node:path';
import { openBrain } from '../brain/index.js';
import { createVaultLink, linkState } from '../cli/link.js';
import { readProjects, type ProjectEntry } from './registry.js';

const START = '<!-- edu:projects -->';
const END = '<!-- /edu:projects -->';
const IGNORED = ['runs/', 'crew/', 'proposals/', 'backups/'];
type Platform = NodeJS.Platform;

function pathParts(path: string, platform: Platform): string[] {
  const api = platform === 'win32' ? win32 : posix;
  return api.resolve(path).split(/[\\/]+/).filter(Boolean).map(part => platform === 'win32' ? part.toLowerCase() : part);
}

/** Pure lexical safety check, used before any filesystem writes. */
export function unsafeVaultPathReason(path: string, home: string, platform: Platform): string | undefined {
  const api = platform === 'win32' ? win32 : posix;
  const vault = api.resolve(path);
  const userHome = api.resolve(home);
  const compare = (value: string) => platform === 'win32' ? value.toLowerCase() : value;
  if (compare(vault) === compare(api.parse(vault).root)) return 'a drive or filesystem root';
  const relative = api.relative(vault, userHome);
  if (relative === '' || (relative !== '..' && !relative.startsWith(`..${api.sep}`) && !api.isAbsolute(relative))) {
    return 'the home folder or one of its ancestors';
  }
  const segments = pathParts(vault, platform).map(part => part.toLowerCase());
  if (segments.includes('.edu')) return 'an application, system, or project-brain folder';
  // Application data inside the user's home (AppData, Library, .config…).
  const insideHome = relative === '..' || relative.split(api.sep).every(part => part === '..');
  if (insideHome) {
    const fromHome = api.relative(userHome, vault).split(/[\\/]+/).filter(Boolean).map(part => part.toLowerCase());
    if (fromHome[0] && new Set(['appdata', 'library', '.config', '.local', '.cache']).has(fromHome[0])) {
      return 'an application, system, or project-brain folder';
    }
  }
  // System folders at the top of a drive or filesystem.
  const top = platform === 'win32' && segments[0]?.endsWith(':') ? segments[1] : segments[0];
  const system = platform === 'win32'
    ? new Set(['windows', 'program files', 'program files (x86)', 'programdata'])
    : new Set(['etc', 'usr', 'bin', 'sbin', 'system', 'library', 'opt', 'private', 'var']);
  if (top && system.has(top) && !(platform !== 'win32' && isTempPath(vault))) return 'an application, system, or project-brain folder';
  return undefined;
}

function isTempPath(path: string): boolean {
  // macOS/Linux temp dirs live under /var/folders or /tmp (symlinked to /private/…): fine for vaults in tests and scratch use.
  return /^\/(private\/)?(var\/folders|tmp)\//.test(path);
}

export function isUnsafeVaultPath(path: string, home: string, platform: Platform): boolean {
  return unsafeVaultPathReason(path, home, platform) !== undefined;
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function physicalCandidate(path: string): Promise<string> {
  let ancestor = path;
  const suffix: string[] = [];
  while (true) {
    try { return resolve(await realpath(ancestor), ...suffix.reverse()); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      suffix.push(basename(ancestor));
      ancestor = parent;
    }
  }
}

function segment(name: string): string {
  if (!name || name === '.' || name === '..' || name === '_global' || /[\\/\0-\x1f]/.test(name)) {
    throw new Error(`Invalid project link name: ${name}`);
  }
  return name;
}

function projectList(projects: ProjectEntry[]): string {
  return projects.map(project => `- [[Edu/${segment(project.name)}/0-index/INDEX]]`).join('\n');
}

function homePage(name: string, projects: ProjectEntry[]): string {
  return `# ${name}\n\nEdu links your project brains here; it does not copy them.\nOpen a project below to browse its memory.\nOnly Edu writes to the linked brains.\nKeep personal drafts in Notes/.\nUse edu remember or an Edu MCP tool to save memory.\nRun edu vault again after initializing another project.\n\n${START}\n${projectList(projects)}\n${END}\n`;
}

function refreshProjects(text: string, projects: ProjectEntry[]): string {
  const start = text.indexOf(START);
  const end = text.indexOf(END, start + START.length);
  if (start < 0 || end < 0) throw new Error('Home.md has no Edu project markers; refusing to overwrite user text');
  return `${text.slice(0, start + START.length)}\n${projectList(projects)}\n${text.slice(end)}`;
}

export interface VaultOptions {
  path: string;
  home: string;
  eduHome: string;
  name?: string;
  register?: boolean;
  platform?: Platform;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}
export interface VaultReport {
  path: string;
  name: string;
  linked: string[];
  conflicts: string[];
  missingProjects: string[];
  registration: string;
}

async function validatePath(path: string, home: string, platform: Platform): Promise<void> {
  const reason = unsafeVaultPathReason(path, home, platform);
  if (reason) throw new Error(`Unsafe vault path (${reason}): Obsidian walks the whole tree and can hit EPERM or become very slow`);
  const physical = await physicalCandidate(path);
  // Compare real paths on both sides (e.g. macOS /var → /private/var).
  const physicalHome = await physicalCandidate(home).catch(() => home);
  const physicalReason = unsafeVaultPathReason(physical, physicalHome, platform);
  if (physicalReason) throw new Error(`Unsafe vault path (${physicalReason}): ${physical}`);
  if (await exists(path)) {
    if (await exists(join(path, '.edu'))) throw new Error('Unsafe vault path: this folder contains a project brain (.edu/)');
  }
}

export async function createVault(options: VaultOptions): Promise<VaultReport> {
  const platform = options.platform ?? process.platform;
  const path = resolve(options.path);
  await validatePath(path, options.home, platform);
  const projects = (await readProjects(options.eduHome)).projects;
  const current = await readdir(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const homeFile = join(path, 'Home.md');
  if (current.length && !(await exists(homeFile) && (await readFile(homeFile, 'utf8')).includes(START))) {
    throw new Error(`Folder is not empty and is not an Edu vault: ${path}`);
  }
  await mkdir(join(path, '.obsidian'), { recursive: true });
  await mkdir(join(path, 'Edu'), { recursive: true });
  await mkdir(join(path, 'Notes'), { recursive: true });
  const appFile = join(path, '.obsidian', 'app.json');
  if (!(await exists(appFile))) await writeFile(appFile, `${JSON.stringify({ userIgnoreFilters: IGNORED }, null, 2)}\n`);
  const notesReadme = join(path, 'Notes', 'README.md');
  if (!(await exists(notesReadme))) await writeFile(notesReadme, '# Notes\n\nKeep your own notes and drafts here. Edu does not write memory into this folder.\n');
  const name = options.name?.trim() || 'Edu';
  const original = await readFile(homeFile, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  const nextHome = original === undefined ? homePage(name, projects) : refreshProjects(original, projects);
  if (nextHome !== original) await writeFile(homeFile, nextHome);
  const linked: string[] = [];
  const conflicts: string[] = [];
  const missingProjects: string[] = [];
  const entries = [...projects.map(project => ({ name: segment(project.name), target: project.brain, project: true })),
    { name: '_global', target: join(options.eduHome, 'brain'), project: false }];
  for (const entry of entries) {
    if (entry.project && !(await exists(entry.target))) { missingProjects.push(entry.name); continue; }
    const link = join(path, 'Edu', entry.name);
    try {
      await createVaultLink(link, entry.target, platform);
      linked.push(entry.name);
      // Home.md points at each brain's INDEX; make sure it exists and is current.
      await openBrain([{ scope: entry.project ? 'project' : 'global', root: dirname(entry.target) }]).rebuildIndex().catch(() => undefined);
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ELINKCONFLICT') throw error;
      conflicts.push(link);
    }
  }
  const registration = options.register === false ? 'skipped (--no-register)'
    : await registerObsidianVault(path, { home: options.home, platform, env: options.env ?? process.env, now: options.now });
  return { path, name, linked, conflicts, missingProjects, registration };
}

export interface ObsidianOptions { home: string; platform: Platform; env: NodeJS.ProcessEnv; now?: Date }
export async function registerObsidianVault(vault: string, options: ObsidianOptions): Promise<string> {
  const config = options.platform === 'win32' ? join(options.env.APPDATA || join(options.home, 'AppData', 'Roaming'), 'obsidian')
    : options.platform === 'darwin' ? join(options.home, 'Library', 'Application Support', 'obsidian')
      : join(options.home, '.config', 'obsidian');
  const configFile = join(config, 'obsidian.json');
  if (!(await exists(configFile))) return 'skipped (Obsidian not installed)';
  const parsed: unknown = JSON.parse(await readFile(configFile, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid Obsidian obsidian.json');
  const data = parsed as { vaults?: Record<string, { path?: string; ts?: number; open?: boolean }> };
  if (data.vaults !== undefined && (!data.vaults || typeof data.vaults !== 'object' || Array.isArray(data.vaults))) throw new Error('Invalid Obsidian vault list');
  data.vaults ??= {};
  if (Object.values(data.vaults).some(entry => resolve(entry.path ?? '') === resolve(vault))) return 'already registered';
  const now = options.now ?? new Date();
  const stamp = now.toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
  await copyFile(configFile, `${configFile}.${stamp}.${randomBytes(3).toString('hex')}.bak`);
  data.vaults[randomBytes(8).toString('hex')] = { path: resolve(vault), ts: now.getTime(), open: false };
  await writeFile(configFile, `${JSON.stringify(data, null, 2)}\n`);
  return 'registered';
}

async function countNotes(dir: string): Promise<number> {
  let count = 0;
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory() && entry.name === '0-index') continue; // generated index, not memory
    if (entry.isDirectory()) count += await countNotes(join(dir, entry.name));
    else if (entry.isFile() && entry.name.endsWith('.md')) count++;
  }
  return count;
}

export interface VaultCheck {
  path: string;
  unsafe?: string;
  links: Array<{ name: string; state: 'ok' | 'broken' | 'conflict'; notes: number }>;
  missingProjects: string[];
  warnings: string[];
}
export async function checkVault(options: Pick<VaultOptions, 'path' | 'home' | 'eduHome' | 'platform'>): Promise<VaultCheck> {
  const path = resolve(options.path);
  const platform = options.platform ?? process.platform;
  const physical = await physicalCandidate(path).catch(() => path);
  const unsafe = unsafeVaultPathReason(path, options.home, platform)
    ?? unsafeVaultPathReason(physical, await physicalCandidate(options.home).catch(() => options.home), platform)
    ?? (await exists(join(path, '.edu')) ? 'contains a project brain' : undefined);
  const projects = (await readProjects(options.eduHome)).projects;
  const entries = [...projects.map(project => ({ name: segment(project.name), target: project.brain, project: true })),
    { name: '_global', target: join(options.eduHome, 'brain'), project: false }];
  const links: VaultCheck['links'] = [];
  const missingProjects: string[] = [];
  for (const entry of entries) {
    const present = await exists(entry.target);
    if (!present && entry.project) missingProjects.push(entry.name);
    const state = await linkState(join(path, 'Edu', entry.name), entry.target);
    links.push({ name: entry.name, state: state === 'conflict' ? 'conflict' : state === 'missing' || !present ? 'broken' : 'ok',
      notes: present ? await countNotes(entry.target) : 0 });
  }
  const warnings: string[] = [];
  for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || ['Edu', 'Notes', '.obsidian'].includes(entry.name)) continue;
    const notes = await countNotes(join(path, entry.name));
    if (notes >= 20) warnings.push(`${entry.name}/ contains ${notes} notes outside Edu/ and Notes/; another tool may be writing generated notes`);
  }
  return { path, unsafe, links, missingProjects, warnings };
}
