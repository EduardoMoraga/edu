/**
 * Best-effort, throttled brain maintenance for session close and run end.
 * Deterministic and LLM-free: consolidate bounded structured evidence, then throttle
 * `brain.maintain()`. Outcomes are observable under `<root>/state/`.
 */
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Brain, MaintenanceReport } from './brain.js';
import { atomicWrite } from './store.js';

export const AUTO_MAINTAIN_INTERVAL_MS = 10 * 60 * 1000;

export interface MaintainState { lastRun: number; promoted: number; retired: number; overdue: number; changed: number }
export interface LocalConsolidation {
  lessons: number; acknowledged: number; skipped: number; busy: boolean; error?: string;
}
export type AutoMaintainResult = ({ ran: true; report: MaintenanceReport; state: MaintainState } | { ran: false; reason: string }) & { consolidation?: LocalConsolidation };

/** Consume only structured, queued evidence. Never invokes a model or interprets arbitrary session text. */
async function consolidate(brain: Pick<Brain, 'maintain'> & Partial<Brain>, root: string, now: Date): Promise<LocalConsolidation | undefined> {
  if (!brain.read || !brain.list || !brain.write || !brain.proposeCanonical) return undefined;
  try { await access(join(root, 'reflect-queue')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  let result: LocalConsolidation;
  try {
    const { consolidatePending } = await import('../reflect/consolidate.js');
    const report = await consolidatePending(brain as Brain, root, { now, maxEntries: 20, maxInterventions: 50 });
    result = { lessons: report.lessons.length, acknowledged: report.acknowledged.length, skipped: report.skipped.length, busy: report.busy };
  } catch (error) {
    result = { lessons: 0, acknowledged: 0, skipped: 0, busy: false, error: error instanceof Error ? error.message : String(error) };
  }
  await atomicWrite(join(root, 'state', 'consolidation.json'), `${JSON.stringify({ at: now.toISOString(), ...result }, null, 2)}\n`);
  return result;
}

/** `root` is the brain location root (the directory holding EDU.md and brain/). */
export const maintainStatePath = (root: string) => join(root, 'state', 'maintain.json');

const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

/** Reads the stamp; a missing or corrupt file is `null`. */
export async function readMaintainState(root: string): Promise<MaintainState | null> {
  try {
    const raw: unknown = JSON.parse(await readFile(maintainStatePath(root), 'utf8'));
    if (typeof raw !== 'object' || raw === null) return null;
    const value = raw as Record<string, unknown>;
    if (typeof value.lastRun !== 'number' || !Number.isFinite(value.lastRun)) return null;
    return { lastRun: value.lastRun, promoted: count(value.promoted), retired: count(value.retired), overdue: count(value.overdue), changed: count(value.changed) };
  } catch { return null; }
}

/** Runs maintenance at most once per interval per brain (`force` bypasses the throttle). Never throws. */
export async function autoMaintain(brain: Pick<Brain, 'maintain'> & Partial<Brain>, root: string, opts: { now?: Date; force?: boolean; consolidate?: boolean } = {}): Promise<AutoMaintainResult> {
  let consolidation: LocalConsolidation | undefined;
  try {
    const now = opts.now ?? new Date();
    // Runs after the episode package exists at normal run end. Keep it independent of
    // the index-maintenance throttle, so a second close does not strand new queued evidence.
    if (opts.consolidate !== false) consolidation = await consolidate(brain, root, now);
    const extra = consolidation ? { consolidation } : {};
    if (!opts.force) {
      const previous = await readMaintainState(root);
      if (previous && now.getTime() - previous.lastRun < AUTO_MAINTAIN_INTERVAL_MS && now.getTime() >= previous.lastRun) return { ran: false, reason: 'throttled', ...extra };
    }
    const report = await brain.maintain(now);
    const state: MaintainState = { lastRun: now.getTime(), promoted: report.promoted.length, retired: report.retired.length, overdue: report.overdue.length, changed: report.changed.length };
    await atomicWrite(maintainStatePath(root), `${JSON.stringify(state, null, 2)}\n`);
    return { ran: true, report, state, ...extra };
  } catch (error) {
    return { ran: false, reason: error instanceof Error ? error.message : String(error), ...(consolidation ? { consolidation } : {}) };
  }
}
