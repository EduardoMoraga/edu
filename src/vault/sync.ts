/**
 * `edu sync`: one Git sync for the shared brain on every machine (laptops, desktops, cloud sandboxes).
 *
 * Contract: never force-push, never lose a change, never block future syncs.
 * - Files Edu regenerates (indexes, panels, Obsidian bases) never stop a sync: on conflict the
 *   upstream copy wins and Edu rewrites it on the next brain write.
 * - Counter-only conflicts merge the largest counters and newest dates.
 * - Other note conflicts keep upstream at the original path and publish a distinct local copy beside it.
 *   The original local commits also remain on a `sync-conflict/*` backup branch.
 * - Append-only files (`0-index/log.md`) merge as the union of both sides, in chronological order.
 * - Cloud mode keeps usage counters and Obsidian bases local and never publishes empty session notes.
 * - The local exposure ledger (`.edu-local/`) is always ignored and never published.
 */
import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { parseMarkdownLenient, serializeMarkdown } from '../brain/frontmatter.js';
import { DASHBOARD_PATHS } from '../brain/bases.js';
import { isInside } from '../brain/location.js';
import { withLogLock, withUsageLock } from '../brain/note-lock.js';
import { withHostLock } from '../platform/file-lock.js';
import { git, gitLines as lines, redact } from './git.js';
import { keepBothCopy } from './keep-both.js';
import { assertSafeTarget } from './safe-path.js';

export type SyncState = 'ok' | 'conflict' | 'offline' | 'busy' | 'error';

export interface SyncResult {
  state: SyncState;
  vault?: string;
  head?: string;
  /** Branch holding this machine's commits after a real conflict. */
  branch?: string;
  /** Generated files resolved automatically (upstream kept). */
  resolved: string[];
  /** Original paths and visible local copies created for real file conflicts. */
  conflictCopies?: { path: string; local: string }[];
  /** Append-only files resolved as the union of both sides. */
  merged?: string[];
  message: string;
  reason: string;
  at: string;
}

export interface SyncOptions {
  /** Global Edu home (~/.edu); its `brain` link locates the vault. */
  eduHome: string;
  /** Vault repository; default: the Git repository that contains `<eduHome>/brain`. */
  vault?: string;
  /** Commit label; default the short hostname (`cloud-<hostname>` in cloud mode). */
  host?: string;
  /** Keep usage counters and Obsidian bases local; publish only real edits. */
  cloud?: boolean;
  /** What triggered the sync (timer, start, stop, manual...). */
  reason?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  /** Test seams. */
  hooks?: SyncHooks;
}

export interface SyncHooks {
  /** Runs inside the brain lock, right before an append-only file's merge result is read and written. */
  beforeAppendOnlyWrite?: (path: string) => Promise<void>;
}

/** Runs a body under the locks brain writers use, so no note or log write lands while sync rewrites the working tree. */
type Critical = <T>(body: () => Promise<T>) => Promise<T>;

const COUNTER = /^(usage|uses|wins|losses|lastUsed|updated):/;

/** Dashboards Edu writes, in every language (`00-INICIO/Panel.md`, `00-START/Dashboard.md`). */
const DASHBOARDS = Object.values(DASHBOARD_PATHS);

/** Append-only files: a conflict keeps every entry from both sides. */
export function isAppendOnly(path: string): boolean {
  return /(^|\/)0-index\/log\.md$/.test(path);
}

/** Paths Edu rewrites on every brain write (indexes, catalog, dashboards, bases); their conflicts never need a person. */
export function isGenerated(path: string): boolean {
  if (isAppendOnly(path)) return false;
  return /(^|\/)0-index\//.test(path) || DASHBOARDS.some(dash => path === dash || path.endsWith(`/${dash}`)) || path.endsWith('.base');
}

const LOG_ENTRY = /^## \[(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\]/;

/**
 * Union of two versions of an append-only log: the preamble of the first, then every `## [YYYY-MM-DD HH:MM]`
 * entry (with its body lines) from both sides, exact duplicates once, in chronological order. Entries with
 * the same timestamp keep upstream's order, then the local ones.
 */
export function mergeAppendOnly(upstream: string, local: string): string {
  const parse = (text: string) => {
    const preamble: string[] = [];
    const entries: string[][] = [];
    for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
      if (LOG_ENTRY.test(line)) entries.push([line]);
      else if (entries.length) entries.at(-1)!.push(line);
      else preamble.push(line);
    }
    // Blank line between entries: the style of this file, kept in the result.
    const spaced = entries.slice(0, -1).some(entry => !entry.at(-1)!.trim());
    return { preamble: preamble.join('\n').trimEnd(), entries: entries.map(entry => entry.join('\n').trimEnd()), spaced, many: entries.length > 1 };
  };
  const a = parse(upstream);
  const b = parse(local);
  const seen = new Set<string>();
  const entries = [...a.entries, ...b.entries].filter(entry => !seen.has(entry) && Boolean(seen.add(entry)));
  const stamp = (entry: string) => { const m = LOG_ENTRY.exec(entry)!; return `${m[1]} ${m[2]}`; };
  entries.sort((x, y) => stamp(x) < stamp(y) ? -1 : stamp(x) > stamp(y) ? 1 : 0);
  const spaced = a.many ? a.spaced : b.spaced;
  const preamble = a.preamble || b.preamble;
  const body = entries.join(spaced ? '\n\n' : '\n');
  return `${preamble}${preamble && body ? '\n\n' : ''}${body}\n`;
}

/** Ignore rules every brain repository needs; added once, never duplicated. */
export const REPO_IGNORES = ['.edu-local/'];

const LOCAL_PATHSPEC = ':(glob)**/.edu-local/**';

/**
 * Makes the repository ignore (and stop tracking) the local exposure ledger. Returns what it changed.
 * Throws, writing nothing, when `.gitignore` is a symbolic link (a repository must not redirect Edu's writes).
 */
export async function ensureRepoFiles(vault: string, env?: NodeJS.ProcessEnv): Promise<string[]> {
  const changed: string[] = [];
  const file = join(vault, '.gitignore');
  await assertSafeTarget(vault, file);
  const text = await readFile(file, 'utf8').catch(() => '');
  const present = new Set(text.split(/\r?\n/).map(line => line.trim().replace(/^\//, '').replace(/\/$/, '')));
  const missing = REPO_IGNORES.filter(rule => !present.has(rule.replace(/\/$/, '')));
  if (missing.length) {
    await writeFile(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
    changed.push('.gitignore');
  }
  // Cheap check first: `git rm` takes the index lock and rewrites the index even when nothing matches.
  if ((await git(vault, ['ls-files', '--', LOCAL_PATHSPEC], env)).out.trim()) {
    const tracked = await git(vault, ['rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', LOCAL_PATHSPEC], env);
    if (tracked.code === 0) changed.push('.edu-local/ (no longer tracked)');
  }
  return changed;
}

/** `sync-conflict/*` branches known here (local or fetched from origin), without contacting the remote. */
export async function conflictBranches(vault: string, env?: NodeJS.ProcessEnv): Promise<string[]> {
  const refs = await git(vault, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/sync-conflict', 'refs/remotes/origin/sync-conflict'], env);
  return [...new Set(lines(refs.out).map(ref => ref.replace(/^origin\//, '')))].sort();
}

/** Conflict copies still tracked in the shared vault, including copies from older syncs. */
export async function trackedConflictCopies(vault: string, env?: NodeJS.ProcessEnv): Promise<{ path: string; local: string }[]> {
  const result = await git(vault, ['-c', 'core.quotepath=off', 'ls-files'], env);
  if (result.code !== 0) return [];
  return lines(result.out).flatMap(local => {
    const path = local.replace(/\.conflict-[^/]+-[0-9a-f]{7,}(?:-\d+)?(?=\.[^./]+$|$)/, '');
    return path === local ? [] : [{ path, local }];
  });
}

/** The vault's `origin` URL with any credentials redacted; undefined when there is none. */
export async function remoteUrl(vault: string, env?: NodeJS.ProcessEnv): Promise<string | undefined> {
  const url = (await git(vault, ['remote', 'get-url', 'origin'], env)).out.trim();
  return url ? redact(url, env) : undefined;
}

/** Note text with its frontmatter usage counters removed, to compare real content. */
export function withoutCounters(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '---') return lines.join('\n');
  const end = lines.indexOf('---', 1);
  if (end < 0) return lines.join('\n');
  let usage = false;
  return [...lines.slice(0, end).filter(line => {
    if (/^usage:/.test(line)) { usage = true; return false; }
    if (usage && /^\s+/.test(line)) return false;
    usage = false;
    return !COUNTER.test(line);
  }), ...lines.slice(end)].join('\n');
}

const larger = (a: unknown, b: unknown): unknown => typeof a === 'number' && typeof b === 'number' ? Math.max(a, b) : b ?? a;
const newer = (a: unknown, b: unknown): unknown => {
  const left = typeof a === 'string' ? Date.parse(a) : NaN;
  const right = typeof b === 'string' ? Date.parse(b) : NaN;
  return Number.isNaN(left) ? b ?? a : Number.isNaN(right) || left >= right ? a : b;
};

/** Both versions have the same content; combine their usage signals without reducing either side. */
export function mergeCounters(upstream: string, local: string): string {
  const up = parseMarkdownLenient(upstream);
  const mine = parseMarkdownLenient(local);
  const meta = { ...up.meta };
  for (const key of ['uses', 'wins', 'losses']) if (key in up.meta || key in mine.meta) meta[key] = larger(up.meta[key], mine.meta[key]);
  for (const key of ['lastUsed', 'updated']) if (key in up.meta || key in mine.meta) meta[key] = newer(up.meta[key], mine.meta[key]);
  const first = typeof up.meta.usage === 'object' && up.meta.usage !== null ? up.meta.usage as Record<string, unknown> : {};
  const second = typeof mine.meta.usage === 'object' && mine.meta.usage !== null ? mine.meta.usage as Record<string, unknown> : {};
  if ('usage' in up.meta || 'usage' in mine.meta) {
    const usage = { ...first, ...second };
    for (const key of ['uses', 'wins', 'losses']) if (key in first || key in second) usage[key] = larger(first[key], second[key]);
    for (const key of ['lastUsed', 'updated']) if (key in first || key in second) usage[key] = newer(first[key], second[key]);
    meta.usage = usage;
  }
  return serializeMarkdown(meta, up.body);
}

/** A new session note with nothing but the automatic end line and transcript path. */
export function isEmptySession(text: string): boolean {
  const parts = text.split(/^---$/m);
  if (parts.length < 3) return false;
  return parts.slice(2).join('---').split('\n').every(line =>
    !line.trim() || /^Transcript: /.test(line) || / session .* ended \(.*\)\.$/.test(line));
}

export async function findVault(eduHome: string, env?: NodeJS.ProcessEnv): Promise<string> {
  const brain = await realpath(join(eduHome, 'brain')).catch(() => join(eduHome, 'brain'));
  const top = await git(brain, ['rev-parse', '--show-toplevel'], env);
  if (top.code !== 0) throw new Error(`the brain (${brain}) is not inside a Git repository`);
  return top.out.trim();
}

export function statePath(eduHome: string): string {
  return join(eduHome, 'state', 'sync.json');
}

export async function readSyncState(eduHome: string): Promise<SyncResult | undefined> {
  try { return JSON.parse(await readFile(statePath(eduHome), 'utf8')) as SyncResult; } catch { return undefined; }
}

export async function syncBrain(options: SyncOptions): Promise<SyncResult> {
  const env = options.env ?? process.env;
  const at = (options.now ?? (() => new Date()))().toISOString();
  const reason = options.reason ?? 'manual';
  const base: Base = { resolved: [], merged: [], conflictCopies: [], reason, at };
  let vault: string;
  try {
    vault = options.vault ?? await findVault(options.eduHome, env);
  } catch (error) {
    return { ...base, state: 'error', message: redact((error as Error).message, env) };
  }
  const host = options.host ?? `${options.cloud ? 'cloud-' : ''}${hostname().split('.')[0]}`;
  try {
    // Lock order: this host lock first, then the brain's usage lock, then its log lock. Brain writers take the
    // usage lock and then the log lock, and never the host lock, so the order is the same everywhere.
    return await withHostLock(options.eduHome, 'sync', vault, async () =>
      run(vault, host, Boolean(options.cloud), env, base, await brainLock(options.eduHome, vault), options.hooks ?? {}), 3000);
  } catch (error) {
    const message = (error as Error).message;
    const brainBusy = /timed out waiting for the brain (usage|log) lock/.test(message);
    const busy = brainBusy || /timed out waiting/.test(message);
    return {
      ...base, vault, state: busy ? 'busy' : 'error',
      message: brainBusy ? 'the brain is being written; try again' : busy ? 'another sync is running' : redact(message, env),
    };
  }
}

/**
 * The locks brain writers hold, for the global brain that lives in this vault: the usage lock of its `.edu`
 * root (note writes) and the log lock of its folder (`0-index/log.md` appends). When the brain is not in the
 * vault (or cannot be found) there is nothing to coordinate with and the body runs as is.
 */
async function brainLock(eduHome: string, vault: string): Promise<Critical> {
  const home = await realpath(eduHome).catch(() => undefined);
  const brain = await realpath(join(eduHome, 'brain')).catch(() => undefined);
  const repo = await realpath(vault).catch(() => resolve(vault));
  if (!home || !brain || !isInside(repo, brain)) return body => body();
  return body => withUsageLock(home, () => withLogLock(brain, body));
}

type Base = Pick<SyncResult, 'resolved' | 'reason' | 'at'> & { merged: string[]; conflictCopies: { path: string; local: string }[] };

type Step = { error: string } | { ok: true };

async function run(vault: string, host: string, cloud: boolean, env: NodeJS.ProcessEnv, base: Base, critical: Critical, hooks: SyncHooks): Promise<SyncResult> {
  const g = (...args: string[]) => git(vault, args, env);
  const done = async (state: SyncState, message: string, extra: Partial<SyncResult> = {}): Promise<SyncResult> =>
    ({ ...base, vault, state, message: redact(message, env), head: (await g('rev-parse', '--short', 'HEAD')).out.trim() || undefined, ...extra });

  if (await rebasing(vault)) await g('rebase', '--abort');
  const branch = (await g('symbolic-ref', '--short', 'HEAD')).out.trim();
  if (!branch) return done('error', 'the vault is not on a branch');

  /** Commits this machine's changes; returns an error message on failure. Must run under `critical`. */
  const commitLocal = async (): Promise<string | undefined> => {
    if (cloud) {
      // Obsidian views depend on each machine's vault: never publish new ones, undo edits to tracked ones.
      const exclude = resolve(vault, (await g('rev-parse', '--git-path', 'info/exclude')).out.trim());
      const rules = await readFile(exclude, 'utf8').catch(() => '');
      if (!rules.split('\n').includes('*.base')) {
        await mkdir(resolve(exclude, '..'), { recursive: true });
        await writeFile(exclude, `${rules}${rules && !rules.endsWith('\n') ? '\n' : ''}*.base\n`);
      }
      await g('restore', '--source=HEAD', '--staged', '--worktree', '--', ':(glob)**/*.base');
      for (const file of lines((await g('-c', 'core.quotepath=off', 'diff', '--name-only', '--', '*.md')).out)) {
        const before = (await g('show', `HEAD:${file}`)).out;
        const now = await readFile(join(vault, file), 'utf8').catch(() => undefined);
        if (now !== undefined && withoutCounters(before) === withoutCounters(now)) await g('restore', '--', file);
      }
    }
    await ensureRepoFiles(vault, env);
    await g('add', '-A');
    for (const file of lines((await g('-c', 'core.quotepath=off', 'diff', '--cached', '--name-only', '--diff-filter=A')).out)) {
      if (!/(^|\/)2-episodic\/[^/]+\.md$/.test(file)) continue;
      const text = await readFile(join(vault, file), 'utf8').catch(() => '');
      if (isEmptySession(text)) await g('reset', '-q', '--', file);
    }
    if ((await g('diff', '--cached', '--quiet')).code !== 0) {
      const commit = await g('commit', '-q', '--no-verify', '-m', `chore: auto-sync from ${host} ${base.at.slice(0, 19).replace('T', ' ')}`);
      if (commit.code !== 0) return `commit failed: ${commit.err.trim()}`;
    }
    return undefined;
  };

  const failed = await critical(commitLocal);
  if (failed) return done('error', failed);

  const originalHead = (await g('rev-parse', '--short', 'HEAD')).out.trim();
  const saved = `sync-conflict/${host.replace(/[^\w.-]+/g, '-')}-${originalHead}`;
  let backedUp = false;

  for (let attempt = 1; attempt <= 3; attempt++) {
    // The network stays outside the brain lock: writers only wait for local Git work.
    const fetch = await g('fetch', '-q', 'origin', branch);
    if (fetch.code !== 0) return done('offline', `cannot reach origin: ${fetch.err.trim().split('\n').pop() ?? ''}`);
    const upstream = `origin/${branch}`;
    // One critical section from committing what was written meanwhile to the last merged file written.
    const step = await critical(async (): Promise<Step> => {
      if ((await g('status', '--porcelain')).out.trim()) {
        const again = await commitLocal();
        if (again) return { error: again };
      }
      const diverged = (await g('rev-list', '--count', `${upstream}..HEAD`)).out.trim() !== '0';
      if (diverged && !backedUp) {
        const branchResult = await g('branch', '-f', saved, 'HEAD');
        if (branchResult.code !== 0) return { error: `cannot save local commits: ${branchResult.err.trim()}` };
        backedUp = true;
      }
      if ((await g('rebase', '-q', '--autostash', upstream)).code === 0) return { ok: true };
      let outcome: Awaited<ReturnType<typeof settle>>;
      try { outcome = await settle(vault, env, host, originalHead, base, hooks); }
      catch (error) { await g('rebase', '--abort'); throw error; }
      if (outcome === 'error') { await g('rebase', '--abort'); return { error: 'rebase failed' }; }
      return { ok: true };
    });
    if ('error' in step) return done('error', step.error);
    if (base.conflictCopies.length && (await g('push', '-q', 'origin', `${saved}:refs/heads/${saved}`)).code !== 0)
      return done('error', `conflict copies are in the vault, but pushing backup ${saved} failed`, { branch: saved });
    if ((await g('rev-list', '--count', `${upstream}..HEAD`)).out.trim() === '0') {
      if (backedUp && !base.conflictCopies.length) await g('branch', '-D', saved);
      return done('ok', 'up to date');
    }
    if ((await g('push', '-q', 'origin', `HEAD:${branch}`)).code === 0) {
      if (!base.conflictCopies.length && backedUp) await g('branch', '-D', saved);
      return base.conflictCopies.length
        ? done('conflict', `pushed ${base.conflictCopies.length} visible conflict ${base.conflictCopies.length === 1 ? 'copy' : 'copies'}; backup ${saved}`, { branch: saved })
        : done('ok', 'pushed');
    }
    await new Promise(resolve => setTimeout(resolve, attempt * 500));
  }
  return done('error', 'push rejected three times');
}

async function rebasing(vault: string): Promise<boolean> {
  for (const name of ['rebase-merge', 'rebase-apply']) {
    const path = (await git(vault, ['rev-parse', '--git-path', name])).out.trim();
    if (path && await access(resolve(vault, path)).then(() => true, () => false)) return true;
  }
  return false;
}

/** Log entries (header line plus body) in `current` whose header is in neither `known` text. Conflict markers are dropped. */
function newEntries(current: string, ...known: string[]): string {
  const seen = new Set(known.flatMap(text => text.replace(/\r\n/g, '\n').split('\n').filter(line => LOG_ENTRY.test(line))));
  const out: string[] = [];
  let keep = false;
  for (const line of current.replace(/\r\n/g, '\n').split('\n')) {
    if (/^(<{7}|={7}|>{7}|\|{7})( |$)/.test(line)) { keep = false; continue; }
    if (LOG_ENTRY.test(line)) keep = !seen.has(line);
    if (keep) out.push(line);
  }
  return out.join('\n').trim();
}

/** Resolves each rebase stop while preserving both sides of real conflicts. Must run under the brain lock. */
async function settle(vault: string, env: NodeJS.ProcessEnv, host: string, sha: string, base: Base, hooks: SyncHooks): Promise<'done' | 'error'> {
  const g = (...args: string[]) => git(vault, args, env);
  for (let step = 0; step < 500 && await rebasing(vault); step++) {
    const conflicted = lines((await g('-c', 'core.quotepath=off', 'diff', '--name-only', '--diff-filter=U')).out);
    if (!conflicted.length) return 'error';
    for (const file of conflicted) {
      if (isAppendOnly(file)) {
        const target = join(vault, file);
        await hooks.beforeAppendOnlyWrite?.(file);
        await assertSafeTarget(vault, target);
        const upstream = await g('show', `:2:${file}`);
        const local = await g('show', `:3:${file}`);
        const up = upstream.code === 0 ? upstream.out : '';
        const mine = local.code === 0 ? local.out : '';
        let text = mergeAppendOnly(up, mine);
        // Belt and braces: an entry that reached the working tree some other way (in neither side) is kept too.
        const extra = newEntries(await readFile(target, 'utf8').catch(() => ''), up, mine);
        if (extra) text = mergeAppendOnly(text, extra);
        await writeFile(target, text);
        await g('add', '--', file);
        if (!base.merged.includes(file)) base.merged.push(file);
        continue;
      }
      // During a rebase stage 2 ("ours") is upstream and stage 3 is this machine's commit.
      const upstream = await g('show', `:2:${file}`);
      const local = await g('show', `:3:${file}`);
      const counterOnly = upstream.code === 0 && local.code === 0 && withoutCounters(upstream.out) === withoutCounters(local.out);
      if (!isGenerated(file) && counterOnly) {
        const target = join(vault, file);
        await assertSafeTarget(vault, target);
        await writeFile(target, mergeCounters(upstream.out, local.out));
        await g('add', '--', file);
        if (!base.merged.includes(file)) base.merged.push(file);
        continue;
      }
      if (!isGenerated(file) && local.code === 0) {
        const ext = extname(file);
        const stem = ext ? file.slice(0, -ext.length) : file;
        const parsed = file.endsWith('.md') ? parseMarkdownLenient(local.out) : undefined;
        const original = parsed ? parseMarkdownLenient(upstream.code === 0 ? upstream.out : local.out).meta.id : undefined;
        const originalId = String(original || parsed?.meta.id || stem);
        const copy = await keepBothCopy(vault, file, `${host.replace(/[^\w.-]+/g, '-')}-${sha}`,
          (path, suffix) => `${ext ? path.slice(0, -ext.length) : path}.conflict-${suffix}${ext}`,
          suffix => Buffer.from(parsed
            ? serializeMarkdown({ ...parsed.meta, id: `${originalId}-conflict-${suffix}`, conflict_of: originalId }, parsed.body)
            : local.out));
        await g('add', '--', copy);
        base.conflictCopies.push({ path: file, local: copy });
      }
      if ((await g('checkout', '--ours', '--', file)).code !== 0) await g('rm', '-q', '--', file);
      else await g('add', '--', file);
      if (isGenerated(file) && !base.resolved.includes(file)) base.resolved.push(file);
    }
    const next = await g('-c', 'core.editor=true', 'rebase', '--continue');
    if (next.code !== 0 && !await rebasing(vault)) return 'error';
    if (next.code !== 0 && /nothing to commit|no changes/i.test(next.out + next.err)) await g('rebase', '--skip');
  }
  return await rebasing(vault) ? 'error' : 'done';
}

export async function writeSyncState(eduHome: string, result: SyncResult): Promise<SyncResult | undefined> {
  const previous = await readSyncState(eduHome);
  await mkdir(join(eduHome, 'state'), { recursive: true });
  await writeFile(statePath(eduHome), `${JSON.stringify(result, null, 2)}\n`);
  return previous;
}
