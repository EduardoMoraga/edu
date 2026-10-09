import type { Note, NoteMeta, UsageStats } from '../core/contracts.js';

export function learnedWeight(usage: UsageStats | undefined, now = new Date(), halfLifeDays = 45): number {
  const stats = usage ?? { uses: 0, wins: 0, losses: 0 };
  const laplace = (stats.wins + 1) / (stats.wins + stats.losses + 2);
  const days = stats.lastUsed ? Math.max(0, (now.getTime() - Date.parse(stats.lastUsed)) / 86_400_000) : 0;
  return Math.max(0.25, laplace * Math.pow(0.5, days / halfLifeDays));
}

export function feedbackUsage(usage: UsageStats | undefined, helpful: boolean, now = new Date()): UsageStats {
  const current = usage ?? { uses: 0, wins: 0, losses: 0 };
  return { ...current, wins: current.wins + Number(helpful), losses: current.losses + Number(!helpful), lastUsed: now.toISOString() };
}

export function recordUsage(usage: UsageStats | undefined, now = new Date()): UsageStats {
  const current = usage ?? { uses: 0, wins: 0, losses: 0 };
  return { ...current, uses: current.uses + 1, lastUsed: now.toISOString() };
}

export function lessonStatus(meta: NoteMeta, now = new Date()): NoteMeta['status'] {
  if (meta.kind !== 'lesson') return meta.status;
  if (meta.status === 'retired') return 'retired';
  const usage = meta.usage ?? { uses: 0, wins: 0, losses: 0 };
  const weight = learnedWeight(usage, now);
  const unusedDays = usage.lastUsed ? (now.getTime() - Date.parse(usage.lastUsed)) / 86_400_000 : (now.getTime() - Date.parse(meta.created)) / 86_400_000;
  if ((usage.losses >= 3 && weight < 0.35) || unusedDays >= 180) return 'retired';
  if (meta.status === 'proven') return 'proven';
  if (usage.wins >= 3 && weight >= 0.7) return 'proven';
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
