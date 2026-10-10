/**
 * Best-effort, throttled brain maintenance for session close and run end.
 * Deterministic and LLM-free: it delegates to `brain.maintain()` and stamps `<root>/state/maintain.json`.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Brain, MaintenanceReport } from './brain.js';
import { atomicWrite } from './store.js';

export const AUTO_MAINTAIN_INTERVAL_MS = 10 * 60 * 1000;

export interface MaintainState { lastRun: number; promoted: number; retired: number; overdue: number; changed: number }
export type AutoMaintainResult = { ran: true; report: MaintenanceReport; state: MaintainState } | { ran: false; reason: string };

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
export async function autoMaintain(brain: Pick<Brain, 'maintain'>, root: string, opts: { now?: Date; force?: boolean } = {}): Promise<AutoMaintainResult> {
  try {
    const now = opts.now ?? new Date();
    if (!opts.force) {
      const previous = await readMaintainState(root);
      if (previous && now.getTime() - previous.lastRun < AUTO_MAINTAIN_INTERVAL_MS && now.getTime() >= previous.lastRun) return { ran: false, reason: 'throttled' };
    }
    const report = await brain.maintain(now);
    const state: MaintainState = { lastRun: now.getTime(), promoted: report.promoted.length, retired: report.retired.length, overdue: report.overdue.length, changed: report.changed.length };
    await atomicWrite(maintainStatePath(root), `${JSON.stringify(state, null, 2)}\n`);
    return { ran: true, report, state };
  } catch (error) {
    return { ran: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
