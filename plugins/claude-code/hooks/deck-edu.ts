// Edu Deck: Edu's own side of the pane (brain, crew, session), read from `edu deck --json`.
// Copyright (c) 2026 Eduardo Moraga. MIT License.
//
// Pure functions only: no `claude-code` value imports, so vitest runs them as they ship.
import type { DeckEdu, DeckEduBrain, DeckEduJob, DeckEduSession } from '../types'

/** Refresh period while a crew job runs, queues or waits for approval, or the Edu tab is open. */
export const EDU_ACTIVE_MS = 10_000
/** Refresh period otherwise; events (a finished turn, an Edu tool call) refresh sooner. */
export const EDU_IDLE_MS = 60_000
/** How often the timer asks whether a refresh is due. */
export const EDU_TICK_MS = 5_000
/** `edu deck --json` takes about 0.2 s; anything near this is a hung CLI. */
export const EDU_TIMEOUT_MS = 15_000
export const RECENT_KEPT = 5
export const JOBS_KEPT = 8
export const TASK_LIMIT = 160

const ACTIVE = new Set(['running', 'queued', 'awaiting-approval'])

export function eduLoading(): DeckEdu {
  return { state: 'loading', jobs: [], approvals: 0, recent: [] }
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0)
const time = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined)
const oneLine = (value: string): string => value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim()

function brainFrom(value: unknown): DeckEduBrain | undefined {
  if (!object(value) || value.present !== true) return undefined
  return {
    canonical: count(value.canonical),
    proposed: count(value.proposed),
    toApprove: count(value.toApprove ?? value.proposed),
    episodic: count(value.episodic),
    transitive: count(value.transitive),
    lessons: count(value.lessons),
  }
}

function jobFrom(value: unknown): DeckEduJob | undefined {
  if (!object(value)) return undefined
  const id = text(value.id)
  if (!id) return undefined
  const startedAt = time(value.startedAt) ?? 0
  const endedAt = time(value.endedAt)
  return {
    id,
    cli: text(value.cli, '?') || '?',
    task: oneLine(text(value.task)).slice(0, TASK_LIMIT),
    status: text(value.status, 'queued') || 'queued',
    mode: text(value.mode, 'headless') || 'headless',
    startedAt,
    ...(endedAt !== undefined ? { endedAt } : {}),
    tokens: count(value.tokens),
    tokensKnown: value.tokensKnown === true,
  }
}

function sessionFrom(value: unknown): DeckEduSession | undefined {
  if (!object(value)) return undefined
  const id = text(value.id)
  if (!id) return undefined
  const title = text(value.title)
  return { id, status: text(value.status), ...(title ? { title } : {}) }
}

/**
 * Reads `edu deck --json` (snapshot version 1). Unknown fields are ignored and missing ones read as empty,
 * so an older or newer CLI degrades instead of blanking the pane. Anything that is not a version 1
 * snapshot is a failure with the reason.
 */
export function eduFrom(stdout: string, now: number): DeckEdu {
  let raw: unknown
  try {
    raw = JSON.parse(stdout)
  } catch {
    return eduFailed(eduLoading(), 'the output is not JSON', now)
  }
  if (!object(raw) || raw.version !== 1) return eduFailed(eduLoading(), 'unknown snapshot version', now)
  const project = object(raw.project) ? { name: text(raw.project.name), root: text(raw.project.root) } : undefined
  const brain = brainFrom(raw.brain)
  const maintenance = object(raw.maintenance)
    ? {
        ...(time(raw.maintenance.lastRun) !== undefined ? { lastRun: time(raw.maintenance.lastRun) } : {}),
        promoted: count(raw.maintenance.promoted),
        retired: count(raw.maintenance.retired),
        overdue: count(raw.maintenance.overdue),
      }
    : undefined
  const spec = object(raw.spec) && text(raw.spec.name)
    ? { name: text(raw.spec.name), requirements: count(raw.spec.requirements), checks: count(raw.spec.checks) }
    : undefined
  const jobs = (Array.isArray(raw.jobs) ? raw.jobs : []).map(jobFrom).filter((job): job is DeckEduJob => job !== undefined).slice(0, JOBS_KEPT)
  const recent = (Array.isArray(raw.recent) ? raw.recent : [])
    .filter(object)
    .map(note => ({ title: oneLine(text(note.title)), tier: text(note.tier), at: time(note.at) ?? 0 }))
    .filter(note => note.title)
    .slice(0, RECENT_KEPT)
  const sessionKnown = 'session' in raw
  const session = sessionKnown ? sessionFrom(raw.session) : undefined
  return {
    state: 'ready',
    checkedAt: now,
    ...(project ? { project } : {}),
    identity: text(raw.identity, 'Edu') || 'Edu',
    ...(brain ? { brain } : {}),
    ...(maintenance ? { maintenance } : {}),
    ...(spec ? { spec } : {}),
    jobs,
    approvals: count(raw.approvals),
    recent,
    ...(session ? { session } : {}),
    sessionKnown,
  }
}

/** A failed read keeps the last good figures on screen and says why. */
export function eduFailed(previous: DeckEdu, reason: string, now: number): DeckEdu {
  return { ...previous, state: 'failed', error: oneLine(reason).slice(0, 200) || 'unknown error', checkedAt: now }
}

/** The `edu` command could not start: not installed, not on PATH. `reason` is what the engine said. */
export function eduMissing(previous: DeckEdu, now: number, reason?: string): DeckEdu {
  const error = reason ? oneLine(reason).slice(0, 200) : ''
  const next: DeckEdu = { ...previous, state: 'missing', checkedAt: now }
  if (error) next.error = error
  else delete next.error
  return next
}

export function activeJobs(edu: DeckEdu | undefined): number {
  return edu ? edu.jobs.filter(job => ACTIVE.has(job.status)).length : 0
}

export function isActiveJob(job: DeckEduJob): boolean {
  return ACTIVE.has(job.status)
}

/** Whether the timer should read Edu again now. */
export function eduDue(edu: DeckEdu | undefined, now: number, lastRunAt: number | undefined, watching: boolean): boolean {
  if (lastRunAt === undefined) return true
  const period = watching || activeJobs(edu) > 0 ? EDU_ACTIVE_MS : EDU_IDLE_MS
  return now - lastRunAt >= period
}

/** argv after `edu`: the snapshot, plus this session's Edu note when the CLI knows `--session`. */
export function eduArgs(sessionId: string | undefined, withSession: boolean): string[] {
  return ['deck', '--json', ...(withSession && sessionId ? ['--session', sessionId] : [])]
}

/** Edu 5.0 does not know `--session`: commander answers "unknown option". */
export function unknownOption(stderr: string): boolean {
  return /unknown option/i.test(stderr)
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * A run that started and then outlived its timeout. Every other rejection of `$.process.run` means the
 * command could not start (the engine's wording for a missing binary is not part of its contract).
 */
export function timedOut(error: unknown): boolean {
  return /timed? ?out|timeout|still running/i.test(errorText(error))
}

/** The first meaningful line a failed run wrote, for the pane. */
export function failureReason(result: { exitCode: number; stderr: string; stdout: string }): string {
  const line = `${result.stderr}\n${result.stdout}`
    .split(/\r?\n/)
    .map(oneLine)
    .find(Boolean)
  return line ? line.slice(0, 160) : `exit code ${result.exitCode}`
}

/** A crew job id or unique prefix as `edu crew approve` takes it; anything else never reaches argv. */
export function isJobRef(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{3,63}$/.test(id)
}

export function verdictArgs(jobId: string, verdict: 'approve' | 'reject'): string[] {
  return ['crew', verdict, jobId]
}

export function totalNotes(brain: DeckEduBrain | undefined): number {
  return brain ? brain.canonical + brain.proposed + brain.episodic + brain.transitive : 0
}

/** Parts of the one-line Edu strip on the tree tab; empty while nothing is known. */
export function stripParts(
  edu: DeckEdu | undefined,
  w: { stripNotes: (n: number) => string; stripCrew: (n: number) => string; stripApprovals: (n: number) => string; toApprove: (n: number) => string; overdue: (n: number) => string; sessionOpen: string; sessionClosed: string; session: string; missing: string; loading: string; stripFailed: string },
): string[] {
  if (!edu) return []
  if (edu.state === 'missing') return [w.missing]
  if (edu.state === 'failed' && !edu.brain) return [w.stripFailed]
  if (edu.state === 'loading' && edu.checkedAt === undefined) return [w.loading]
  const parts: string[] = []
  if (edu.brain) parts.push(w.stripNotes(totalNotes(edu.brain)))
  if (edu.brain?.toApprove) parts.push(w.toApprove(edu.brain.toApprove))
  if (edu.maintenance?.overdue) parts.push(w.overdue(edu.maintenance.overdue))
  const active = activeJobs(edu)
  if (active) parts.push(w.stripCrew(active))
  if (edu.approvals) parts.push(w.stripApprovals(edu.approvals))
  if (edu.session) parts.push(`${w.session.toLowerCase()} ${edu.session.status === 'open-session' ? w.sessionOpen : w.sessionClosed}`)
  return parts
}

/** Coarse age: just now · 5m ago · 3h ago · 2d ago. */
export function ago(from: number, to: number): string {
  const m = Math.max(0, Math.floor((to - from) / 60000))
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`
}

/** Job runtime: 42s · 3m05s · 2h10m. */
export function elapsed(from: number, to: number): string {
  const s = Math.max(0, Math.round((to - from) / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`
}

export const JOB_GLYPHS: Record<string, string> = {
  running: '●',
  queued: '○',
  'awaiting-approval': '⏸',
  done: '✓',
  failed: '✗',
  cancelled: '⊘',
}
