import { randomUUID } from 'node:crypto';
import { open, readdir, readFile, unlink, rename, link } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { atomicWrite, type Brain } from '../brain/index.js';
import { digest, locked, writeOnce } from './persistence.js';

const safeId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
const QueueSchema = z.object({ runId: safeId, sessionId: safeId });
const InterventionSchema = z.object({
  type: z.literal('intervention'), by: z.literal('user'), avoidable: z.boolean(),
  harnessGap: z.enum(['context', 'tool', 'feedback', 'verify', 'recovery', 'entropy', 'model', 'unknown']), action: z.string().trim().min(1), detail: z.string().trim().min(1).optional(),
});
export interface ConsolidateOptions { maxEntries?: number; maxInterventions?: number; maxBytes?: number; since?: string; now?: Date }
export interface ConsolidateReport { lessons: string[]; acknowledged: string[]; skipped: string[]; busy: boolean }
export interface QueueEntry { name: string; raw: string; runId: string; sessionId: string }
export interface Intervention { runId: string; sessionId: string; harnessGap: string; action: string; detail: string }

export function cutoff(since: string, now: Date): string {
  const match = /^([1-9]\d*)([dhm])$/.exec(since);
  if (!match) throw new Error(`Invalid since duration '${since}'; use 7d, 12h, or 30m.`);
  return new Date(now.getTime() - Number(match[1]) * (match[2] === 'd' ? 86400000 : match[2] === 'h' ? 3600000 : 60000)).toISOString();
}
function bound(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`Limit must be an integer between 1 and ${maximum}`);
  return value;
}
export async function boundedRead(path: string, maxBytes: number): Promise<string> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > maxBytes) throw new Error('Reflection input exceeds byte limit');
    return buffer.subarray(0, offset).toString('utf8');
  } finally { await handle.close(); }
}
export async function queueSnapshot(root: string, maxEntries = 50, maxBytes = 262144): Promise<QueueEntry[]> {
  let files;
  try { files = await readdir(join(root, 'reflect-queue'), { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const entries: QueueEntry[] = [];
  const cursorPath = join(root, '.reflection-queue-cursor.json');
  let cursor = '';
  try { const value = JSON.parse(await boundedRead(cursorPath, 4096)); if (typeof value.after === 'string') cursor = value.after; } catch { /* First scan or invalid cursor starts at the beginning. */ }
  const sorted = files.filter(file => file.isFile() && file.name.endsWith('.json')).sort((a, b) => a.name.localeCompare(b.name));
  const ordered = [...sorted.filter(file => file.name.localeCompare(cursor) > 0), ...sorted.filter(file => file.name.localeCompare(cursor) <= 0)].slice(0, maxEntries);
  for (const file of ordered) {
    try {
      const raw = await boundedRead(join(root, 'reflect-queue', file.name), maxBytes);
      const value = QueueSchema.parse(JSON.parse(raw));
      entries.push({ name: file.name, raw, ...value });
    } catch { /* Malformed, oversized or concurrently removed entries remain unacknowledged. */ }
  }
  // Advance past the entire inspected window, including malformed/recoverable entries.
  // Preserve their files; the circular scan revisits them on the next pass.
  const last = ordered.at(-1);
  if (last) await atomicWrite(cursorPath, JSON.stringify({ after: last.name }));
  return entries;
}
export async function acknowledge(root: string, entry: QueueEntry): Promise<boolean> {
  const path = join(root, 'reflect-queue', entry.name);
  // Claim by rename before comparing. A producer can now replace the original path
  // without our acknowledgement ever unlinking its new entry. A crash leaves a
  // normal JSON queue entry, so subsequent runs recover it.
  const claimed = join(root, 'reflect-queue', `${randomUUID()}.pending.json`);
  try { await rename(path, claimed); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  if (await readFile(claimed, 'utf8') === entry.raw) {
    await unlink(claimed);
    return true;
  }
  try { await link(claimed, path); await unlink(claimed); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  return false;
}
export async function readInterventions(root: string, entry: QueueEntry, maxBytes = 262144, maxInterventions = 200): Promise<Intervention[] | undefined> {
  try {
    const dir = join(root, 'runs', entry.runId);
    const task = JSON.parse(await boundedRead(join(dir, 'task.json'), maxBytes));
    const outcome = JSON.parse(await boundedRead(join(dir, 'outcome.json'), maxBytes));
    if (task.runId !== entry.runId || !outcome || !['autonomous_verified_success', 'assisted_verified_success', 'unverified_success', 'failed', 'unsafe_invalid'].includes(outcome.label)) return undefined;
    const lines = (await boundedRead(join(dir, 'intervention.jsonl'), maxBytes)).split(/\r?\n/).filter(line => line.trim());
    if (lines.length > maxInterventions) return undefined;
    const result: Intervention[] = [];
    for (const line of lines) {
      const event = JSON.parse(line);
      // Approval events are human gates, not avoidable corrections.
      if (event.type === 'approval.resolve') continue;
      const parsed = InterventionSchema.safeParse(event);
      if (!parsed.success) return undefined;
      if (parsed.data.avoidable) {
        if (!parsed.data.detail) return undefined;
        result.push({ ...parsed.data, detail: parsed.data.detail, runId: entry.runId, sessionId: entry.sessionId });
      }
    }
    return result;
  } catch { return undefined; }
}
export async function writeInterventions(brain: Brain, events: Intervention[]): Promise<string[]> {
  const ids = new Set<string>();
  for (const event of events) {
    const result = await writeOnce(brain, {
      title: `Harness gap: ${event.harnessGap} — ${event.action}`,
      body: `Observed avoidable user intervention. This is candidate evidence, not a verified remedy.\n\nRun: ${event.runId}\nAction: ${event.action}\nEvidence: ${event.detail}`,
      tier: 'transitive', kind: 'lesson', band: 'inferred', tags: [`harness-gap:${event.harnessGap}`], links: [event.sessionId], source: 'edu:reflect',
    }, { intervention: digest(event) });
    if (!result.rejected) ids.add(result.id);
  }
  return [...ids];
}

/** Local, bounded, structured evidence only. Does not call an engine or award feedback. */
export async function consolidatePending(brain: Brain, brainRoot: string, options: ConsolidateOptions = {}): Promise<ConsolidateReport> {
  const maxEntries = bound(options.maxEntries, 50, 1000);
  const maxInterventions = bound(options.maxInterventions, 200, 1000);
  const maxBytes = bound(options.maxBytes, 262144, 1048576);
  const sinceAt = cutoff(options.since ?? '7d', options.now ?? new Date());
  const report: ConsolidateReport = { lessons: [], acknowledged: [], skipped: [], busy: false };
  return await locked(brainRoot, async () => {
    for (const entry of await queueSnapshot(brainRoot, maxEntries, maxBytes)) {
      const session = await brain.read(entry.sessionId);
      if (!session || session.meta.kind !== 'session' || session.meta.status !== 'closed' || (session.meta.updated ?? session.meta.created) < sinceAt) { report.skipped.push(entry.name); continue; }
      const events = await readInterventions(brainRoot, entry, maxBytes, maxInterventions);
      if (!events) { report.skipped.push(entry.name); continue; }
      report.lessons.push(...await writeInterventions(brain, events));
      if (await acknowledge(brainRoot, entry)) report.acknowledged.push(entry.name);
    }
    report.lessons = [...new Set(report.lessons)];
    return report;
  }) ?? { ...report, busy: true };
}
