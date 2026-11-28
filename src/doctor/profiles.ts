/**
 * Read-only inventory of the brains on a machine.
 *
 * A profile is the parsed session value from `src/profile`: home, brain, and remote stay one binding.
 * A copy is a distinct brain directory (home, vault, or registered project). The same directory reached
 * by a junction is one copy. Doctor reports isolation breaks and does not repair them.
 */
import { realpathSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { INDEX_DIR, TIER_DIRS } from '../core/contracts.js';
import { stopsAtCeiling } from '../brain/location.js';
import {
  CHEIL_REMOTE,
  PERSONAL_REMOTE,
  ProfileError,
  loadSessionProfile,
  parseProfile,
  type Profile,
  type ProfileErrorCode,
} from '../profile/profile.js';

export type CopyKind = 'home' | 'vault' | 'project';

/** One brain directory. Note bodies are never read; `notes` is a file count. */
export interface BrainCopy {
  kind: CopyKind;
  /** Profile this copy belongs to, when the binding or the remote says so. */
  profile?: Profile['id'];
  /** Spelled path. A junction target is not written back over it. */
  root: string;
  /** Edu home that owns this copy, when it has one. */
  home?: string;
  /** Registry name for a project copy. */
  name?: string;
  /** Canonical `owner/repo`, or a redacted URL. Credentials are never kept. */
  remote?: string;
  notes: number;
}

/** A home whose `profile.json` (or implicit personal profile) does not parse. */
export interface ProfileRejection {
  id?: Profile['id'];
  /** Declared home, or the directory when the file declares none. */
  home: string;
  /** Directory that was read. */
  directory: string;
  brain?: string;
  remote?: string;
  code: ProfileErrorCode;
  message: string;
}

/** A personal binding that lands in Cheil, or a cheil binding that uses the personal remote. */
export interface IsolationFinding {
  code: 'cheil-root' | 'remote-mismatch';
  id: Profile['id'];
  home: string;
  brain?: string;
  field?: 'home' | 'brain';
  /** Cheil path, or `spelled -> target` when a junction resolves into `C:\Cheil`. */
  path?: string;
  remote?: string;
  expected?: string;
}

export interface CopiesReport {
  profiles: Profile[];
  rejected: ProfileRejection[];
  copies: BrainCopy[];
  findings: IsolationFinding[];
}

export interface DirEntry {
  name: string;
  kind: 'file' | 'dir' | 'link';
}

export interface CopiesRequest {
  /** `win32` parses Windows paths when the process is not Windows. */
  platform?: NodeJS.Platform;
  homes: readonly string[];
  vaults?: readonly string[];
  projects?: readonly { name: string; brain: string; home?: string }[];
  /** `EDU_CEILING_DIRECTORIES` stops the git-remote walk, the same way brain search stops. */
  env?: NodeJS.ProcessEnv;
  realpath?: (file: string) => string | undefined;
  readFile?: (file: string) => Promise<string>;
  readDir?: (dir: string) => Promise<readonly DirEntry[]>;
}

export interface ProfileLine {
  level: 'ok' | 'warn' | 'fail';
  text: string;
  /** Section text. The status glyph stays off so a heading stays a heading. */
  plain?: true;
}

type Paths = typeof path.win32;
type ReadText = (file: string) => Promise<string>;
type ReadDir = (dir: string) => Promise<readonly DirEntry[]>;
type RealPath = (file: string) => string | undefined;

const PROBE_HOME = 'D:\\edu-probe';
const PROBE_BRAIN = 'D:\\edu-probe\\brain';
const CONTENT_TIERS = [TIER_DIRS.canonical, TIER_DIRS.episodic, TIER_DIRS.transitive];
const BRAIN_DIRS = [INDEX_DIR, ...CONTENT_TIERS];

interface Candidate {
  kind: CopyKind;
  root: string;
  directory?: string;
  name?: string;
  declaredRemote?: string;
}

interface BuiltCopy extends BrainCopy {
  owner?: Profile['id'];
}

/** Non-zero only when an isolation finding is present. Other doctor warnings keep the old exit. */
export function isolationExitCode(report: CopiesReport): 0 | 1 {
  return report.findings.length > 0 ? 1 : 0;
}

function defaultRealpath(file: string): string | undefined {
  try { return realpathSync(file); }
  catch { return undefined; }
}

async function defaultReadDir(dir: string): Promise<readonly DirEntry[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.map(entry => ({
    name: entry.name,
    kind: entry.isSymbolicLink() ? 'link' : entry.isDirectory() ? 'dir' : entry.isFile() ? 'file' : 'link',
  }));
}

function codeOf(error: unknown): string | undefined {
  return error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

function samePath(left: string, right: string, platform: NodeJS.Platform): boolean {
  return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/** The profile module owns the Cheil-root rule. A probe parses a personal binding and catches that error. */
function crossesCheil(file: string, field: 'home' | 'brain', realpath: RealPath): boolean {
  const home = field === 'home' ? file : PROBE_HOME;
  const brain = field === 'brain' ? file : PROBE_BRAIN;
  try {
    parseProfile(
      { id: 'personal', home, brain, remote: PERSONAL_REMOTE },
      { platform: 'win32', realpath: candidate => (candidate === file ? realpath(candidate) : undefined) },
    );
    return false;
  } catch (error) {
    return error instanceof ProfileError && error.code === 'cheil-root' && error.message.includes(field);
  }
}

/** The profile module owns which URL is `owner/repo`. A probe accepts the remote for exactly one id. */
function remoteOwner(remote: string): Profile['id'] | undefined {
  for (const id of ['personal', 'cheil'] as const) {
    try {
      parseProfile(
        { id, home: PROBE_HOME, brain: PROBE_BRAIN, remote },
        { platform: 'win32', realpath: () => undefined },
      );
      return id;
    } catch (error) {
      if (error instanceof ProfileError && error.code === 'remote-mismatch') continue;
      return undefined;
    }
  }
  return undefined;
}

function redactRemote(raw: string): string {
  return raw.replace(/\/\/(?:[^@/\s]+)@/g, '//');
}

function canonicalRemote(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  const redacted = redactRemote(raw.trim());
  const owner = remoteOwner(redacted);
  if (owner === 'personal') return PERSONAL_REMOTE;
  if (owner === 'cheil') return CHEIL_REMOTE;
  return redacted;
}

function showPath(value: string | undefined, paths: Paths): string | undefined {
  if (!value) return undefined;
  return paths.isAbsolute(value) ? paths.resolve(value) : value;
}

function pickDeclared(raw: unknown, paths: Paths): { id?: Profile['id']; home?: string; brain?: string; remote?: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
  const id = record.id === 'personal' || record.id === 'cheil' ? record.id : undefined;
  return { id, home: showPath(text(record.home), paths), brain: showPath(text(record.brain), paths), remote: text(record.remote) };
}

/** A junction target, or undefined when the path is missing or the lookup throws. */
function linkedPath(file: string, realpath: RealPath): string | undefined {
  try {
    const found = realpath(file);
    return found || undefined;
  } catch {
    return undefined;
  }
}

function shownCheil(spelled: string, realpath: RealPath, paths: Paths): string {
  const display = paths.isAbsolute(spelled) ? paths.resolve(spelled) : spelled;
  const linked = linkedPath(spelled, realpath) ?? linkedPath(display, realpath);
  if (!linked) return display;
  const target = paths.isAbsolute(linked) ? paths.resolve(linked) : linked;
  const same = paths === path.win32 ? display.toLowerCase() === target.toLowerCase() : display === target;
  if (!same && crossesCheil(target, 'brain', () => undefined)) return `${display} -> ${target}`;
  return display;
}

function originUrl(config: string): string | undefined {
  let origin = false;
  for (const line of config.split(/\r?\n/)) {
    const section = /^\s*\[([^\]]+)]\s*$/.exec(line);
    if (section) {
      origin = /^remote\s+"origin"\s*$/.test(section[1] ?? '');
      continue;
    }
    if (!origin) continue;
    const url = /^\s*url\s*=\s*(\S.*?)\s*$/.exec(line);
    if (url?.[1]) return url[1];
  }
  return undefined;
}

async function readMaybe(readText: ReadText, file: string): Promise<string | undefined> {
  try { return await readText(file); }
  catch { return undefined; }
}

async function originAt(dir: string, readText: ReadText, paths: Paths): Promise<string | undefined> {
  const config = await readMaybe(readText, paths.join(dir, '.git', 'config'));
  if (config !== undefined) return originUrl(config);
  const pointer = await readMaybe(readText, paths.join(dir, '.git'));
  if (!pointer?.startsWith('gitdir:')) return undefined;
  const gitdir = pointer.slice('gitdir:'.length).trim();
  const abs = paths.isAbsolute(gitdir) ? gitdir : paths.resolve(dir, gitdir);
  const alt = await readMaybe(readText, paths.join(abs, 'config'));
  return alt === undefined ? undefined : originUrl(alt);
}

/** Walks parents for `origin`, and stops at `EDU_CEILING_DIRECTORIES` before leaving the sandbox. */
async function originFrom(start: string, readText: ReadText, paths: Paths, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  let current = paths.resolve(start);
  for (let depth = 0; depth < 8; depth++) {
    const found = await originAt(current, readText, paths);
    if (found) return found;
    const parent = paths.dirname(current);
    if (parent === current || stopsAtCeiling(parent, env)) break;
    current = parent;
  }
  return undefined;
}

async function listDir(dir: string, readDir: ReadDir): Promise<readonly DirEntry[] | undefined> {
  try { return await readDir(dir); }
  catch { return undefined; }
}

async function hasTiers(dir: string, readDir: ReadDir): Promise<boolean> {
  const entries = await listDir(dir, readDir);
  return entries?.some(entry => entry.kind === 'dir' && BRAIN_DIRS.includes(entry.name)) ?? false;
}

/** Counts markdown files in the three note tiers. Names are not kept and files are not opened. */
async function countNotes(root: string, readDir: ReadDir, paths: Paths): Promise<number> {
  const count = async (dir: string): Promise<number> => {
    const entries = await listDir(dir, readDir);
    if (!entries) return 0;
    let total = 0;
    for (const entry of entries) {
      if (entry.kind === 'file' && entry.name.endsWith('.md') && !entry.name.endsWith('.base.md')) total += 1;
      else if (entry.kind === 'dir') total += await count(paths.join(dir, entry.name));
    }
    return total;
  };
  let total = 0;
  for (const tier of CONTENT_TIERS) total += await count(paths.join(root, tier));
  return total;
}

async function declaredFields(home: string, readText: ReadText, paths: Paths): Promise<{ id?: Profile['id']; home?: string; brain?: string; remote?: string }> {
  let text: string;
  try { text = await readText(paths.join(home, 'profile.json')); }
  catch (error) {
    if (codeOf(error) === 'ENOENT') return { id: 'personal', home, brain: paths.join(home, 'brain'), remote: PERSONAL_REMOTE };
    return {};
  }
  try { return pickDeclared(JSON.parse(text.replace(/^\uFEFF/, '')) as unknown, paths); }
  catch { return {}; }
}

async function loadHome(home: string, platform: NodeJS.Platform, paths: Paths, realpath: RealPath, readText: ReadText): Promise<{ profile: Profile } | { rejection: ProfileRejection }> {
  try {
    const profile = await loadSessionProfile({ platform, env: { EDU_HOME: home }, readFile: readText, realpath, homedir: () => home });
    return { profile };
  } catch (error) {
    if (!(error instanceof ProfileError)) throw error;
    const declared = await declaredFields(home, readText, paths);
    return {
      rejection: {
        id: declared.id,
        home: declared.home ?? home,
        directory: home,
        brain: declared.brain,
        remote: canonicalRemote(declared.remote),
        code: error.code,
        message: error.message,
      },
    };
  }
}

function rejectionFinding(rejection: ProfileRejection, realpath: RealPath, paths: Paths): IsolationFinding | undefined {
  if (rejection.code === 'cheil-root' && rejection.id === 'personal') {
    const field = crossesCheil(rejection.home, 'home', realpath) ? 'home' : 'brain';
    const spelled = field === 'home' ? rejection.home : (rejection.brain ?? rejection.home);
    return { code: 'cheil-root', id: 'personal', home: rejection.directory, brain: rejection.brain, field, path: shownCheil(spelled, realpath, paths) };
  }
  if (rejection.code === 'remote-mismatch' && rejection.id) {
    return {
      code: 'remote-mismatch',
      id: rejection.id,
      home: rejection.directory,
      brain: rejection.brain,
      remote: rejection.remote,
      expected: rejection.id === 'personal' ? PERSONAL_REMOTE : CHEIL_REMOTE,
    };
  }
  return undefined;
}

function findingKey(finding: IsolationFinding, platform: NodeJS.Platform): string {
  const fold = (value: string | undefined) => (platform === 'win32' ? value?.toLowerCase() : value) ?? '';
  if (finding.code === 'remote-mismatch') return `remote\0${finding.id}\0${fold(finding.brain)}\0${finding.remote ?? ''}`;
  return `cheil\0${finding.id}\0${finding.field ?? ''}\0${fold(finding.path)}`;
}

function pushFinding(findings: IsolationFinding[], seen: Set<string>, finding: IsolationFinding, platform: NodeJS.Platform): void {
  const key = findingKey(finding, platform);
  if (seen.has(key)) return;
  seen.add(key);
  findings.push(finding);
}

function copyFinding(copy: BuiltCopy, realpath: RealPath, paths: Paths): IsolationFinding | undefined {
  const remoteId = copy.remote ? remoteOwner(copy.remote) : undefined;
  const pathCheil = crossesCheil(copy.root, 'brain', realpath);
  const home = copy.home ?? '';
  if ((copy.owner === 'personal' || (!copy.owner && remoteId === 'personal')) && pathCheil) {
    return { code: 'cheil-root', id: 'personal', home, brain: copy.root, field: 'brain', path: shownCheil(copy.root, realpath, paths) };
  }
  if (copy.owner === 'personal' && remoteId === 'cheil') {
    return { code: 'remote-mismatch', id: 'personal', home, brain: copy.root, remote: CHEIL_REMOTE, expected: PERSONAL_REMOTE };
  }
  if (copy.owner === 'cheil' && remoteId === 'personal') {
    return { code: 'remote-mismatch', id: 'cheil', home, brain: copy.root, remote: PERSONAL_REMOTE, expected: CHEIL_REMOTE };
  }
  return undefined;
}

/**
 * Lists profiles, distinct brain copies, and isolation findings.
 * Reads profile files, directory names, and git config. It does not write.
 */
export async function inspectCopies(request: CopiesRequest): Promise<CopiesReport> {
  const platform = request.platform ?? process.platform;
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const env = request.env ?? {};
  const realpath = request.realpath ?? defaultRealpath;
  const readText = request.readFile ?? (file => readFile(file, 'utf8'));
  const readDir = request.readDir ?? defaultReadDir;
  const homes: string[] = [];
  for (const home of request.homes) {
    const resolved = paths.resolve(home);
    if (!homes.some(item => samePath(item, resolved, platform))) homes.push(resolved);
  }

  const loaded = await Promise.all(homes.map(home => loadHome(home, platform, paths, realpath, readText)));
  const profiles: Profile[] = [];
  const rejected: ProfileRejection[] = [];
  const findings: IsolationFinding[] = [];
  const seen = new Set<string>();
  for (const item of loaded) {
    if ('profile' in item) profiles.push(item.profile);
    else {
      rejected.push(item.rejection);
      const finding = rejectionFinding(item.rejection, realpath, paths);
      if (finding) pushFinding(findings, seen, finding, platform);
    }
  }

  const ownerId = (directory: string | undefined): Profile['id'] | undefined => {
    if (!directory) return undefined;
    const profile = profiles.find(item => samePath(item.home, directory, platform));
    if (profile) return profile.id;
    return rejected.find(item => samePath(item.directory, directory, platform))?.id;
  };

  const identity = (file: string): string => {
    const resolved = paths.resolve(file);
    const linked = linkedPath(resolved, realpath) ?? linkedPath(file, realpath);
    const value = linked ? paths.resolve(linked) : resolved;
    return platform === 'win32' ? value.toLowerCase() : value;
  };

  const candidates: Candidate[] = [];
  for (const item of loaded) {
    const directory = 'profile' in item ? item.profile.home : item.rejection.directory;
    const brain = 'profile' in item ? item.profile.brain : item.rejection.brain;
    const declaredRemote = 'profile' in item ? item.profile.remote : item.rejection.remote;
    if (brain) candidates.push({ kind: 'home', root: brain, directory, declaredRemote });
    const stray = paths.join(directory, 'brain');
    if (brain && identity(stray) !== identity(brain) && await hasTiers(stray, readDir)) {
      candidates.push({ kind: 'home', root: stray, directory });
    }
  }
  for (const vault of request.vaults ?? []) {
    const resolved = paths.resolve(vault);
    const nested = paths.join(resolved, 'brain');
    // A parent's git remote does not make an Obsidian window into a second brain.
    const root = await hasTiers(resolved, readDir) ? resolved
      : await hasTiers(nested, readDir) ? nested
        : await originAt(resolved, readText, paths) ? resolved
          : undefined;
    if (root) candidates.push({ kind: 'vault', root });
  }
  for (const project of request.projects ?? []) {
    if (!project.brain.trim()) continue;
    candidates.push({
      kind: 'project',
      root: paths.resolve(project.brain),
      directory: project.home ? paths.resolve(project.home) : undefined,
      name: project.name,
    });
  }

  const built: BuiltCopy[] = [];
  for (const candidate of candidates) {
    const git = canonicalRemote(await originFrom(candidate.root, readText, paths, env));
    const remote = git ?? candidate.declaredRemote;
    const key = identity(candidate.root);
    const existing = built.find(copy => identity(copy.root) === key);
    if (existing) {
      if (!existing.remote && remote) existing.remote = remote;
      if (!existing.name && candidate.name) existing.name = candidate.name;
      continue;
    }
    const owner = ownerId(candidate.directory);
    const pathCheil = crossesCheil(candidate.root, 'brain', realpath);
    const remoteId = remote ? remoteOwner(remote) : undefined;
    built.push({
      kind: candidate.kind,
      root: paths.resolve(candidate.root),
      home: candidate.directory,
      name: candidate.name,
      remote,
      notes: await countNotes(candidate.root, readDir, paths),
      owner,
      profile: owner ?? remoteId ?? (pathCheil ? 'cheil' : undefined),
    });
  }
  for (const copy of built) {
    const finding = copyFinding(copy, realpath, paths);
    if (finding) pushFinding(findings, seen, finding, platform);
  }
  const copies = built.map(copy => publish(copy));
  return { profiles, rejected, copies, findings };
}

function publish(copy: BuiltCopy): BrainCopy {
  return {
    kind: copy.kind,
    root: copy.root,
    notes: copy.notes,
    ...(copy.profile ? { profile: copy.profile } : {}),
    ...(copy.home ? { home: copy.home } : {}),
    ...(copy.name ? { name: copy.name } : {}),
    ...(copy.remote ? { remote: copy.remote } : {}),
  };
}

const KIND_WIDTH = 8;
const PROFILE_WIDTH = 8;
const NOTES_WIDTH = 5;

function kindLabel(kind: CopyKind, lang: 'en' | 'es'): string {
  if (lang === 'es') return kind === 'home' ? 'hogar' : kind === 'project' ? 'proyecto' : 'vault';
  return kind;
}

function fieldLabel(field: 'home' | 'brain' | 'remote', lang: 'en' | 'es'): string {
  if (lang === 'es') return field === 'home' ? 'hogar' : field === 'brain' ? 'cerebro' : 'remoto';
  return field;
}

function isolationText(finding: IsolationFinding, lang: 'en' | 'es'): string {
  if (finding.code === 'cheil-root') {
    const field = fieldLabel(finding.field ?? 'brain', lang);
    return lang === 'es'
      ? `perfil ${finding.id}: el ${field} apunta a C:\\Cheil (${finding.path ?? ''})`
      : `${finding.id} profile: ${field} points at C:\\Cheil (${finding.path ?? ''})`;
  }
  return lang === 'es'
    ? `perfil ${finding.id}: el remoto es ${finding.remote ?? '-'}; ${finding.id} usa ${finding.expected ?? ''}`
    : `${finding.id} profile: remote is ${finding.remote ?? '-'}; ${finding.id} uses ${finding.expected ?? ''}`;
}

/** A Profiles section: one block per profile, then one row per copy. Sized for an 80-column terminal. */
export function formatProfileLines(report: CopiesReport, lang: 'en' | 'es'): ProfileLine[] {
  const lines: ProfileLine[] = [{ level: 'ok', text: lang === 'es' ? 'Perfiles' : 'Profiles', plain: true }];
  const blocks = [
    ...report.profiles.map(profile => ({ id: profile.id, home: profile.home, brain: profile.brain, remote: profile.remote })),
    ...report.rejected.map(rejection => ({ id: rejection.id, home: rejection.home, brain: rejection.brain, remote: rejection.remote })),
  ];
  for (const block of blocks) {
    lines.push({ level: 'ok', text: `  ${block.id ?? 'profile'}`, plain: true });
    lines.push({ level: 'ok', text: `    ${fieldLabel('home', lang).padEnd(7)} ${block.home}`, plain: true });
    lines.push({ level: 'ok', text: `    ${fieldLabel('brain', lang).padEnd(7)} ${block.brain ?? '-'}`, plain: true });
    lines.push({ level: 'ok', text: `    ${fieldLabel('remote', lang).padEnd(7)} ${block.remote ?? '-'}`, plain: true });
  }
  lines.push({ level: 'ok', text: '', plain: true });
  lines.push({ level: 'ok', text: lang === 'es' ? 'Copias' : 'Copies', plain: true });
  const kind = lang === 'es' ? 'tipo' : 'kind';
  const profile = lang === 'es' ? 'perfil' : 'profile';
  const notes = lang === 'es' ? 'notas' : 'notes';
  const remote = lang === 'es' ? 'remoto' : 'remote';
  lines.push({
    level: 'ok',
    text: `  ${kind.padEnd(KIND_WIDTH)} ${profile.padEnd(PROFILE_WIDTH)} ${notes.padStart(NOTES_WIDTH)}  ${remote}`,
    plain: true,
  });
  for (const copy of report.copies) {
    lines.push({
      level: 'ok',
      text: `  ${kindLabel(copy.kind, lang).padEnd(KIND_WIDTH)} ${(copy.profile ?? '-').padEnd(PROFILE_WIDTH)} ${String(copy.notes).padStart(NOTES_WIDTH)}  ${copy.remote ?? '-'}`,
      plain: true,
    });
    lines.push({ level: 'ok', text: `    ${copy.root}${copy.name ? `  (${copy.name})` : ''}`, plain: true });
  }
  for (const finding of report.findings) lines.push({ level: 'fail', text: isolationText(finding, lang) });
  for (const rejection of report.rejected) {
    if (rejection.code === 'cheil-root' || rejection.code === 'remote-mismatch') continue;
    lines.push({ level: 'warn', text: rejection.message });
  }
  return lines;
}
