import type { FeedbackContext, Note, NoteMeta, UsageStats } from '../core/contracts.js';

export function learnedWeight(usage: UsageStats | undefined, now = new Date(), halfLifeDays = 45): number {
  const stats = usage ?? { uses: 0, wins: 0, losses: 0 };
  const laplace = (stats.wins + 1) / (stats.wins + stats.losses + 2);
  const days = stats.lastUsed ? Math.max(0, (now.getTime() - Date.parse(stats.lastUsed)) / 86_400_000) : 0;
  return Math.max(0.25, laplace * Math.pow(0.5, days / halfLifeDays));
}

export const MAX_EVENT_ID_LENGTH = 200;
const PROMOTION_VERIFIED_WINS = 3;
const INACTIVITY_DAYS = 180;

/** Runtime check for callers that bypass the types (JSON, MCP, scripts): `verified` must be the boolean `true`/`false`, never a truthy string. */
export function assertFeedbackContext(context: FeedbackContext): void {
  const value = context as unknown as Record<string, unknown> | null;
  if (!value || typeof value !== 'object') throw new Error('Feedback context must be an object');
  if (typeof value.eventId !== 'string' || !value.eventId.trim() || value.eventId.length > MAX_EVENT_ID_LENGTH) throw new Error(`Feedback context eventId must be a non-empty string of at most ${MAX_EVENT_ID_LENGTH} characters`);
  if (typeof value.verified !== 'boolean') throw new Error('Feedback context verified must be a boolean');
  if (value.evidence !== undefined && !(Array.isArray(value.evidence) && value.evidence.every(item => typeof item === 'string'))) throw new Error('Feedback context evidence must be an array of strings');
}

/** Tolerates hand-edited or older frontmatter: wrong-typed counters and event lists are treated as absent, never as proof. */
function sanitizeUsage(usage: UsageStats | undefined): UsageStats {
  const raw = (usage && typeof usage === 'object' ? usage : {}) as unknown as Record<string, unknown>;
  const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
  const out: UsageStats = { ...(raw as unknown as UsageStats), uses: count(raw.uses), wins: count(raw.wins), losses: count(raw.losses) };
  if ('verifiedWins' in raw) out.verifiedWins = count(raw.verifiedWins);
  if ('verifiedLosses' in raw) out.verifiedLosses = count(raw.verifiedLosses);
  if ('events' in raw) out.events = Array.isArray(raw.events) ? raw.events.filter((key): key is string => typeof key === 'string') : [];
  return out;
}

/**
 * Feedback never renews `lastUsed` (exposure recency). Without a context it is advisory and counts as before.
 * With a context it counts once per `eventId`; only `verified` feedback feeds the verified counters that can
 * promote. A verified report for an event first seen as advisory upgrades it without double counting.
 * Event keys are kept in full: truncating them would let an old event be replayed and counted again.
 */
export function feedbackUsage(usage: UsageStats | undefined, helpful: boolean, now = new Date(), context?: FeedbackContext): UsageStats {
  if (context !== undefined) assertFeedbackContext(context);
  const current = sanitizeUsage(usage);
  if (context === undefined) return { ...current, wins: current.wins + Number(helpful), losses: current.losses + Number(!helpful) };
  const events = current.events ?? [];
  const advisory = `a:${context.eventId}`, verified = `v:${context.eventId}`;
  if (events.includes(verified) || (!context.verified && events.includes(advisory))) return usage as UsageStats;
  const counted = events.includes(advisory);
  const next: UsageStats = { ...current };
  if (!counted) { next.wins += Number(helpful); next.losses += Number(!helpful); }
  if (context.verified) {
    if (helpful) { next.verifiedWins = (current.verifiedWins ?? 0) + 1; next.lastVerified = now.toISOString(); }
    else next.verifiedLosses = (current.verifiedLosses ?? 0) + 1;
  }
  next.events = [...events.filter(key => key !== advisory || !context.verified), context.verified ? verified : advisory];
  return next;
}

export function recordUsage(usage: UsageStats | undefined, now = new Date()): UsageStats {
  const current = usage ?? { uses: 0, wins: 0, losses: 0 };
  return { ...current, uses: current.uses + 1, lastUsed: now.toISOString() };
}

/** Promotion needs distinct externally verified successes; advisory or legacy wins/losses never promote. */
export function isVerifiedLesson(usage: UsageStats | undefined): boolean {
  const wins = usage?.verifiedWins ?? 0, losses = usage?.verifiedLosses ?? 0;
  return wins >= PROMOTION_VERIFIED_WINS && (wins + 1) / (wins + losses + 2) >= 0.7;
}

export function lessonStatus(meta: NoteMeta, now = new Date()): NoteMeta['status'] {
  if (meta.kind !== 'lesson') return meta.status;
  if (meta.status === 'retired') return 'retired';
  const usage = sanitizeUsage(meta.usage);
  const weight = learnedWeight(usage, now);
  if (usage.losses >= 3 && weight < 0.35) return 'retired';
  // Confirmed lessons (historical proven or with verified wins) do not expire from inactivity alone. Unconfirmed
  // ones age from the last confirmation or their creation: being exposed again does not renew them.
  const confirmed = meta.status === 'proven' || (usage.verifiedWins ?? 0) > 0;
  const since = Date.parse(usage.lastVerified ?? meta.created);
  if (!confirmed && Number.isFinite(since) && (now.getTime() - since) / 86_400_000 >= INACTIVITY_DAYS) return 'retired';
  if (meta.status === 'proven') return 'proven';
  if (isVerifiedLesson(usage)) return 'proven';
  return meta.status ?? 'candidate';
}

export function overdueStatus(meta: NoteMeta, now = new Date()): NoteMeta['status'] {
  if (meta.kind === 'commitment' && meta.status === 'pending' && meta.due && Date.parse(`${meta.due.slice(0, 10)}T23:59:59.999Z`) < now.getTime()) return 'overdue';
  return meta.status;
}

export function explainWeight(usage: UsageStats | undefined, now = new Date()): string {
  const w = learnedWeight(usage, now);
  return `Learned weight ${w.toFixed(2)} combines Laplace feedback and a 45-day recency half-life.`;
}

export function applyLearning(note: Note, now = new Date()): Note {
  let status = lessonStatus(note.meta, now);
  status = overdueStatus({ ...note.meta, status }, now);
  return { ...note, meta: { ...note.meta, status, updated: now.toISOString() } };
}
