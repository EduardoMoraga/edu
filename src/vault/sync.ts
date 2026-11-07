/**
 * `edu sync`: one Git sync for the shared brain on every machine (laptops, desktops, cloud sandboxes).
 *
 * Contract: never force-push, never lose a change, never block future syncs.
 * - Files Edu regenerates (indexes, panels, Obsidian bases) never stop a sync: on conflict the
 *   upstream copy wins and Edu rewrites it on the next brain write.
 * - Conflicts where both sides differ only in usage counters take upstream too.
 * - Any other conflict pushes this machine's commits to `sync-conflict/<host>-<sha>` (also kept as a
 *   local branch), moves the vault to upstream and keeps syncing; a person or agent merges the branch.
 * - Cloud mode keeps usage counters and Obsidian bases local and never publishes empty session notes.
 */
import { execFile } from 'node:child_process';
import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { withHostLock } from '../platform/file-lock.js';

export type SyncState = 'ok' | 'conflict' | 'offline' | 'busy' | 'error';

export interface SyncResult {
  state: SyncState;
  vault?: string;
  head?: string;
  /** Branch holding this machine's commits after a real conflict. */
  branch?: string;
  /** Generated or counter-only files resolved automatically (upstream kept). */
  resolved: string[];
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
}

const COUNTER = /^\s*(usage|uses|wins|losses|lastUsed|updated):/;

/** Paths Edu rewrites on every brain write; their conflicts never need a person. */
export function isGenerated(path: string): boolean {
  return /(^|\/)0-index\//.test(path) || /(^|\/)00-INICIO\/Panel\.md$/.test(path) || path.endsWith('.base');
}

/** Note text with its frontmatter usage counters removed, to compare real content. */
export function withoutCounters(text: string): string {
  const lines = text.split('\n');
  if (lines[0] !== '---') return text;
  const end = lines.indexOf('---', 1);
  if (end < 0) return text;
  return [...lines.slice(0, end).filter(line => !COUNTER.test(line)), ...lines.slice(end)].join('\n');
}

/** A new session note with nothing but the automatic end line and transcript path. */
export function isEmptySession(text: string): boolean {
  const parts = text.split(/^---$/m);
  if (parts.length < 3) return false;
  return parts.slice(2).join('---').split('\n').every(line =>
    !line.trim() || /^Transcript: /.test(line) || / session .* ended \(.*\)\.$/.test(line));
}

interface Git { code: number; out: string; err: string }

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<Git> {
  return new Promise(resolve => {
    execFile('git', args, {
      cwd, maxBuffer: 64 * 1024 * 1024,
      env: { ...(env ?? process.env), GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_MERGE_AUTOEDIT: 'no' },
    }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
      resolve({ code, out: String(stdout), err: String(stderr) });
    });
  });
}

const lines = (text: string) => text.split('\n').map(line => line.trim()).filter(Boolean);

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
  const base = { resolved: [] as string[], reason, at };
  let vault: string;
  try {
    vault = options.vault ?? await findVault(options.eduHome, env);
  } catch (error) {
    return { ...base, state: 'error', message: (error as Error).message };
  }
  const host = options.host ?? `${options.cloud ? 'cloud-' : ''}${hostname().split('.')[0]}`;
  try {
    return await withHostLock(options.eduHome, 'sync', vault, () => run(vault, host, Boolean(options.cloud), env, base), 3000);
  } catch (error) {
    const busy = /timed out waiting/.test((error as Error).message);
    return { ...base, vault, state: busy ? 'busy' : 'error', message: busy ? 'another sync is running' : (error as Error).message };
  }
}

async function run(vault: string, host: string, cloud: boolean, env: NodeJS.ProcessEnv, base: Pick<SyncResult, 'resolved' | 'reason' | 'at'>): Promise<SyncResult> {
  const g = (...args: string[]) => git(vault, args, env);
  const done = async (state: SyncState, message: string, extra: Partial<SyncResult> = {}): Promise<SyncResult> =>
    ({ ...base, vault, state, message, head: (await g('rev-parse', '--short', 'HEAD')).out.trim() || undefined, ...extra });

  if (await rebasing(vault)) await g('rebase', '--abort');
  const branch = (await g('symbolic-ref', '--short', 'HEAD')).out.trim();
  if (!branch) return done('error', 'the vault is not on a branch');

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
  await g('add', '-A');
  for (const file of lines((await g('-c', 'core.quotepath=off', 'diff', '--cached', '--name-only', '--diff-filter=A')).out)) {
    if (!/(^|\/)2-episodic\/[^/]+\.md$/.test(file)) continue;
    const text = await readFile(join(vault, file), 'utf8').catch(() => '');
    if (isEmptySession(text)) await g('reset', '-q', '--', file);
  }
  if ((await g('diff', '--cached', '--quiet')).code !== 0) {
    const commit = await g('commit', '-q', '--no-verify', '-m', `chore: auto-sync from ${host} ${base.at.slice(0, 19).replace('T', ' ')}`);
    if (commit.code !== 0) return done('error', `commit failed: ${commit.err.trim()}`);
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    const fetch = await g('fetch', '-q', 'origin', branch);
    if (fetch.code !== 0) return done('offline', `cannot reach origin: ${fetch.err.trim().split('\n').pop() ?? ''}`);
    const upstream = `origin/${branch}`;
    if ((await g('rebase', '-q', '--autostash', upstream)).code !== 0) {
      const outcome = await settle(vault, env, base.resolved);
      if (outcome === 'conflict') return conflict(vault, host, branch, upstream, env, done);
      if (outcome === 'error') { await g('rebase', '--abort'); return done('error', 'rebase failed'); }
    }
    if ((await g('rev-list', '--count', `${upstream}..HEAD`)).out.trim() === '0') return done('ok', 'up to date');
    if ((await g('push', '-q', 'origin', `HEAD:${branch}`)).code === 0) return done('ok', 'pushed');
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

/** Resolves rebase stops that never need a person; 'conflict' means a real one is left. */
async function settle(vault: string, env: NodeJS.ProcessEnv, resolved: string[]): Promise<'done' | 'conflict' | 'error'> {
  const g = (...args: string[]) => git(vault, args, env);
  for (let step = 0; step < 500 && await rebasing(vault); step++) {
    const conflicted = lines((await g('-c', 'core.quotepath=off', 'diff', '--name-only', '--diff-filter=U')).out);
    if (!conflicted.length) return 'error';
    for (const file of conflicted) {
      // During a rebase stage 2 ("ours") is upstream and stage 3 is this machine's commit.
      const upstream = await g('show', `:2:${file}`);
      const local = await g('show', `:3:${file}`);
      const counterOnly = upstream.code === 0 && local.code === 0 && withoutCounters(upstream.out) === withoutCounters(local.out);
      if (!isGenerated(file) && !counterOnly) return 'conflict';
    }
    for (const file of conflicted) {
      if ((await g('checkout', '--ours', '--', file)).code !== 0) await g('rm', '-q', '--', file);
      else await g('add', '--', file);
      if (!resolved.includes(file)) resolved.push(file);
    }
    const next = await g('-c', 'core.editor=true', 'rebase', '--continue');
    if (next.code !== 0 && !await rebasing(vault)) return 'error';
    if (next.code !== 0 && /nothing to commit|no changes/i.test(next.out + next.err)) await g('rebase', '--skip');
  }
  return await rebasing(vault) ? 'error' : 'done';
}

async function conflict(vault: string, host: string, branch: string, upstream: string, env: NodeJS.ProcessEnv,
  done: (state: SyncState, message: string, extra?: Partial<SyncResult>) => Promise<SyncResult>): Promise<SyncResult> {
  const g = (...args: string[]) => git(vault, args, env);
  await g('rebase', '--abort');
  const head = (await g('rev-parse', '--short', 'HEAD')).out.trim();
  const saved = `sync-conflict/${host}-${head}`;
  await g('branch', '-f', saved, 'HEAD');
  if ((await g('push', '-q', 'origin', `HEAD:refs/heads/${saved}`)).code !== 0) {
    return done('error', `conflict with ${upstream}; the changes are kept on the local branch ${saved} (push failed)`, { branch: saved });
  }
  // Every change is committed on the saved branch (local and remote): following upstream loses nothing.
  if ((await g('-c', 'core.quotepath=off', 'status', '--porcelain', '--untracked-files=no')).out.trim()) {
    return done('conflict', `conflict with ${upstream}; changes saved on ${saved}; the vault has uncommitted edits and stays where it is`, { branch: saved });
  }
  await g('reset', '-q', '--keep', upstream);
  return done('conflict', `conflict with ${upstream}; this machine's changes are on the branch ${saved}; the vault now follows upstream and keeps syncing`, { branch: saved });
}

export async function writeSyncState(eduHome: string, result: SyncResult): Promise<SyncResult | undefined> {
  const previous = await readSyncState(eduHome);
  await mkdir(join(eduHome, 'state'), { recursive: true });
  await writeFile(statePath(eduHome), `${JSON.stringify(result, null, 2)}\n`);
  return previous;
}
