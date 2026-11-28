/**
 * The session profile. A session has one of `personal` or `cheil`.
 *
 * The profile binds the Edu home (`EDU_HOME`), the brain root, and the git remote. After parse, a cheil
 * profile's remote is `EduardoMCheil/cheil-vault`, and a personal profile's remote is `EduardoMoraga/edu-vault`
 * with its home and brain outside `C:\Cheil`.
 *
 * No `profile.json` keeps today's layout. The home comes from `EDU_HOME`, otherwise `~/.edu` (`HOME`, then
 * `USERPROFILE`), and the brain is `<home>/brain`.
 */
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir as osHomedir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

export const PERSONAL_REMOTE = 'EduardoMoraga/edu-vault' as const;
export const CHEIL_REMOTE = 'EduardoMCheil/cheil-vault' as const;

const CHEIL_ROOT = 'c:\\cheil';

export type ProfileErrorCode = 'invalid' | 'unreadable' | 'remote-mismatch' | 'cheil-root' | 'home-mismatch';

export class ProfileError extends Error {
  readonly code: ProfileErrorCode;
  constructor(code: ProfileErrorCode, message: string) {
    super(message);
    this.name = 'ProfileError';
    this.code = code;
  }
}

export interface PersonalProfile {
  readonly id: 'personal';
  readonly home: string;
  readonly brain: string;
  readonly remote: typeof PERSONAL_REMOTE;
}

export interface CheilProfile {
  readonly id: 'cheil';
  readonly home: string;
  readonly brain: string;
  readonly remote: typeof CHEIL_REMOTE;
}

export type Profile = PersonalProfile | CheilProfile;

export interface ProfileOptions {
  /** `win32` parses Windows paths even when the process is not Windows. */
  platform?: NodeJS.Platform;
  /**
   * Resolves an existing path through a junction or symlink. A missing path returns undefined.
   * A personal home or brain is inside Cheil when the spelled path or this path is inside `C:\Cheil`.
   */
  realpath?: (file: string) => string | undefined;
}

export interface SessionSource extends ProfileOptions {
  env: NodeJS.ProcessEnv;
  /** Reads `<home>/profile.json`. ENOENT means there is no profile file. */
  readFile?: (file: string) => Promise<string>;
  /** Used only when `EDU_HOME`, `HOME`, and `USERPROFILE` are all unset. */
  homedir?: () => string;
}

type Paths = typeof path.win32;
type ProfileId = Profile['id'];

const ProfileFileSchema = z.object({
  id: z.enum(['personal', 'cheil'], { error: 'must be personal or cheil' }),
  home: z.string({ error: 'must be text' }).trim().min(1, { error: 'is required' }),
  brain: z.string({ error: 'must be text' }).trim().min(1, { error: 'is required' }),
  remote: z.string({ error: 'must be text' }).trim().min(1, { error: 'is required' }),
}).strict();

const pathsFor = (platform: NodeJS.Platform): Paths => platform === 'win32' ? path.win32 : path.posix;

const present = (value: string | undefined): string | undefined => {
  const text = value?.trim();
  return text ? text : undefined;
};

function defaultRealpath(file: string): string | undefined {
  try { return realpathSync(file); }
  catch { return undefined; }
}

function invalidMessage(error: z.ZodError): string {
  return error.issues.slice(0, 3).map(issue => {
    if (issue.code === 'unrecognized_keys') return `${issue.keys.join(', ')} is not a profile field`;
    const field = issue.path.length ? issue.path.join('.') : 'profile';
    return `${field} ${issue.message}`;
  }).join('; ');
}

/** True when `file` is `C:\Cheil` or a directory inside it. A POSIX path is never inside that root. */
function underCheil(file: string): boolean {
  const windowsAbsolute = /^[a-zA-Z]:[\\/]/.test(file) || /^[\\/]{2}[^\\/]/.test(file);
  if (!windowsAbsolute) return false;
  const folded = path.win32.resolve(file).replace(/\//g, '\\').toLowerCase();
  const rel = path.win32.relative(CHEIL_ROOT, folded);
  const parent = `..${path.win32.sep}`;
  return rel === '' || (!path.win32.isAbsolute(rel) && rel !== '..' && !rel.startsWith(parent));
}

/** A junction target, or undefined when the path is missing. A throw stays on the spelled path. */
function linkedPath(file: string, realpath: (file: string) => string | undefined): string | undefined {
  try {
    const found = realpath(file);
    return found || undefined;
  } catch {
    return undefined;
  }
}

function assertOutsideCheil(field: 'home' | 'brain', file: string, realpath: (file: string) => string | undefined): void {
  const linked = linkedPath(file, realpath);
  if (underCheil(file) || (linked !== undefined && underCheil(linked))) {
    throw new ProfileError('cheil-root', `personal profile ${field} must stay outside C:\\Cheil`);
  }
}

/** `owner/repo` for a github.com remote in one of the accepted forms, otherwise undefined. */
function canonicalRemote(raw: string): string | undefined {
  const text = raw.trim();
  const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/]*)/i.exec(text)?.[1];
  if (authority?.includes('@')) {
    const user = authority.slice(0, authority.lastIndexOf('@'));
    if (!(text.startsWith('ssh://') && user === 'git')) return undefined;
  }
  const stripped = text.endsWith('.git') ? text.slice(0, -4) : text;
  const ownerRepo = /^git@github\.com:(.+)$/.exec(stripped)?.[1]
    ?? /^ssh:\/\/git@github\.com\/(.+)$/.exec(stripped)?.[1]
    ?? /^https:\/\/github\.com\/(.+)$/.exec(stripped)?.[1]
    ?? (/^[^:\s]+\/[^/\s]+$/.test(stripped) ? stripped : undefined);
  if (!ownerRepo) return undefined;
  const parts = ownerRepo.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
  return `${parts[0]}/${parts[1]}`;
}

function requiredRemote(id: ProfileId): typeof PERSONAL_REMOTE | typeof CHEIL_REMOTE {
  return id === 'personal' ? PERSONAL_REMOTE : CHEIL_REMOTE;
}

const OTHER_REMOTE: Record<ProfileId, typeof PERSONAL_REMOTE | typeof CHEIL_REMOTE> = {
  personal: CHEIL_REMOTE,
  cheil: PERSONAL_REMOTE,
};

function withoutUserInfo(raw: string): string {
  return raw.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/i, '$1');
}

/** True when `remote` names the other profile's GitHub vault, in any accepted URL form. */
export function remoteBelongsToOtherProfile(profile: Profile, remote: string): boolean {
  const canonical = canonicalRemote(withoutUserInfo(remote));
  return canonical !== undefined && canonical.toLowerCase() === OTHER_REMOTE[profile.id].toLowerCase();
}

function windowsPath(file: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(file) || file.startsWith('\\\\');
}

function containsPath(parent: string, child: string): boolean {
  if (windowsPath(parent) !== windowsPath(child)) return false;
  const paths = windowsPath(child) ? path.win32 : path.posix;
  const fold = (value: string) => {
    const resolved = paths.resolve(value);
    return windowsPath(child) ? resolved.replace(/\//g, '\\').toLowerCase() : resolved;
  };
  const rel = paths.relative(fold(parent), fold(child));
  return rel === '' || (!paths.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../'));
}

/**
 * True when `resolved` sits in the other profile's filesystem territory.
 * Personal territory is outside `C:\Cheil`. Cheil territory is `C:\Cheil` plus this profile's home,
 * brain, and vault, so a cheil vault that lives on another drive is still its own.
 */
export function pathBelongsToOtherProfile(profile: Profile, resolved: string, anchors: { vault?: string } = {}): boolean {
  if (profile.id === 'personal') return underCheil(resolved);
  if (underCheil(resolved) || containsPath(profile.home, resolved) || containsPath(profile.brain, resolved)) return false;
  if (anchors.vault && containsPath(anchors.vault, resolved)) return false;
  return windowsPath(resolved);
}

function absolutePath(field: 'home' | 'brain', value: string, paths: Paths): string {
  if (!paths.isAbsolute(value)) throw new ProfileError('invalid', `${field} must be an absolute path`);
  return paths.resolve(value);
}

/** Parses a profile fixture or a `profile.json` object. Throws `ProfileError` for an illegal binding. */
export function parseProfile(input: unknown, options: ProfileOptions = {}): Profile {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ProfileError('invalid', 'profile must be an object');
  const parsed = ProfileFileSchema.safeParse(input);
  if (!parsed.success) throw new ProfileError('invalid', invalidMessage(parsed.error));
  const paths = pathsFor(options.platform ?? process.platform);
  const realpath = options.realpath ?? defaultRealpath;
  const home = absolutePath('home', parsed.data.home, paths);
  const brain = absolutePath('brain', parsed.data.brain, paths);
  const remote = canonicalRemote(parsed.data.remote);
  const required = requiredRemote(parsed.data.id);
  if (remote !== required) throw new ProfileError('remote-mismatch', `${parsed.data.id} profile remote must be ${required}`);
  if (parsed.data.id === 'personal') {
    assertOutsideCheil('home', home, realpath);
    assertOutsideCheil('brain', brain, realpath);
    return { id: 'personal', home, brain, remote: PERSONAL_REMOTE };
  }
  return { id: 'cheil', home, brain, remote: CHEIL_REMOTE };
}

function sessionHome(env: NodeJS.ProcessEnv, paths: Paths, homedir: () => string): string {
  const eduHome = present(env.EDU_HOME);
  if (eduHome) return paths.resolve(eduHome);
  const user = present(env.HOME) || present(env.USERPROFILE) || homedir();
  return paths.resolve(paths.join(user, '.edu'));
}

function sameHome(left: string, right: string, platform: NodeJS.Platform): boolean {
  return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function implicitPersonal(home: string, paths: Paths, realpath: (file: string) => string | undefined): PersonalProfile {
  const brain = paths.resolve(paths.join(home, 'brain'));
  assertOutsideCheil('home', home, realpath);
  assertOutsideCheil('brain', brain, realpath);
  return { id: 'personal', home, brain, remote: PERSONAL_REMOTE };
}

function errorCode(error: unknown): string | undefined {
  return error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

/**
 * The one profile for this session. A missing `<home>/profile.json` is the implicit personal profile.
 * The home is `EDU_HOME` when set, otherwise `~/.edu`.
 */
export async function loadSessionProfile(source: SessionSource): Promise<Profile> {
  const platform = source.platform ?? process.platform;
  const paths = pathsFor(platform);
  const realpath = source.realpath ?? defaultRealpath;
  const home = sessionHome(source.env, paths, source.homedir ?? osHomedir);
  const file = paths.join(home, 'profile.json');
  const read = source.readFile ?? (file => readFile(file, 'utf8'));
  let text: string;
  try { text = await read(file); }
  catch (error) {
    if (errorCode(error) === 'ENOENT') return implicitPersonal(home, paths, realpath);
    const detail = error instanceof Error ? error.message : String(error);
    throw new ProfileError('unreadable', `unable to read ${file}: ${detail}`);
  }
  let raw: unknown;
  try { raw = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new ProfileError('invalid', `profile.json is not valid JSON: ${file}`); }
  const profile = parseProfile(raw, { platform, realpath });
  if (!sameHome(profile.home, home, platform)) {
    throw new ProfileError('home-mismatch', `profile.json home ${profile.home} does not match the session home ${home}`);
  }
  return profile;
}
