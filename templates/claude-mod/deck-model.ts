// Edu Deck. Ported from Agent Tree 0.7.5 (https://github.com/MikeGT4/agent-tree, commit 2b5ab2d).
// Copyright (c) 2026 Mike Pollow, Digitalroots. MIT License, full text in THIRD_PARTY_NOTICES.md.
// Edu changes: Copyright (c) 2026 Eduardo Moraga. MIT License.
import type {
  DeckChoices,
  DeckCorrection,
  DeckCounts,
  DeckDetail,
  DeckGroup,
  DeckLimit,
  DeckLogSource,
  DeckNode,
  DeckPhase,
  DeckReport,
  DeckState,
  DeckStatus,
  DeckTab,
} from '../types'

export const LOG_LIMIT = 150
export const LOG_EXCERPT = 60
export const DESCRIPTION_LIMIT = 80
export const LABEL_LIMIT = 40
export const ADVISOR_CALLS_KEPT = 20
export const TOOLS_KEPT = 5
export const FILES_KEPT = 50
export const CONTEXT_WARN = 70
export const CONTEXT_ALERT = 85
export const FEEDBACK_MS = 15000
export const DETAIL_LIMIT = 160

export type AdvisorUse = { id: string; startedAt: number; endedAt?: number }

export type StepInput = {
  agentId?: string
  answer?: string
  model: string
  effort?: string | number
  effortless?: boolean
  contextTokens?: number
  advisorUses?: readonly AdvisorUse[]
}

export type SpawnInput = {
  agentId: string
  parentAgentId?: string
  agentType: string
  description: string
  prompt?: string
  model?: string
  effort?: string
  background: boolean
  fork: boolean
  workflowRunId?: string
}

export type CompleteInput = {
  agentId?: string
  answer: string
  reason: string
  isAborted: boolean
  durationMs: number
}

type WorkflowGroup = Extract<DeckGroup, { kind: 'workflow' }>

const ENGINE_STATUS: Record<string, DeckStatus> = {
  completed: 'done',
  failed: 'failed',
  killed: 'stopped',
}

export const MODEL_FAMILIES = ['haiku', 'sonnet', 'opus', 'fable'] as const

export const NEW_AGENTS = 'new'

export const MAIN = 'main'

export function familyFrom(value: unknown): string | undefined {
  return typeof value === 'string' && (MODEL_FAMILIES as readonly string[]).includes(value) ? value : undefined
}

export function familyOf(model: string | undefined): string | undefined {
  return model === undefined ? undefined : MODEL_FAMILIES.find(family => model.includes(family))
}

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

export type EffortLevel = (typeof EFFORT_LEVELS)[number]

export function effortFrom(value: unknown): EffortLevel | undefined {
  return typeof value === 'string' && (EFFORT_LEVELS as readonly string[]).includes(value) ? (value as EffortLevel) : undefined
}

export function effortLabel(effort: string): string {
  return effort === 'xhigh' ? 'XHigh' : effort.charAt(0).toUpperCase() + effort.slice(1)
}

export function choicesOf(s: DeckState): DeckChoices {
  return s.choices ?? { agents: {} }
}

export function familyLabel(family: string | undefined): string {
  return family ? family.charAt(0).toUpperCase() + family.slice(1) : 'Standard'
}

export function pickerOpened(s: DeckState, target: string | undefined): DeckState {
  return {
    ...s,
    detail: target === undefined ? s.detail : undefined,
    lookOpen: target === undefined ? s.lookOpen : undefined,
    choices: { ...choicesOf(s), picker: target },
  }
}

export function lookOpened(s: DeckState): DeckState {
  return { ...s, lookOpen: true, detail: undefined, choices: { ...choicesOf(s), picker: undefined } }
}

export function closed(s: DeckState): DeckState {
  return { ...s, detail: undefined, lookOpen: undefined, choices: { ...choicesOf(s), picker: undefined } }
}

export const TABS: readonly DeckTab[] = ['tree', 'edu', 'reports', 'files', 'log', 'usage', 'help']

export function tabOf(s: DeckState): DeckTab {
  return s.tab ?? 'tree'
}

export function tabChosen(s: DeckState, tab: string, now = 0): DeckState {
  const known = TABS.find(t => t === tab)
  if (!known) return s
  const seen = known === 'reports' || tabOf(s) === 'reports' ? { reportsSeen: now } : {}
  const pin = known === 'reports' ? { reportOf: tabOf(s) === 'reports' ? reportAgent(s) : latestReportAgent(s) } : {}
  const next: DeckState = { ...closed(s), tab: known, ...seen, ...pin }
  delete next.confirming
  return next
}

/**
 * The person pressed Approve or Reject on a crew job: ask once more before running it. `requestId` pins
 * the approval gate they saw, so the verdict cannot land on a gate that opened later.
 */
export function confirmAsked(s: DeckState, jobId: string, verdict: 'approve' | 'reject', requestId?: string): DeckState {
  return { ...s, confirming: { jobId, verdict, ...(requestId ? { requestId } : {}) } }
}

/** A crew verdict the person confirmed went through: noted in the log. */
export function crewDecided(s: DeckState, jobId: string, verdict: 'approve' | 'reject', now: number): DeckState {
  return logged(s, 'session', 'crew', { id: jobId, verdict }, now)
}

export function confirmCleared(s: DeckState): DeckState {
  if (!s.confirming) return s
  const next = { ...s }
  delete next.confirming
  return next
}

export function reportPinned(s: DeckState, agentId: string, now = 0): DeckState {
  if (!s.agents.some(n => n.id === agentId)) return s
  return { ...tabChosen(s, 'reports', now), reportOf: agentId }
}

export const LOG_SOURCES: readonly DeckLogSource[] = ['session', 'main', 'agent', 'advisor']

export function logFiltered(s: DeckState, source: string): DeckState {
  if (source === 'all') return { ...s, logFilter: undefined }
  const known = LOG_SOURCES.find(x => x === source)
  return known ? { ...s, logFilter: known } : s
}

export function hasNewReport(s: DeckState): boolean {
  return tabOf(s) !== 'reports' && s.agents.some(n => n.endedAt !== undefined && n.endedAt > (s.reportsSeen ?? 0))
}

export function correctionSent(
  s: DeckState,
  input: { agentId: string; text: string; via: 'append' | 'send'; recount?: boolean },
  now: number,
): DeckState {
  const node = findAgent(s, input.agentId)
  if (!node) return s
  const count = (s.corrections?.[input.agentId]?.count ?? 0) + (input.recount === false ? 0 : 1)
  const correction: DeckCorrection = { at: now, text: excerpt(input.text), via: input.via, state: 'sent', count }
  const next = { ...s, corrections: { ...s.corrections, [input.agentId]: correction } }
  return logged(next, 'agent', 'correction', { type: node.type, text: cut(oneLine(input.text), LOG_EXCERPT) }, now)
}

export function correctionFailed(
  s: DeckState,
  input: { agentId: string; text: string; before?: DeckCorrection; count?: number },
  now: number,
): DeckState {
  const node = findAgent(s, input.agentId)
  if (!node) return s
  const kept: DeckCorrection =
    input.before?.state === 'sent'
      ? input.before
      : { at: now, text: excerpt(input.text), state: 'failed', count: input.count ?? input.before?.count ?? 0 }
  const next = { ...s, corrections: { ...s.corrections, [input.agentId]: kept } }
  return logged(next, 'agent', 'correctionFailed', { type: node.type, text: cut(oneLine(input.text), LOG_EXCERPT) }, now)
}

export function correctionCounted(s: DeckState, agentId: string): DeckState {
  const current = s.corrections?.[agentId]
  if (!current) return s
  return { ...s, corrections: { ...s.corrections, [agentId]: { ...current, count: current.count + 1 } } }
}

export function correctionResent(s: DeckState, agentId: string, now: number): DeckState {
  const node = findAgent(s, agentId)
  const current = s.corrections?.[agentId]
  if (!node || !current) return s
  const correction: DeckCorrection = { ...current, via: 'send', state: 'sent', at: now, held: undefined }
  return logged({ ...s, corrections: { ...s.corrections, [agentId]: correction } }, 'agent', 'correctionResent', { type: node.type }, now)
}

export function correctionRead(s: DeckState, agentId: string, now: number): DeckState {
  const pending = pendingCorrection(s, agentId)
  if (!pending) return s
  return { ...s, corrections: { ...s.corrections, [agentId]: { ...pending, state: 'read', readAt: now } } }
}

export function correctionHeld(s: DeckState, agentId: string): DeckState {
  const pending = pendingCorrection(s, agentId)
  if (!pending) return s
  return { ...s, corrections: { ...s.corrections, [agentId]: { ...pending, held: true } } }
}

export function pendingCorrection(s: DeckState, agentId: string | undefined): DeckCorrection | undefined {
  const correction = agentId === undefined ? undefined : s.corrections?.[agentId]
  return correction?.state === 'sent' ? correction : undefined
}

export function detailOpened(s: DeckState, agentId: string): DeckState {
  const node = findAgent(s, agentId)
  if (!node || s.detail?.agentId === agentId) return { ...s, detail: undefined }
  const detail: DeckDetail = { agentId, state: node.task ? 'ready' : 'loading' }
  return { ...s, detail, lookOpen: undefined, choices: { ...choicesOf(s), picker: undefined } }
}

export function detailLoaded(
  s: DeckState,
  agentId: string,
  found: { task?: string; answer?: string; denied?: boolean },
): DeckState {
  const next = withAgent(s, agentId, n => ({
    ...n,
    task: n.task || (found.task ? excerpt(found.task) : undefined),
    answer: n.answer || (found.answer ? excerpt(found.answer) : undefined),
  }))
  if (next.detail?.agentId !== agentId) return next
  return { ...next, detail: { agentId, state: found.denied ? 'denied' : 'ready' } }
}

export function stopRequested(s: DeckState, agentId: string, now: number): DeckState {
  const node = findAgent(s, agentId)
  if (!node || node.status !== 'running' || isStopping(s, agentId)) return s
  return logged({ ...s, stopping: [...(s.stopping ?? []), agentId] }, 'session', 'stopRequested', { type: node.type }, now)
}

export function isStopping(s: DeckState, agentId: string | undefined): boolean {
  return agentId !== undefined && (s.stopping ?? []).includes(agentId)
}

export function stopSent(s: DeckState, agentId: string): DeckState {
  if (wasStopSent(s, agentId)) return s
  return { ...s, stopSent: [...(s.stopSent ?? []), agentId] }
}

export function wasStopSent(s: DeckState, agentId: string | undefined): boolean {
  return agentId !== undefined && (s.stopSent ?? []).includes(agentId)
}

export function stopCancelled(s: DeckState, agentId: string): DeckState {
  return isStopping(s, agentId) || wasStopSent(s, agentId) ? withoutStop(s, agentId) : s
}

function withoutStop(s: DeckState, agentId: string): DeckState {
  return {
    ...s,
    stopping: (s.stopping ?? []).filter(id => id !== agentId),
    stopSent: (s.stopSent ?? []).filter(id => id !== agentId),
  }
}

export function withNewAgents(s: DeckState, family: string | undefined): DeckState {
  const current = choicesOf(s)
  return current.newAgents === family ? s : { ...s, choices: { ...current, newAgents: family } }
}

export function withNewEffort(s: DeckState, effort: string | undefined): DeckState {
  const current = choicesOf(s)
  return current.newEffort === effort ? s : { ...s, choices: { ...current, newEffort: effort } }
}

export function restoredChoices(
  s: DeckState,
  family: string | undefined,
  effort: string | undefined,
  mainEffort?: string,
): DeckState {
  return { ...s, choices: { ...choicesOf(s), newAgents: family, newEffort: effort, mainEffort, restored: true } }
}

export function carriedChoices(from: DeckState, to: DeckState): DeckState {
  const { newAgents, newEffort, mainEffort, restored } = choicesOf(from)
  return { ...to, choices: { ...choicesOf(to), newAgents, newEffort, mainEffort, restored } }
}

export function effortChosen(s: DeckState, target: string, effort: string | undefined, now: number): DeckState {
  const current = choicesOf(s)
  const efforts = { ...(current.efforts ?? {}) }
  let choices: DeckChoices
  let who = ''
  if (target === MAIN) {
    const picker = current.picker === MAIN ? undefined : current.picker
    const chosenAt = { ...(current.chosenAt ?? {}), [MAIN]: { kind: 'effort' as const, at: now } }
    return logged({ ...s, choices: { ...current, mainEffort: effort, picker, chosenAt } }, 'session', 'effort', { who, main: 1, effort: effort ?? '' }, now)
  }
  if (target === NEW_AGENTS) {
    choices = { ...current, newEffort: effort, efforts }
  } else {
    const node = findAgent(s, target)
    if (!node) return s
    if (effort === undefined) delete efforts[target]
    else efforts[target] = effort
    choices = { ...current, efforts, chosenAt: { ...(current.chosenAt ?? {}), [target]: { kind: 'effort', at: now } } }
    who = node.type
  }
  return logged({ ...s, choices }, 'session', 'effort', { who, effort: effort ?? '' }, now)
}

export function shortId(s: DeckState, agentId: string): string {
  for (let n = 8; n < agentId.length; n++) {
    const head = agentId.slice(0, n)
    if (s.agents.every(a => a.id === agentId || !a.id.startsWith(head))) return head
  }
  return agentId
}

export function agentByPrefix(s: DeckState, prefix: string): DeckNode | undefined {
  const exact = s.agents.find(a => a.id === prefix)
  if (exact) return exact
  const hits = s.agents.filter(a => a.id.startsWith(prefix))
  return hits.length === 1 ? hits[0] : undefined
}

export function mainStepEffort(s: DeckState): EffortLevel | undefined {
  return effortFrom(choicesOf(s).mainEffort)
}

export function stepEffortFor(s: DeckState, agentId: string, fallback?: string): EffortLevel | undefined {
  const current = choicesOf(s)
  if (current.efforts && agentId in current.efforts) return effortFrom(current.efforts[agentId])
  return effortFrom(fallback)
}

function pinned(s: DeckState, agentId: string, effort: string | undefined): DeckState {
  const current = choicesOf(s)
  if (!effort || (current.efforts && agentId in current.efforts)) return s
  return { ...s, choices: { ...current, efforts: { ...(current.efforts ?? {}), [agentId]: effort } } }
}

function without<T>(map: Record<string, T>, drop: (id: string) => boolean): Record<string, T> {
  return Object.fromEntries(Object.entries(map).filter(([id]) => !drop(id)))
}

export function isNewInput(door: string, message: { role?: string; name?: string }): boolean {
  return door === 'attachment' ? message.name === 'queued_command' : message.role === 'user'
}

export function runningIds(s: DeckState): Set<string> {
  return new Set(s.agents.filter(n => n.status === 'running').map(n => n.id))
}

export function chosen(s: DeckState, target: string, family: string | undefined, now: number): DeckState {
  const current = choicesOf(s)
  const picker = current.picker === target ? undefined : current.picker
  const agents = { ...current.agents }
  let choices: DeckChoices
  let who = ''
  if (target === NEW_AGENTS) {
    choices = { ...current, newAgents: family, agents, picker }
  } else {
    const node = findAgent(s, target)
    if (!node) return s
    if (family === undefined) delete agents[target]
    else agents[target] = family
    choices = { ...current, agents, picker, chosenAt: { ...(current.chosenAt ?? {}), [target]: { kind: 'model', at: now } } }
    who = node.type
  }
  return logged({ ...s, choices }, 'session', 'choice', { who, family: family ?? '' }, now)
}

export function stepModelFor(s: DeckState, family: string): string {
  const seen = [s.main.model, ...s.agents.map(n => n.model)]
  return seen.find(model => model !== undefined && new RegExp(`claude-${family}-\\d`).test(model)) ?? family
}

export function createTree(now: number): DeckState {
  return {
    startedAt: now,
    main: { active: false, turn: 0, returned: 0, returnedTokens: 0 },
    agents: [],
    advisor: { total: 0, fromMain: 0, fromAgents: 0, calls: [] },
    log: [],
  }
}

const AGENT_MESSAGE = /^\s*<(agent-message|task-notification)\b/

function logged(
  s: DeckState,
  source: DeckLogSource,
  kind: string,
  data: Record<string, string | number>,
  at: number,
): DeckState {
  const log = [...s.log]
  let place = log.length
  while (place > 0 && (log[place - 1]?.at ?? 0) > at) place -= 1
  log.splice(place, 0, { at, source, kind, data })
  return { ...s, log: log.slice(-LOG_LIMIT) }
}

function findAgent(s: DeckState, id: string | undefined): DeckNode | undefined {
  return id === undefined ? undefined : s.agents.find(n => n.id === id)
}

function withAgent(s: DeckState, id: string, change: (n: DeckNode) => DeckNode): DeckState {
  return { ...s, agents: s.agents.map(n => (n.id === id ? change(n) : n)) }
}

const ANSI = /\u001b\[[0-9;?]*[ -\/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g

const TOKEN =
  /\b(?:ghp_|gho_|ghu_|ghs_|github_pat_|sk-|xox[abprs]-|AKIA|AIza|eyJ)[A-Za-z0-9_\-.]{6,}|\bBasic\s+(?=[A-Za-z0-9+\/]*[0-9+\/=])[A-Za-z0-9+\/]{8,}={0,2}/g

const BEARER = /\bBearer\s+\S+/gi

const URL_CREDENTIALS = /:\/\/[^\s\/:@]+:[^\s\/@]+@/g

const ASSIGNMENT = /(?<![\w-])([\w-]+)(["']?\s*[=:]\s*)/g

const ASSIGNED_VALUE = /"[^"]*"|'[^']*'|["']?[^\s"',;]+/y

const SECRET_NAME = /password|passwort|passwd|token|secret|api[_-]?key|access[_-]?key/i

const ENV_ASSIGNMENT = /\b([A-Z][A-Z0-9_]*)(=)/g

const ENV_VALUE = /\S+/y

const ENV_SECRET_NAME = /PASS|PWD|KEY|CREDENTIALS?/

function secretName(name: string): boolean {
  return SECRET_NAME.test(name.slice(name.lastIndexOf('-') + 1)) || /(?:api|access)-key$/i.test(name)
}

function masked(text: string, scan: RegExp, value: RegExp, secret: (name: string) => boolean): string {
  let out = ''
  let from = 0
  scan.lastIndex = 0
  for (let found = scan.exec(text); found; found = scan.exec(text)) {
    if (!secret(found[1] ?? '')) continue
    const end = found.index + found[0].length
    value.lastIndex = end
    const tail = value.exec(text)
    if (!tail) continue
    out += `${text.slice(from, found.index)}•••`
    from = end + tail[0].length
    scan.lastIndex = from
  }
  return out + text.slice(from)
}

function maskedText(text: string): string {
  const plain = text
    .replace(ANSI, ' ')
    .replace(CONTROL, ' ')
    .replace(TOKEN, '•••')
    .replace(BEARER, '•••')
    .replace(URL_CREDENTIALS, '://•••@')
  return masked(masked(plain, ASSIGNMENT, ASSIGNED_VALUE, secretName), ENV_ASSIGNMENT, ENV_VALUE, name => ENV_SECRET_NAME.test(name))
}

function oneLine(text: string): string {
  return maskedText(text).replace(/\s+/g, ' ').trim()
}

export const REPORT_LIMIT = 20000

const MASK = '•••'

function sharedEnd(a: string, b: string): number {
  let shared = 0
  while (shared < a.length && shared < b.length && a[a.length - 1 - shared] === b[b.length - 1 - shared]) shared += 1
  return shared
}

function maskedAfter(before: string | undefined, line: string): string {
  const own = maskedText(line)
  if (before === undefined) return own
  const together = maskedText(`${before} ${line}`)
  if (together === `${maskedText(before)} ${own}`) return own
  const kept = sharedEnd(together, own)
  return kept >= own.length ? own : `${MASK}${own.slice(own.length - kept)}`
}

export function fullText(text: string | undefined, limit = REPORT_LIMIT): string {
  const raw = (text ?? '').slice(0, limit + 2000).replace(/\t/g, '    ').split(/\r?\n/)
  const lines: string[] = []
  let before: string | undefined
  for (const line of raw) {
    lines.push(maskedAfter(before, line).replace(/ +$/, ''))
    if (line.trim() !== '') before = line
  }
  const whole = lines.join('\n').trim()
  return whole.length > limit ? `${cut(whole, limit - 1)}…` : whole
}

export function reportLoaded(agentId: string, found: { task?: string; answer?: string; denied?: boolean }): DeckReport {
  if (found.denied) return { agentId, state: 'denied' }
  const task = fullText(found.task)
  const answer = fullText(found.answer)
  return { agentId, state: 'ready', ...(task ? { task } : {}), ...(answer ? { answer } : {}) }
}

function latestReportAgent(s: DeckState): string | undefined {
  if (s.selected !== undefined && s.agents.some(n => n.id === s.selected)) return s.selected
  const ended = s.agents.filter(n => n.endedAt !== undefined).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0]
  return (ended ?? s.agents.at(-1))?.id
}

export function reportAgent(s: DeckState): string | undefined {
  return s.reportOf !== undefined && s.agents.some(n => n.id === s.reportOf) ? s.reportOf : latestReportAgent(s)
}

const GRAPHEMES = 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : undefined

export function cut(text: string, limit: number): string {
  if (limit <= 0) return ''
  if (text.length <= limit) return text
  if (GRAPHEMES) {
    let end = 0
    for (const part of GRAPHEMES.segment(text.slice(0, limit + 32))) {
      const next = part.index + part.segment.length
      if (next > limit) break
      end = next
    }
    return text.slice(0, end)
  }
  return text.slice(0, /[\uD800-\uDBFF]/.test(text.charAt(limit - 1)) ? limit - 1 : limit)
}

export function excerpt(text: string | undefined, limit = DETAIL_LIMIT): string {
  return cut(oneLine(text ?? ''), limit)
}

export function counts(s: DeckState): DeckCounts {
  const tally: DeckCounts = { running: 0, done: 0, failed: 0, stopped: 0 }
  for (const n of s.agents) tally[n.status] += 1
  return tally
}

export function phaseOf(s: DeckState): DeckPhase {
  if (s.agents.some(n => n.status === 'running')) return 'delegating'
  if (!s.main.active) return 'idle'
  return s.main.returned > 0 ? 'reviewing' : 'planning'
}

export function withAdvisorModel(s: DeckState, model: string | undefined): DeckState {
  return { ...s, advisor: { ...s.advisor, model } }
}

export type MainModels = { offer: string[]; held: string | undefined }

export type ModelMenuRow = { kind?: unknown; value?: unknown; options?: readonly string[]; isLocked?: unknown }

export const MENU_DEFAULT = 'default'

export function mainModelsFrom(row: ModelMenuRow | undefined): MainModels | undefined {
  if (!row || row.isLocked === true || row.kind !== 'choice' || !row.options) return undefined
  const options = row.options
  const offer = MODEL_FAMILIES.filter(family => options.includes(family))
  if (offer.length === 0) return undefined
  const value = typeof row.value === 'string' ? row.value : ''
  const held = options.includes(value) ? offer.find(family => value === family || value === `${family}[1m]`) : MENU_DEFAULT
  return { offer, held }
}

export function withMainModels(s: DeckState, models: MainModels | undefined): DeckState {
  const main = { ...s.main }
  delete main.modelOffer
  delete main.modelHeld
  if (models) main.modelOffer = models.offer
  if (models?.held !== undefined) main.modelHeld = models.held
  return { ...s, main }
}

export function withMainModel(s: DeckState, model: string | undefined): DeckState {
  return model && model !== s.main.model ? { ...s, main: { ...s.main, model } } : s
}

export function withFast(s: DeckState, fast: boolean | undefined): DeckState {
  if (s.main.fast === fast) return s
  const main = { ...s.main }
  if (fast === undefined) delete main.fast
  else main.fast = fast
  return { ...s, main }
}

export function turnStarted(s: DeckState, input: { text: string; agentId?: string }, now: number): DeckState {
  if (input.agentId !== undefined) {
    const node = findAgent(s, input.agentId)
    if (!node || node.status === 'running') return s
    const reopened = withAgent(s, node.id, n => ({ ...n, status: 'running', endedAt: undefined, startedAt: now }))
    return logged(reopened, 'agent', 'resumed', { type: node.type, description: node.description }, now)
  }
  if (AGENT_MESSAGE.test(input.text) || input.text.trim() === '') {
    return { ...s, main: { ...s.main, active: true, resumed: true, turnStartedAt: now } }
  }
  const turn = s.main.turn + 1
  const excerpt = cut(oneLine(input.text), LOG_EXCERPT)
  const next: DeckState = {
    ...s,
    startedAt: s.startedAt || now,
    main: { ...s.main, active: true, resumed: false, turn, turnStartedAt: now, roundStartedAt: now, returned: 0, returnedTokens: 0 },
  }
  return logged(next, 'main', 'turn', { turn, excerpt }, now)
}

function advised(s: DeckState, use: AdvisorUse, agentId: string | undefined, now: number): DeckState {
  const durationMs = use.endedAt === undefined ? undefined : Math.max(0, use.endedAt - use.startedAt)
  const known = s.advisor.calls.find(c => c.id === use.id)
  if (known) {
    if (known.durationMs !== undefined || durationMs === undefined) return s
    const calls = s.advisor.calls.map(c => (c.id === use.id ? { ...c, durationMs } : c))
    return { ...s, advisor: { ...s.advisor, calls } }
  }
  const fromMain = agentId === undefined
  const advisor = {
    ...s.advisor,
    total: s.advisor.total + 1,
    fromMain: s.advisor.fromMain + (fromMain ? 1 : 0),
    fromAgents: s.advisor.fromAgents + (fromMain ? 0 : 1),
    calls: [...s.advisor.calls, { id: use.id, at: use.startedAt, durationMs, agentId }].slice(-ADVISOR_CALLS_KEPT),
  }
  const where = fromMain ? '' : findAgent(s, agentId)?.type ?? '?'
  return logged({ ...s, advisor }, 'advisor', 'advisor', { where }, Math.min(use.startedAt, now))
}

export function stepped(s: DeckState, input: StepInput, now: number): DeckState {
  const effort = input.effort === undefined ? undefined : String(input.effort)
  let next = s
  if (input.agentId === undefined) {
    next = {
      ...next,
      main: {
        ...next.main,
        model: input.model,
        effort: input.effortless ? undefined : (effort ?? next.main.effort),
        effortless: input.effortless ? true : effort !== undefined ? false : next.main.effortless,
        contextTokens: input.contextTokens ?? next.main.contextTokens,
      },
    }
  } else if (findAgent(next, input.agentId)) {
    next = withAgent(next, input.agentId, n => {
      const nextEffort = input.effortless ? undefined : (effort ?? n.effort)
      return {
        ...n,
        model: input.model,
        effort: nextEffort,
        effortless: input.effortless ? true : effort !== undefined ? false : n.effortless,
        contextTokens: input.contextTokens ?? n.contextTokens,
        answer: input.answer ? excerpt(input.answer) : n.answer,
        ...(input.model !== n.model ? { modelSince: now } : {}),
        ...(nextEffort !== n.effort ? { effortSince: now } : {}),
      }
    })
  }
  for (const use of input.advisorUses ?? []) next = advised(next, use, input.agentId, now)
  return next
}

export const ORPHANS_KEPT = 20

function returnedTo(s: DeckState, node: DeckNode, answerTokens: number): DeckState {
  if (node.parentId !== undefined) return s
  return {
    ...s,
    main: { ...s.main, returned: s.main.returned + 1, returnedTokens: s.main.returnedTokens + answerTokens },
  }
}

export function spawned(s: DeckState, input: SpawnInput, now: number): DeckState {
  const existing = findAgent(s, input.agentId)
  if (existing) {
    const resumed = withAgent(s, existing.id, n => ({
      ...n,
      parentId: input.parentAgentId ?? n.parentId,
      model: input.model ?? n.model,
      status: 'running',
      startedAt: now,
      endedAt: undefined,
    }))
    return logged(pinned(resumed, existing.id, input.effort), 'agent', 'resumed', { type: existing.type, description: existing.description }, now)
  }
  const orphan = s.orphans?.[input.agentId]
  const node: DeckNode = {
    id: input.agentId,
    parentId: input.parentAgentId,
    type: input.fork ? 'Fork' : input.agentType,
    description: cut(oneLine(input.description), DESCRIPTION_LIMIT),
    task: input.prompt ? excerpt(input.prompt) || undefined : undefined,
    model: input.model,
    background: input.background,
    fork: input.fork,
    workflowRunId: input.workflowRunId,
    status: orphan?.status ?? 'running',
    startedAt: orphan ? Math.min(now, orphan.at) : now,
    endedAt: orphan?.at,
    answerTokens: orphan?.answerTokens,
    answer: orphan?.answer,
    toolCount: 0,
  }
  const runSeen = node.workflowRunId !== undefined && s.agents.some(n => n.workflowRunId === node.workflowRunId)
  const orphans = { ...s.orphans }
  delete orphans[node.id]
  let next: DeckState = {
    ...s,
    startedAt: s.startedAt || now,
    orphans,
    agents: [...s.agents, node],
  }
  next = pinned(next, node.id, input.effort)
  if (orphan) next = returnedTo(next, node, orphan.answerTokens)
  if (runSeen) return next
  if (node.workflowRunId !== undefined) return logged(next, 'agent', 'workflowStarted', { description: node.description }, node.startedAt)
  next = logged(next, 'agent', 'agentStarted', { type: node.type, description: node.description }, node.startedAt)
  if (!orphan) return next
  const ended = { type: node.type, status: orphan.status, durationMs: orphan.durationMs ?? 0, tokens: orphan.answerTokens }
  return logged(next, 'agent', 'agentEnded', ended, orphan.at)
}

export type ToolKind = 'read' | 'change' | 'search' | 'run' | 'web' | 'agent' | 'other'

const TOOL_KINDS: Record<string, ToolKind> = {
  Read: 'read',
  Edit: 'change',
  Write: 'change',
  NotebookEdit: 'change',
  Grep: 'search',
  Glob: 'search',
  Bash: 'run',
  WebFetch: 'web',
  WebSearch: 'web',
  Agent: 'agent',
  Task: 'agent',
}

export function toolKind(tool: string): ToolKind {
  return TOOL_KINDS[tool] ?? 'other'
}

function lastSegment(path: string): string {
  return oneLine(path).split(/[\\/]/).filter(Boolean).at(-1)?.trim() ?? ''
}

export type Selection = { kind: 'agent'; node: DeckNode } | { kind: 'main' } | { kind: 'new' } | { kind: 'workflow'; runId: string }

export const WORKFLOW_PREFIX = 'wf:'

export function deselected(s: DeckState): DeckState {
  return selectedSet(closed(s), undefined)
}

export function selectionToggled(s: DeckState, target: string): DeckState {
  return s.selected === target ? deselected(s) : selectedSet(closed(s), target)
}

export function selectedSet(s: DeckState, target: string | undefined): DeckState {
  const next = { ...s }
  if (target === undefined) delete next.selected
  else next.selected = target
  return next
}

export function selectionOf(s: DeckState): Selection | undefined {
  const target = s.selected
  if (target === undefined) return undefined
  if (target === MAIN) return { kind: 'main' }
  if (target === NEW_AGENTS) return { kind: 'new' }
  if (target.startsWith(WORKFLOW_PREFIX)) {
    const runId = target.slice(WORKFLOW_PREFIX.length)
    return s.agents.some(n => n.workflowRunId === runId) ? { kind: 'workflow', runId } : undefined
  }
  const node = findAgent(s, target)
  return node ? { kind: 'agent', node } : undefined
}

export type Feedback = { kind: 'stop' | 'write' | 'model' | 'effort'; phase: 'pending' | 'done' | 'failed'; value?: string }

function recent(since: number | undefined, now: number): boolean {
  return since !== undefined && now - since < FEEDBACK_MS
}

export function feedbackFor(s: DeckState, agentId: string, now: number): Feedback | undefined {
  const node = findAgent(s, agentId)
  if (!node) return undefined
  if (node.status === 'stopped') return recent(node.endedAt, now) ? { kind: 'stop', phase: 'done' } : undefined
  if (isStopping(s, agentId)) return { kind: 'stop', phase: 'pending' }
  const correction = s.corrections?.[agentId]
  if (correction?.state === 'sent') return { kind: 'write', phase: 'pending' }
  if (correction?.state === 'read' && recent(correction.readAt, now)) return { kind: 'write', phase: 'done' }
  if (correction?.state === 'failed' && recent(correction.at, now)) return { kind: 'write', phase: 'failed' }
  const chosenAt = s.choices?.chosenAt?.[agentId]
  if (!chosenAt || node.status !== 'running') return undefined
  const fresh = recent(chosenAt.at, now)
  const family = s.choices?.agents[agentId]
  if (family !== undefined && family !== familyOf(node.model)) return { kind: 'model', phase: 'pending', value: family }
  const effort = s.choices?.efforts?.[agentId]
  if (effort !== undefined && effort !== node.effort && (!node.effortless || fresh)) return { kind: 'effort', phase: 'pending', value: effort }
  if (chosenAt.kind === 'model') {
    if (family === undefined) return fresh ? { kind: 'model', phase: 'pending', value: undefined } : undefined
    return fresh || confirmed(node.modelSince, chosenAt.at, now) ? { kind: 'model', phase: 'done', value: family } : undefined
  }
  if (effort === undefined) return fresh ? { kind: 'effort', phase: 'pending', value: undefined } : undefined
  return fresh || confirmed(node.effortSince, chosenAt.at, now) ? { kind: 'effort', phase: 'done', value: effort } : undefined
}

function confirmed(since: number | undefined, chosen: number, now: number): boolean {
  return since !== undefined && since >= chosen && recent(since, now)
}

export function mainFeedback(s: DeckState, now: number): Feedback | undefined {
  const chosenAt = s.choices?.chosenAt?.[MAIN]
  if (!chosenAt) return undefined
  const effort = s.choices?.mainEffort
  const fresh = recent(chosenAt.at, now)
  if (effort !== undefined && effort !== s.main.effort && (!s.main.effortless || fresh)) return { kind: 'effort', phase: 'pending', value: effort }
  return fresh ? { kind: 'effort', phase: 'pending', value: effort } : undefined
}

export function windowOf(s: DeckState, node: DeckNode): number | undefined {
  return node.model !== undefined && node.model === s.main.model ? s.main.window : undefined
}

export function contextPercent(tokens: number | undefined, window: number | undefined): number | undefined {
  if (tokens === undefined || !window) return undefined
  return Math.min(100, Math.max(0, Math.round((tokens / window) * 100)))
}

export function contextLevel(percent: number | undefined): 'ok' | 'warn' | 'alert' {
  if (percent === undefined || percent < CONTEXT_WARN) return 'ok'
  return percent < CONTEXT_ALERT ? 'warn' : 'alert'
}

export function pathOf(input: Record<string, unknown>): string | undefined {
  const path = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : ''
  return path || undefined
}

export function fileNameOf(input: Record<string, unknown>): string | undefined {
  return lastSegment(pathOf(input) ?? '') || undefined
}

export function resolvedPath(path: string, cwd: string): string {
  const absolute = /^(?:[\\/]|[A-Za-z]:[\\/])/.test(path)
  const whole = absolute || !cwd ? path : `${cwd}/${path}`
  const drive = /^[A-Za-z]:/.test(whole)
  const parts: string[] = []
  for (const part of whole.split(/[\\/]+/)) {
    if (part === '' || part === '.') continue
    if (part !== '..') parts.push(part)
    else if (parts.length > (drive ? 1 : 0)) parts.pop()
  }
  return drive ? parts.join('/').toLowerCase() : `/${parts.join('/')}`
}

export function pathKey(path: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < path.length; i++) {
    hash ^= path.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16)
}

export function clashed(s: DeckState, agentId: string, clash: { file: string; with: string } | undefined): DeckState {
  if (!findAgent(s, agentId)) return s
  return withAgent(s, agentId, n => {
    const next = { ...n }
    if (clash) next.clash = clash
    else delete next.clash
    return next
  })
}

export function hasClash(s: DeckState): boolean {
  return s.agents.some(n => clashShown(s, n.id) !== undefined)
}

export function clashShown(s: DeckState, agentId: string): DeckNode['clash'] {
  const node = findAgent(s, agentId)
  const clash = node?.clash
  if (!node || !clash || node.status !== 'running') return undefined
  if (clash.with === MAIN) return clash
  return s.agents.some(n => n.id === clash.with && n.status === 'running') ? clash : undefined
}

export function clashesCleared(s: DeckState, who: string): DeckState {
  return s.agents
    .filter(n => n.clash && (n.id === who || n.clash.with === who))
    .reduce((acc, n) => clashed(acc, n.id, undefined), s)
}

function remembered(list: readonly string[] | undefined, name: string): string[] {
  return [...(list ?? []).filter(n => n !== name), name].slice(-FILES_KEPT)
}

export function toolRan(s: DeckState, input: { agentId?: string; label: string; kind?: ToolKind; file?: string }, now: number): DeckState {
  if (input.agentId === undefined || !findAgent(s, input.agentId)) return s
  const counted = withAgent(s, input.agentId, n => ({
    ...n,
    toolCount: n.toolCount + 1,
    lastTool: input.label,
    tools: [...(n.tools ?? []), input.label].slice(-TOOLS_KEPT),
  }))
  return fileNoted(counted, input.agentId, input.kind, input.file)
}

export function fileNoted(s: DeckState, agentId: string, kind: ToolKind | undefined, file: string | undefined): DeckState {
  const name = file === undefined ? '' : lastSegment(file)
  if (!name || (kind !== 'read' && kind !== 'change') || !findAgent(s, agentId)) return s
  return withAgent(s, agentId, n => (kind === 'read' ? { ...n, read: remembered(n.read, name) } : { ...n, changed: remembered(n.changed, name) }))
}

function statusOf(input: CompleteInput): DeckStatus {
  if (input.isAborted || input.reason === 'aborted') return 'stopped'
  if (input.reason === 'refusal' || input.reason === 'error') return 'failed'
  return 'done'
}

export function completed(s: DeckState, input: CompleteInput, now: number): DeckState {
  const status = statusOf(input)
  if (input.agentId === undefined) {
    const next: DeckState = { ...s, main: { ...s.main, active: false } }
    if (s.main.resumed) return next
    return logged(next, 'main', 'mainDone', { status, durationMs: input.durationMs }, now)
  }
  const answerTokens = estimateTokens(input.answer)
  const node = findAgent(s, input.agentId)
  if (!node) {
    const answer = input.answer ? excerpt(input.answer) : undefined
    const kept = Object.entries({ ...s.orphans, [input.agentId]: { status, at: now, answerTokens, answer, durationMs: input.durationMs } }).slice(
      -ORPHANS_KEPT,
    )
    return { ...s, orphans: Object.fromEntries(kept) }
  }
  if (node.status !== 'running' && node.answerTokens !== undefined) return s
  const final = node.status === 'stopped' || wasStopSent(s, node.id) ? 'stopped' : status
  let next = withAgent(withoutStop(s, node.id), node.id, n => ({
    ...n,
    status: final,
    endedAt: n.status === 'running' ? now : n.endedAt ?? now,
    answerTokens,
    answer: input.answer ? excerpt(input.answer) : n.answer,
  }))
  next = returnedTo(next, node, answerTokens)
  if (node.workflowRunId !== undefined) {
    const stillRunning = next.agents.some(n => n.workflowRunId === node.workflowRunId && n.status === 'running')
    if (stillRunning) return next
    const size = next.agents.filter(n => n.workflowRunId === node.workflowRunId).length
    return logged(next, 'agent', 'workflowDone', { size }, now)
  }
  return logged(next, 'agent', 'agentEnded', { type: node.type, status: final, durationMs: input.durationMs, tokens: answerTokens }, now)
}

export function measured(
  s: DeckState,
  input: { tokens?: number; window: number; percent?: number; costUsd?: number; limits?: DeckLimit[] },
): DeckState {
  return {
    ...s,
    main: {
      ...s.main,
      contextTokens: input.tokens ?? s.main.contextTokens,
      window: input.window,
      percent: input.percent ?? s.main.percent,
      costUsd: input.costUsd ?? s.main.costUsd,
      limits: input.limits ?? s.main.limits,
    },
  }
}

export const LIMIT_ORDER = ['five_hour', 'seven_day']

export function limitsFrom(value: unknown): DeckLimit[] {
  if (!Array.isArray(value)) return []
  const rank = (kind: string) => (LIMIT_ORDER.includes(kind) ? LIMIT_ORDER.indexOf(kind) : LIMIT_ORDER.length)
  return value
    .flatMap(entry => {
      if (!entry || typeof entry !== 'object') return []
      const { kind, percentUsed, resetsAt } = entry as Record<string, unknown>
      if (typeof kind !== 'string' || typeof percentUsed !== 'number' || !Number.isFinite(percentUsed)) return []
      return [{ kind, percent: percentUsed, ...(typeof resetsAt === 'string' ? { resetsAt } : {}) }]
    })
    .sort((a, b) => rank(a.kind) - rank(b.kind))
}

export function withLimits(s: DeckState, limits: DeckLimit[]): DeckState {
  return { ...s, main: { ...s.main, limits } }
}

export function freshTree(from: DeckState, now: number): DeckState {
  const base = carriedChoices(from, withAdvisorModel(createTree(now), from.advisor.model))
  const running = from.agents.filter(n => n.status === 'running')
  const alive = runningIds(from)
  const gone = (id: string) => !alive.has(id)
  const old = choicesOf(from)
  const fresh: DeckState = {
    ...base,
    agents: running,
    choices: { ...choicesOf(base), agents: { ...old.agents }, efforts: { ...(old.efforts ?? {}) }, ...(old.chosenAt ? { chosenAt: { ...old.chosenAt } } : {}) },
    ...(from.stopping ? { stopping: from.stopping.filter(id => alive.has(id)) } : {}),
    ...(from.stopSent ? { stopSent: from.stopSent.filter(id => alive.has(id)) } : {}),
    ...(from.corrections ? { corrections: without(from.corrections, gone) } : {}),
    ...(from.selected === MAIN || from.selected === NEW_AGENTS || (from.selected !== undefined && alive.has(from.selected)) ? { selected: from.selected } : {}),
  }
  const kept = withFast(from.main.limits ? withLimits(fresh, from.main.limits) : fresh, from.main.fast)
  return from.main.modelOffer ? withMainModel(withMainModels(kept, { offer: from.main.modelOffer, held: from.main.modelHeld }), from.main.model) : kept
}

export function resetTime(kind: string, iso: string | undefined, locale: string): string | undefined {
  const at = iso === undefined ? Number.NaN : Date.parse(iso)
  if (!Number.isFinite(at)) return undefined
  try {
    const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at)
    return kind === 'five_hour' ? time : `${new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(at)} ${time}`
  } catch {
    return undefined
  }
}

export function synced(s: DeckState, list: readonly { id: string; status: string }[], now: number): DeckState {
  let next = s
  for (const entry of list) {
    const status = ENGINE_STATUS[entry.status]
    const node = findAgent(next, entry.id)
    if (!status || !node || node.status !== 'running') continue
    const final = status === 'done' && wasStopSent(next, entry.id) ? 'stopped' : status
    next = withAgent(withoutStop(next, entry.id), entry.id, n => ({ ...n, status: final, endedAt: n.endedAt ?? now }))
  }
  return next
}

export type ListedAgent = { id: string; description: string; type: string; status: string; parentId?: string }

const LISTED_STATUS: Record<string, DeckStatus> = {
  pending: 'running',
  running: 'running',
  waiting: 'running',
  idle: 'running',
  completed: 'done',
  failed: 'failed',
  killed: 'stopped',
}

export function adopted(s: DeckState, list: readonly ListedAgent[], now: number): DeckState {
  const known = new Set(s.agents.map(n => n.id))
  const fresh: DeckNode[] = []
  for (const entry of list) {
    const status = LISTED_STATUS[entry.status]
    if (status !== 'running' || known.has(entry.id)) continue
    known.add(entry.id)
    fresh.push({
      id: entry.id,
      parentId: entry.parentId,
      type: entry.type,
      description: cut(oneLine(entry.description), DESCRIPTION_LIMIT),
      background: false,
      fork: false,
      status,
      startedAt: now,
      endedAt: status === 'running' ? undefined : now,
      toolCount: 0,
    })
  }
  if (fresh.length === 0) return s
  const next: DeckState = { ...s, startedAt: s.startedAt || now, agents: [...s.agents, ...fresh] }
  return logged(next, 'agent', 'adopted', { count: fresh.length }, now)
}

export function trimmed(s: DeckState, maxAgents: number): DeckState {
  const limit = Math.max(1, Math.floor(maxAgents))
  if (s.agents.length <= limit) return s
  const finished = s.agents
    .filter(n => n.status !== 'running')
    .sort((a, b) => (a.endedAt ?? a.startedAt) - (b.endedAt ?? b.startedAt))
  const dropped = new Set(finished.slice(0, s.agents.length - limit).map(n => n.id))
  const gone = (id: string) => dropped.has(id)
  const choices = s.choices && {
    ...s.choices,
    agents: without(s.choices.agents, gone),
    ...(s.choices.efforts ? { efforts: without(s.choices.efforts, gone) } : {}),
    ...(s.choices.chosenAt ? { chosenAt: without(s.choices.chosenAt, gone) } : {}),
    picker: s.choices.picker && dropped.has(s.choices.picker) ? undefined : s.choices.picker,
  }
  const next: DeckState = {
    ...s,
    choices,
    detail: s.detail && dropped.has(s.detail.agentId) ? undefined : s.detail,
    corrections: s.corrections && without(s.corrections, gone),
    agents: s.agents.filter(n => !dropped.has(n.id)),
  }
  if (next.selected !== undefined && dropped.has(next.selected)) delete next.selected
  return next
}

export function groups(s: DeckState): DeckGroup[] {
  const all: DeckGroup[] = []
  const runs = new Map<string, WorkflowGroup>()
  for (const node of s.agents) {
    if (node.workflowRunId === undefined) {
      all.push({ kind: 'agent', node })
      continue
    }
    let run = runs.get(node.workflowRunId)
    if (!run) {
      run = {
        kind: 'workflow',
        runId: node.workflowRunId,
        size: 0,
        running: 0,
        done: 0,
        failed: 0,
        stopped: 0,
        startedAt: node.startedAt,
        lastDescription: '',
      }
      runs.set(node.workflowRunId, run)
      all.push(run)
    }
    run.size += 1
    run[node.status] += 1
    run.lastDescription = node.description
  }
  const isRunning = (g: DeckGroup) => (g.kind === 'agent' ? g.node.status === 'running' : g.running > 0)
  const recency = (g: DeckGroup) => (g.kind === 'agent' ? g.node.endedAt ?? g.node.startedAt : g.startedAt)
  return [...all.filter(isRunning), ...all.filter(g => !isRunning(g)).sort((a, b) => recency(b) - recency(a))]
}

function decimal(value: number, digits: number, separator: string): string {
  return value.toFixed(digits).replace(/\.0$/, '').replace('.', separator)
}

export function fmtTokens(n: number | undefined, separator = ','): string {
  if (n === undefined || !Number.isFinite(n)) return ''
  if (n < 1000) return String(Math.round(n))
  const thousands = n / 1000
  const thousandDigits = thousands < 100 ? 1 : 0
  if (Number(thousands.toFixed(thousandDigits)) < 1000) return `${decimal(thousands, thousandDigits, separator)}k`
  const millions = n / 1_000_000
  return `${decimal(millions, millions < 100 ? 1 : 0, separator)}M`
}

export function fmtShortDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
  return `${Math.floor(minutes / 60)} h ${minutes % 60}`
}

export function typeLabel(type: string): string {
  return type.split(':').at(-1) || type
}

export function fmtDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}:${String(seconds % 60).padStart(2, '0')} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

export function effortBar(effort: string | number | undefined): string {
  const level = (EFFORT_LEVELS as readonly string[]).indexOf(String(effort ?? '')) + 1
  if (level === 0) return ''
  return '▮'.repeat(level) + '▯'.repeat(EFFORT_LEVELS.length - level)
}

let clockFormat: Intl.DateTimeFormat | undefined

export function clockTime(ms: number): string {
  try {
    clockFormat ??= new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    return clockFormat.format(ms)
  } catch {
    return new Date(ms).toISOString().slice(11, 19)
  }
}

export function estimateTokens(text: string | undefined): number {
  return Math.ceil((text ?? '').length / 4)
}

export function modelLabel(model: string | undefined): string {
  if (!model) return ''
  const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)
  const plain = model.replace(/\[[^\]]*\]$/, '')
  const modern = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?!\d)/.exec(plain)
  if (modern) return `${capital(modern[1] ?? '')} ${modern[2]}${modern[3] ? `.${modern[3]}` : ''}`
  const legacy = /claude-(\d+)(?:-(\d+))?-([a-z]+)/.exec(plain)
  if (legacy) return `${capital(legacy[3] ?? '')} ${legacy[1]}${legacy[2] ? `.${legacy[2]}` : ''}`
  if (/^[a-z]+$/.test(plain)) return capital(plain)
  return model
}

const BARE_TOOLS = new Set(['Grep', 'Glob', 'WebSearch', 'ToolSearch', 'SubagentHandback'])

export function toolLabel(tool: string, input: Record<string, unknown>): string {
  const text = (value: unknown) => (typeof value === 'string' ? oneLine(value) : '')
  const fileName = (value: unknown) => text(value).split(/[\\/]/).filter(Boolean).at(-1) ?? ''
  const program = (value: unknown) =>
    fileName(text(typeof value === 'string' ? value.trimStart().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '') : value).split(' ')[0])
  const host = (value: unknown) => {
    try {
      return new URL(text(value)).host
    } catch {
      return ''
    }
  }
  const detail = BARE_TOOLS.has(tool)
    ? ''
    : text(input.description) ||
      fileName(input.file_path) ||
      fileName(input.notebook_path) ||
      program(input.command) ||
      text(input.skill) ||
      host(input.url)
  return cut(detail ? `${tool} ${detail}` : tool, LABEL_LIMIT)
}
