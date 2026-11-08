/**
 * `edu join <repo>`: attach this machine (or a cloud sandbox) to the shared brain repository.
 *
 * Contract: non-interactive, idempotent, never deletes a local note.
 * - No brain yet: clone the repository (optionally the brain lives in `subdir`) and link
 *   `<eduHome>/brain` to it.
 * - A brain that is not a Git repository: when the repository is the brain itself, Git is initialised
 *   in place, the local notes are committed and merged with the remote (unrelated histories allowed);
 *   otherwise the repository is cloned next to it, the local notes are copied in, and the old folder is
 *   kept as a backup before the link is switched.
 * - Both sides changed the same path: the remote version keeps the name and the local copy is saved as
 *   `<name>.local-<host>.md`. Generated files take the remote copy; append-only logs are unioned.
 * - Already linked to the same remote: nothing to set up, just sync.
 * Credentials come from the environment (Git credential helpers, `GH_TOKEN`); any URL printed is redacted.
 */
import { copyFile, lstat, mkdir, readdir, readFile, readlink, realpath, rename, symlink, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { createVaultLink } from '../cli/link.js';
import { git, gitLines, redact, sameRemote } from './git.js';
import { ensureRepoFiles, isAppendOnly, isGenerated, mergeAppendOnly, syncBrain, type SyncResult } from './sync.js';

export type JoinAction = 'cloned' | 'merged' | 'imported' | 'already-joined';

export interface JoinOptions {
  url: string;
  eduHome: string;
  /** Where the repository lives; default the brain folder itself (or `<eduHome>/vault` with `subdir`). */
  path?: string;
  /** Folder inside the repository that holds the brain (for example `01-CONOCIMIENTO`). */
  subdir?: string;
  branch?: string;
  cloud?: boolean;
  host?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  now?: () => Date;
  /** Skip the final sync (tests and dry setups). */
  sync?: boolean;
}

export interface KeptBoth { path: string; local: string }

export interface JoinReport {
  action: JoinAction;
  /** Remote URL with any credentials redacted. */
  remote: string;
  branch: string;
  repo: string;
  brain: string;
  /** `<eduHome>/brain`, linked to `brain` when they differ. */
  link: string;
  /** Files only this machine had, now in the shared history. */
  added: string[];
  /** Paths both sides had with different content: the local copy's new name. */
  keptBoth: KeptBoth[];
  /** The previous brain folder, kept untouched, when the brain moved into a clone. */
  backup?: string;
  /** Repository housekeeping (.gitignore, Git identity). */
  setup: string[];
  sync?: SyncResult;
}

const exists = (path: string) => lstat(path).then(() => true, () => false);

/** `notes/a.md` → `notes/a.local-<host>.md`. */
export function localCopyName(path: string, host: string): string {
  const ext = extname(path);
  return `${ext ? path.slice(0, -ext.length) : path}.local-${host}${ext}`;
}

/** `.gitignore`-style files: a clash keeps every line of both sides. */
const isLineSet = (path: string) => /(^|\/)\.git(ignore|attributes)$/.test(path);

function unionLines(remote: string, local: string): string {
  const seen = new Set<string>();
  const keep = [...remote.split(/\r?\n/), ...local.split(/\r?\n/)].filter(line => line.trim() === '' ? false : !seen.has(line) && Boolean(seen.add(line)));
  return `${keep.join('\n')}\n`;
}

/** Text for a path both sides have, when Edu can merge it without a person; undefined otherwise. */
function autoMerge(path: string, remote: string, local: string): string | undefined {
  if (isAppendOnly(path)) return mergeAppendOnly(remote, local);
  if (isLineSet(path)) return unionLines(remote, local);
  if (isGenerated(path)) return remote;
  return undefined;
}

export async function joinBrain(options: JoinOptions): Promise<JoinReport> {
  const env = options.env ?? process.env;
  try {
    return await join_(options, env);
  } catch (error) {
    throw new Error(redact((error as Error).message, env));
  }
}

async function join_(options: JoinOptions, env: NodeJS.ProcessEnv): Promise<JoinReport> {
  const host = (options.host ?? `${options.cloud ? 'cloud-' : ''}${hostname().split('.')[0]}`).replace(/[^\w.-]+/g, '-');
  const branch = options.branch ?? 'main';
  const subdir = options.subdir?.replace(/[\\/]+$/, '') || undefined;
  if (subdir && (subdir.split(/[\\/]/).includes('..') || resolve('/', subdir) === resolve('/'))) throw new Error(`invalid --subdir: ${subdir}`);
  const link = join(options.eduHome, 'brain');
  const report = (action: JoinAction, repo: string, brain: string, extra: Partial<JoinReport> = {}): JoinReport =>
    ({ action, remote: redact(options.url, env), branch, repo, brain, link, added: [], keptBoth: [], setup: [], ...extra });

  let result: JoinReport;
  if (await exists(link)) {
    const current = await realpath(link).catch(() => { throw new Error(`${link} is a broken link; fix or remove it, then run edu join again`); });
    const top = await git(current, ['rev-parse', '--show-toplevel'], env);
    if (top.code === 0 && !await isInside(current, options.eduHome, top.out.trim())) {
      const repo = top.out.trim();
      const origin = (await git(repo, ['remote', 'get-url', 'origin'], env)).out.trim();
      if (origin && sameRemote(origin, options.url)) result = report('already-joined', repo, current);
      else if (origin) throw new Error(`the brain is already linked to ${redact(origin, env)}; refusing to change it`);
      else result = report('merged', repo, current, await mergeRemote(repo, options.url, branch, host, env));
    } else if (!subdir && (!options.path || await samePath(options.path, current))) {
      result = report('merged', current, current, await mergeRemote(current, options.url, branch, host, env));
    } else {
      const repo = resolve(options.path ?? join(options.eduHome, 'vault'));
      const prepared = await prepareRepo(repo, options.url, branch, host, env);
      const brain = subdir ? join(repo, subdir) : repo;
      await mkdir(brain, { recursive: true });
      const imported = await importInto(current, brain, host);
      await ensureRepoFiles(repo, env);
      await git(repo, ['add', '-A'], env);
      if ((await git(repo, ['diff', '--cached', '--quiet'], env)).code !== 0) {
        const commit = await git(repo, ['commit', '-q', '--no-verify', '-m', `chore: join ${host}: bring this machine's brain into the shared brain`], env);
        if (commit.code !== 0) throw new Error(`commit failed: ${commit.err.trim()}`);
      }
      const stamp = (options.now ?? (() => new Date()))().toISOString().replace(/[:.]/g, '-');
      const backup = `${link}.pre-join-${stamp}`;
      await rename(link, backup);
      await createVaultLink(link, brain, options.platform);
      result = report('imported', repo, brain, {
        added: [...prepared.added, ...imported.added], keptBoth: [...prepared.keptBoth, ...imported.keptBoth], backup,
      });
    }
  } else {
    const repo = resolve(options.path ?? (subdir ? join(options.eduHome, 'vault') : link));
    const prepared = await prepareRepo(repo, options.url, branch, host, env);
    const brain = subdir ? join(repo, subdir) : repo;
    await mkdir(brain, { recursive: true });
    if (resolve(brain) !== resolve(link)) await createVaultLink(link, brain, options.platform);
    result = report(prepared.action, repo, brain, { added: prepared.added, keptBoth: prepared.keptBoth });
  }

  await ensureIdentity(result.repo, host, env);
  if ((await git(result.repo, ['config', '--local', 'user.name'], env)).out.trim() === `Edu (${host})`) {
    result.setup.push(`Git identity for this repository: Edu (${host}) (no global identity was set)`);
  }
  result.setup.push(...await ensureRepoFiles(result.repo, env));
  if (options.sync !== false) {
    result.sync = await syncBrain({ eduHome: options.eduHome, host, cloud: options.cloud, reason: 'join', env, now: options.now });
  }
  return result;
}

/** True when `path` is inside `eduHome` but its repository is a parent of `eduHome` (e.g. a dotfiles repo). */
async function isInside(path: string, eduHome: string, repo: string): Promise<boolean> {
  const home = await realpath(eduHome).catch(() => resolve(eduHome));
  const rel = relative(repo, home);
  return rel !== '' && !rel.startsWith('..') && path.startsWith(home + sep);
}

async function samePath(a: string, b: string): Promise<boolean> {
  return (await realpath(a).catch(() => resolve(a))) === (await realpath(b).catch(() => resolve(b)));
}

interface Prepared { action: 'cloned' | 'merged' | 'already-joined'; added: string[]; keptBoth: KeptBoth[] }

/** Makes `repo` a checkout of `url`: clone when empty, merge when it has files, reuse when it already is one. */
async function prepareRepo(repo: string, url: string, branch: string, host: string, env: NodeJS.ProcessEnv): Promise<Prepared> {
  const entries = await readdir(repo).catch(() => [] as string[]);
  if (entries.length) {
    const top = await git(repo, ['rev-parse', '--show-toplevel'], env);
    if (top.code === 0 && await samePath(top.out.trim(), repo)) {
      const origin = (await git(repo, ['remote', 'get-url', 'origin'], env)).out.trim();
      if (origin && sameRemote(origin, url)) return { action: 'already-joined', added: [], keptBoth: [] };
      if (origin) throw new Error(`${repo} is a clone of ${redact(origin, env)}, not of ${redact(url, env)}`);
    }
    return { action: 'merged', ...await mergeRemote(repo, url, branch, host, env) };
  }
  await mkdir(dirname(repo), { recursive: true });
  const heads = await git(dirname(repo), ['ls-remote', '--heads', url], env);
  if (heads.code !== 0) throw new Error(`cannot reach ${url}: ${heads.err.trim().split('\n').pop() ?? ''}`);
  if (!heads.out.trim()) {
    // An empty repository: start the branch here; the first sync publishes it.
    const clone = await git(dirname(repo), ['clone', '-q', url, repo], env);
    if (clone.code !== 0) throw new Error(`clone failed: ${clone.err.trim()}`);
    await git(repo, ['symbolic-ref', 'HEAD', `refs/heads/${branch}`], env);
    await publishFirst(repo, branch, host, env);
    return { action: 'cloned', added: [], keptBoth: [] };
  }
  if (!gitLines(heads.out).some(line => line.endsWith(`refs/heads/${branch}`))) throw new Error(`branch ${branch} not found in ${url}`);
  const clone = await git(dirname(repo), ['clone', '-q', '--branch', branch, url, repo], env);
  if (clone.code !== 0) throw new Error(`clone failed: ${clone.err.trim()}`);
  return { action: 'cloned', added: [], keptBoth: [] };
}

/** First commit and push to an empty remote (sync needs the branch to exist upstream). */
async function publishFirst(repo: string, branch: string, host: string, env: NodeJS.ProcessEnv): Promise<void> {
  await ensureIdentity(repo, host, env);
  await ensureRepoFiles(repo, env);
  await git(repo, ['add', '-A'], env);
  if ((await git(repo, ['diff', '--cached', '--quiet'], env)).code !== 0 || (await git(repo, ['rev-parse', '-q', '--verify', 'HEAD'], env)).code !== 0) {
    const commit = await git(repo, ['commit', '-q', '--no-verify', '--allow-empty', '-m', `chore: start the shared brain from ${host}`], env);
    if (commit.code !== 0) throw new Error(`commit failed: ${commit.err.trim()}`);
  }
  const push = await git(repo, ['push', '-q', '-u', 'origin', `HEAD:${branch}`], env);
  if (push.code !== 0) throw new Error(`push failed: ${push.err.trim()}`);
}

/** Commits what `dir` has, adds `origin` and merges the remote branch, keeping both versions of any clash. */
async function mergeRemote(dir: string, url: string, branch: string, host: string, env: NodeJS.ProcessEnv): Promise<{ added: string[]; keptBoth: KeptBoth[] }> {
  const g = (...args: string[]) => git(dir, args, env);
  if ((await g('rev-parse', '--show-toplevel')).code !== 0 || !await samePath((await g('rev-parse', '--show-toplevel')).out.trim(), dir)) {
    const init = await g('init', '-q', '-b', branch);
    if (init.code !== 0) throw new Error(`git init failed: ${init.err.trim()}`);
  }
  await ensureIdentity(dir, host, env);
  // The local exposure ledger never enters history; .gitignore comes after the merge to avoid a clash.
  const exclude = resolve(dir, (await g('rev-parse', '--git-path', 'info/exclude')).out.trim());
  const rules = await readFile(exclude, 'utf8').catch(() => '');
  if (!rules.split(/\r?\n/).includes('.edu-local/')) {
    await mkdir(dirname(exclude), { recursive: true });
    await writeFile(exclude, `${rules}${rules && !rules.endsWith('\n') ? '\n' : ''}.edu-local/\n`);
  }
  await g('add', '-A');
  if ((await g('diff', '--cached', '--quiet')).code !== 0) {
    const commit = await g('commit', '-q', '--no-verify', '-m', `chore: brain of ${host} before join`);
    if (commit.code !== 0) throw new Error(`commit failed: ${commit.err.trim()}`);
  }
  const hasHead = (await g('rev-parse', '-q', '--verify', 'HEAD')).code === 0;
  if (hasHead) await g('branch', '-M', branch);
  else await g('symbolic-ref', 'HEAD', `refs/heads/${branch}`);
  if ((await g('remote', 'add', 'origin', url)).code !== 0) await g('remote', 'set-url', 'origin', url);
  const heads = await g('ls-remote', '--heads', 'origin');
  if (heads.code !== 0) throw new Error(`cannot reach ${url}: ${heads.err.trim().split('\n').pop() ?? ''}`);
  if (!heads.out.trim()) {
    await publishFirst(dir, branch, host, env);
    return { added: gitLines((await g('-c', 'core.quotepath=off', 'ls-files')).out), keptBoth: [] };
  }
  const upstream = `origin/${branch}`;
  const fetch = async () => {
    const fetched = await g('fetch', '-q', 'origin', branch);
    if (fetched.code !== 0) throw new Error(`cannot fetch ${branch}: ${fetched.err.trim().split('\n').pop() ?? ''}`);
    await g('update-ref', `refs/remotes/${upstream}`, 'FETCH_HEAD');
  };
  await fetch();
  if (!hasHead) {
    await g('reset', '-q', '--hard', upstream);
    await g('branch', '-q', '-u', upstream);
    return { added: [], keptBoth: [] };
  }
  const remoteFiles = new Set(gitLines((await g('-c', 'core.quotepath=off', 'ls-tree', '-r', '--name-only', upstream)).out));
  const added = gitLines((await g('-c', 'core.quotepath=off', 'ls-tree', '-r', '--name-only', 'HEAD')).out).filter(file => !remoteFiles.has(file));
  const keptBoth: KeptBoth[] = [];
  // Publish the merge here: a later `edu sync` rebases, which would flatten (and re-conflict) this merge commit.
  for (let attempt = 1; ; attempt++) {
    await mergeUpstream(dir, upstream, host, env, keptBoth);
    if ((await g('push', '-q', 'origin', `HEAD:${branch}`)).code === 0) break;
    if (attempt === 3) throw new Error(`push to ${branch} rejected three times; the merge is committed locally, run edu join again`);
    await fetch();
  }
  await g('branch', '-q', '-u', upstream);
  return { added, keptBoth };
}

/** Merges `upstream` into HEAD; a path both sides changed keeps the remote version and a `.local-<host>` copy. */
async function mergeUpstream(dir: string, upstream: string, host: string, env: NodeJS.ProcessEnv, keptBoth: KeptBoth[]): Promise<void> {
  const g = (...args: string[]) => git(dir, args, env);
  const merge = await g('merge', '-q', '--no-edit', '--allow-unrelated-histories', upstream);
  if (merge.code !== 0) {
    const conflicted = gitLines((await g('-c', 'core.quotepath=off', 'diff', '--name-only', '--diff-filter=U')).out);
    if (!conflicted.length) { await g('merge', '--abort'); throw new Error(`merge failed: ${merge.err.trim() || merge.out.trim()}`); }
    for (const file of conflicted) {
      // In a merge stage 2 ("ours") is this machine, stage 3 the remote.
      const local = await g('show', `:2:${file}`);
      const remote = await g('show', `:3:${file}`);
      const merged = remote.code === 0 && local.code === 0 ? autoMerge(file, remote.out, local.out) : undefined;
      if (merged !== undefined) {
        await writeFile(join(dir, file), merged);
      } else if (remote.code !== 0) {
        // Deleted upstream, kept here: keep the local file.
        if (local.code === 0) await writeFile(join(dir, file), local.out);
      } else {
        if (local.code === 0) {
          const name = localCopyName(file, host);
          await writeFile(join(dir, name), local.out);
          await g('add', '--', name);
          keptBoth.push({ path: file, local: name });
        }
        await g('checkout', '--theirs', '--', file);
      }
      await g('add', '--', file);
    }
    const commit = await g('commit', '-q', '--no-verify', '-m', `chore: join ${host}: merge the shared brain, keeping both versions of ${keptBoth.length} file(s)`);
    if (commit.code !== 0) throw new Error(`merge commit failed: ${commit.err.trim()}`);
  }
}

/** Copies every file of `src` into `dest` without overwriting: clashes keep the local copy as `.local-<host>`. */
async function importInto(src: string, dest: string, host: string, rel = ''): Promise<{ added: string[]; keptBoth: KeptBoth[] }> {
  const out = { added: [] as string[], keptBoth: [] as KeptBoth[] };
  for (const entry of await readdir(join(src, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.name === '.git') continue;
    const from = join(src, path);
    const to = join(dest, path);
    if (entry.isDirectory()) {
      const nested = await importInto(src, dest, host, path);
      out.added.push(...nested.added); out.keptBoth.push(...nested.keptBoth);
      continue;
    }
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    if (!await exists(to)) {
      await mkdir(dirname(to), { recursive: true });
      if (entry.isSymbolicLink()) await symlink(await readlink(from), to);
      else await copyFile(from, to);
      out.added.push(path);
      continue;
    }
    if (entry.isSymbolicLink()) continue;
    const [mine, theirs] = await Promise.all([readFile(from), readFile(to).catch(() => undefined)]);
    if (theirs && mine.equals(theirs)) continue;
    const merged = theirs ? autoMerge(path, theirs.toString('utf8'), mine.toString('utf8')) : undefined;
    if (merged !== undefined) { if (merged !== theirs!.toString('utf8')) await writeFile(to, merged); continue; }
    const name = localCopyName(path, host);
    const target = join(dest, name);
    const previous = await readFile(target).catch(() => undefined);
    if (previous && previous.equals(mine)) continue;
    await copyFile(from, target);
    out.keptBoth.push({ path, local: name });
  }
  return out;
}

/** Cloud sandboxes often have no Git identity: give this repository one so commits never fail. */
async function ensureIdentity(repo: string, host: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  if ((await git(repo, ['var', 'GIT_COMMITTER_IDENT'], env)).code === 0 && (await git(repo, ['var', 'GIT_AUTHOR_IDENT'], env)).code === 0) return [];
  await git(repo, ['config', 'user.name', `Edu (${host})`], env);
  await git(repo, ['config', 'user.email', `edu@${host}.invalid`], env);
  return [`git identity for this repository: Edu (${host})`];
}
