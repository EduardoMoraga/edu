/**
 * Exposure ledger: how often and how recently each note was recalled or injected into context.
 *
 * Exposure is high-frequency, machine-local signal. Writing it into note frontmatter rewrote every recalled
 * note (git churn, cross-machine sync conflicts), so it lives in `<root>/.edu-local/usage.json`, which is
 * never synced. Feedback (wins, losses, verified events) is rare and meaningful and stays in the note.
 *
 * Migration: exposure counters already present in frontmatter (`usage.uses`, `usage.lastUsed`) stay
 * readable and act as the initial ledger value. Notes are never rewritten just to move them.
 */
import { appendFile, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { UsageStats } from '../core/contracts.js';
import { assertInsideBrain, isUnsafeBrainPath } from './safe-path.js';
import { atomicWrite } from './store.js';

/** Machine-local folder inside a brain root; git-ignored through `<root>/.gitignore`. */
export const LOCAL_DIR = '.edu-local';
const LEDGER_FILE = 'usage.json';

export interface Exposure {
  /** Times the note was recalled or injected into context. */
  uses: number;
  /** ISO timestamp of the last exposure. */
  lastUsed?: string;
}

export interface UsageLedger {
  version: 1;
  /** Exposure by note id. */
  notes: Record<string, Exposure>;
}

export function ledgerPath(root: string): string {
  return join(root, LOCAL_DIR, LEDGER_FILE);
}

const empty = (): UsageLedger => ({ version: 1, notes: {} });

interface CachedLedger { mtimeMs: number; size: number; ino: number; ledger: UsageLedger }
const cache = new Map<string, CachedLedger>();

/** Test hook. */
export function resetLedgerCache(): void { cache.clear(); }

function sanitize(raw: unknown): UsageLedger {
  const notes = (raw && typeof raw === 'object' ? (raw as { notes?: unknown }).notes : undefined);
  const out = empty();
  if (!notes || typeof notes !== 'object') return out;
  for (const [id, value] of Object.entries(notes as Record<string, unknown>)) {
    const entry = value as Partial<Exposure> | null;
    if (!entry || typeof entry !== 'object') continue;
    const uses = typeof entry.uses === 'number' && Number.isFinite(entry.uses) && entry.uses >= 0 ? entry.uses : 0;
    out.notes[id] = { uses, ...(typeof entry.lastUsed === 'string' && Number.isFinite(Date.parse(entry.lastUsed)) ? { lastUsed: entry.lastUsed } : {}) };
  }
  return out;
}

/**
 * Reads the ledger of a brain root (cached per process, validated by stat). A missing ledger is empty.
 * A corrupt ledger reads as empty; the next write moves it aside instead of silently discarding it.
 */
export async function readLedger(root: string): Promise<UsageLedger> {
  const path = resolve(ledgerPath(root));
  let info;
  try { info = await stat(path); } catch { cache.delete(path); return empty(); }
  const cached = cache.get(path);
  if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size && cached.ino === info.ino) return structuredClone(cached.ledger);
  let ledger: UsageLedger;
  try { ledger = sanitize(JSON.parse(await readFile(path, 'utf8'))); }
  catch { return empty(); }
  cache.set(path, { mtimeMs: info.mtimeMs, size: info.size, ino: info.ino, ledger });
  return structuredClone(ledger);
}

/**
 * Read-modify-write of a root's ledger. The caller MUST hold that root's usage lock (`withUsageLock`):
 * the ledger has no lock of its own so it composes with the note writes done in the same critical section.
 * `mutate` returns false when nothing changed (no write). A ledger that is (or sits under) a symbolic link is
 * never read, moved or written: the update is skipped with a warning (exposure is an aid, not the source of truth).
 */
export async function updateLedger(root: string, mutate: (ledger: UsageLedger) => boolean): Promise<void> {
  const path = ledgerPath(root);
  if (!await safeTarget(root, path)) return;
  const raw = await readFile(path, 'utf8').catch(() => undefined);
  let ledger = empty();
  if (raw !== undefined) {
    try { ledger = sanitize(JSON.parse(raw)); }
    catch { await rename(path, `${path}.corrupt-${Date.now()}`).catch(() => { /* best effort: keep going with an empty ledger */ }); }
  }
  if (!mutate(ledger)) return;
  await ensureLocalIgnored(root);
  cache.delete(resolve(path));
  try { await atomicWrite(path, `${JSON.stringify(ledger)}\n`, { root }); }
  catch (error) { if (!isUnsafeBrainPath(error)) throw error; process.emitWarning(`${error.message}; skipped`, 'EduWarning'); }
}

async function safeTarget(root: string, path: string): Promise<boolean> {
  try { await assertInsideBrain(root, path); return true; }
  catch (error) {
    if (!isUnsafeBrainPath(error)) throw error;
    process.emitWarning(`${error.message}; skipped`, 'EduWarning');
    return false;
  }
}

const ignored = new Set<string>();
/**
 * Makes sure `<root>/.gitignore` ignores the machine-local folder, so a brain root inside a git repository
 * (a project `.edu`, or a synced `~/.edu`) never commits it. Appends to an existing file; never rewrites it.
 */
export async function ensureLocalIgnored(root: string): Promise<void> {
  const key = resolve(root);
  if (ignored.has(key)) return;
  const path = join(root, '.gitignore');
  if (!await safeTarget(root, path)) return;
  const current = await readFile(path, 'utf8').catch(() => undefined);
  const rules = (current ?? '').split(/\r?\n/).map(line => line.trim());
  if (!rules.some(rule => [LOCAL_DIR, `${LOCAL_DIR}/`, `/${LOCAL_DIR}`, `/${LOCAL_DIR}/`].includes(rule))) {
    if (current === undefined) await writeFile(path, `${LOCAL_DIR}/\n`, { flag: 'wx' }).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return appendFile(path, `${LOCAL_DIR}/\n`);
      throw error;
    });
    else await appendFile(path, `${current && !current.endsWith('\n') ? '\n' : ''}${LOCAL_DIR}/\n`);
  }
  ignored.add(key);
}

const later = (a?: string, b?: string) => !a ? b : !b ? a : Date.parse(b) > Date.parse(a) ? b : a;
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

/**
 * Merged usage the ranking and lifecycle read: frontmatter feedback plus the larger of the legacy frontmatter
 * exposure and the ledger's (max, so an older Edu still bumping frontmatter on another machine is not lost).
 */
export function mergeExposure(usage: UsageStats | undefined, exposure: Exposure | undefined): UsageStats | undefined {
  if (!exposure) return usage;
  const base: UsageStats = usage && typeof usage === 'object' ? { ...usage } : { uses: 0, wins: 0, losses: 0 };
  base.uses = Math.max(count(base.uses), exposure.uses);
  const lastUsed = later(typeof base.lastUsed === 'string' ? base.lastUsed : undefined, exposure.lastUsed);
  if (lastUsed) base.lastUsed = lastUsed; else delete base.lastUsed;
  return base;
}

/** The ledger entry after one more exposure at `now`, seeded from the merged (legacy + ledger) value. */
export function nextExposure(merged: UsageStats | undefined, now: Date): Exposure {
  return { uses: count(merged?.uses) + 1, lastUsed: now.toISOString() };
}

const hasFeedback = (usage: UsageStats) => count(usage.wins) > 0 || count(usage.losses) > 0 || count(usage.verifiedWins) > 0
  || count(usage.verifiedLosses) > 0 || Boolean(usage.lastVerified) || Boolean(usage.events?.length);

/**
 * The usage block a note write puts in frontmatter. Feedback fields come from `next`; exposure fields are
 * frozen at what the file already holds (legacy value, never advanced), so exposure never causes a rewrite.
 * A brand-new file (e.g. a project shadow of a global lesson) carries the merged value once.
 */
export function frontmatterUsage(next: UsageStats | undefined, disk: UsageStats | undefined, isNewFile: boolean): UsageStats | undefined {
  if (isNewFile || !next) return next ?? (isNewFile ? undefined : disk);
  const out: UsageStats = { ...next, uses: disk?.uses ?? 0 };
  if (disk?.lastUsed) out.lastUsed = disk.lastUsed; else delete out.lastUsed;
  if (!disk && !hasFeedback(out)) return undefined;
  return out;
}
