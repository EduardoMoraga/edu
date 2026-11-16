// Edu Deck. Ported from Agent Tree 0.7.5 (https://github.com/MikeGT4/agent-tree, commit 2b5ab2d).
// Copyright (c) 2026 Mike Pollow, Digitalroots. MIT License, full text in THIRD_PARTY_NOTICES.md.
// Edu changes: Copyright (c) 2026 Eduardo Moraga. MIT License.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, ProcessRunResult, Register, Timer } from 'claude-code'

import type { DeckEdu, DeckLook, DeckReport, DeckState } from '../types'
import { DEFAULT_LOOK, LOOK_OPTIONS, lookFrom } from './deck-looks.ts'
import type { LookRow } from './deck-looks.ts'
import {
  EDU_TICK_MS,
  EDU_TIMEOUT_MS,
  errorText,
  eduArgs,
  eduDue,
  eduFailed,
  eduFrom,
  eduLoading,
  eduMissing,
  failureReason,
  isJobRef,
  timedOut,
  unknownOption,
  verdictArgs,
} from './deck-edu.ts'
import {
  NEW_AGENTS,
  adopted,
  agentByPrefix,
  choicesOf,
  chosen,
  clashed,
  fileNoted,
  closed,
  completed,
  confirmAsked,
  confirmCleared,
  crewDecided,
  correctionFailed,
  correctionHeld,
  correctionRead,
  correctionCounted,
  correctionResent,
  correctionSent,
  counts,
  createTree,
  detailLoaded,
  detailOpened,
  effortChosen,
  effortFrom,
  effortLabel,
  freshTree,
  familyFrom,
  fileNameOf,
  isStopping,
  lookOpened,
  logFiltered,
  limitsFrom,
  MAIN,
  MENU_DEFAULT,
  mainModelsFrom,
  mainStepEffort,
  measured,
  pathKey,
  pathOf,
  pendingCorrection,
  phaseOf,
  pickerOpened,
  reportAgent,
  reportLoaded,
  reportPinned,
  resolvedPath,
  runningIds,
  isNewInput,
  restoredChoices,
  selectionToggled,
  deselected,
  shortId,
  spawned,
  stepEffortFor,
  stepModelFor,
  stepped,
  stopCancelled,
  stopRequested,
  stopSent,
  synced,
  tabChosen,
  tabOf,
  toolKind,
  toolLabel,
  toolRan,
  trimmed,
  turnStarted,
  typeLabel,
  wasStopSent,
  withAdvisorModel,
  withFast,
  withMainModel,
  withMainModels,
  withLimits,
} from './deck-model.ts'
import type { MainModels } from './deck-model.ts'
import { drawTree, pressKey, statusText } from './deck-view.tsx'
import type { TreeActions } from './deck-view.tsx'
import { familyOr, lookChoice, lookOptionLabel, resolveLang, wordsFor } from './deck-words.ts'
import type { Lang } from './deck-words.ts'

const PANE = 'edu-deck'
const COMMAND = 'edu-deck'
const TITLE = 'Edu Deck'
const SHAPE = 'edu-deck-1'
const LOOK_SHAPE = 'edu-deck-look-1'
const EDU_SHAPE = 'edu-deck-edu-1'
const LOOK_KEY = 'look'
const MODEL_KEY = 'model'
const EFFORT_KEY = 'effort'
const MAIN_EFFORT_KEY = 'mainEffort'
const INLINE_ROWS = 40
const FRAME_MS = 250
const HANDBACK = 'SubagentHandback'

const tree = atom({ plugin: 'edu', key: 'tree' } as const, createTree(0), { shape: SHAPE })
const frame = atom({ plugin: 'edu', key: 'frame' } as const, 0)
const appearance = atom({ plugin: 'edu', key: 'look' } as const, DEFAULT_LOOK, { shape: LOOK_SHAPE })
const unreadTexts = atom({ plugin: 'edu', key: 'unread' } as const, {} as Record<string, string[]>)
const reportTexts = atom({ plugin: 'edu', key: 'reports' } as const, {} as Record<string, DeckReport>)
const eduData = atom({ plugin: 'edu', key: 'edu' } as const, eduLoading(), { shape: EDU_SHAPE })

let ticker: Timer | undefined
const changers: Map<string, { file: string; ids: Set<string> }> = new Map()
let animate = true
let lang: Lang = 'en'
let stoppingIds = new Set<string>()
let stopSentIds = new Set<string>()
let lastAdvisor = 'opus'
let advisorCommand = true
type Carried = { tree: DeckState; look: DeckLook; unread: Record<string, string[]>; sessionId?: string }
type Pin = string | undefined
type Level = string | number
const delivered = new Set<string>()
const seen = new Set<string>()
const starting: Map<string, Pin> = new Map()
const standing: Map<string, Level> = new Map()
let spawning = 0
let generation = 0
let handing: Promise<void> | undefined
let carried: Carried | undefined
let reportRequest = 0

async function takeOver($: EngineInterface): Promise<void> {
  if (handing) return handing
  const from = carried
  if (!from) return
  let finish: () => void = () => undefined
  const run = new Promise<void>(resolve => {
    finish = resolve
  })
  handing = run
  try {
    await handOver($, from)
  } finally {
    finish()
    if (handing === run) handing = undefined
  }
}

async function handOver($: EngineInterface, from: Carried): Promise<void> {
  const round = generation
  const id = await $.session.id().catch(() => undefined)
  if (from.sessionId !== undefined && id === from.sessionId) return
  await update($, appearance, () => from.look).catch(() => undefined)
  const alive = runningIds(from.tree)
  await update($, unreadTexts, () => withoutTexts(from.unread, id => !alive.has(id))).catch(() => undefined)
  const now = await clock($)
  if (round !== generation) return
  try {
    await commitTree($, () => freshTree(from.tree, now))
  } catch {
    return
  }
  if (carried === from) carried = undefined
}

async function noteChange($: EngineInterface, who: string, path: string) {
  const cwd = await $.session.cwd().catch(() => '')
  const key = pathKey(resolvedPath(path, cwd))
  const entry: { file: string; ids: Set<string> } = changers.get(key) ?? { file: fileNameOf({ file_path: path }) ?? '', ids: new Set() }
  entry.ids.add(who)
  changers.set(key, entry)
  if (entry.ids.size > 1) await settleClashes($)
}

async function dropChanger($: EngineInterface, who: string) {
  let touched = false
  for (const [key, entry] of changers) {
    touched = entry.ids.delete(who) || touched
    if (!entry.ids.size) changers.delete(key)
  }
  if (touched) await settleClashes($)
}

async function settleClashes($: EngineInterface) {
  await change($, s => {
    const active = (id: string) => id === MAIN || s.agents.some(n => n.id === id && n.status === 'running')
    const wanted: Map<string, { file: string; with: string }> = new Map()
    for (const entry of changers.values()) {
      const ids = [...entry.ids].filter(active)
      if (ids.length < 2) continue
      for (const id of ids) {
        const other = ids.find(o => o !== id)
        if (id !== MAIN && other && !wanted.has(id)) wanted.set(id, { file: entry.file, with: other })
      }
    }
    return s.agents.reduce((next, n) => {
      const clash = wanted.get(n.id)
      if (!clash) return n.clash ? clashed(next, n.id, undefined) : next
      return n.clash?.file === clash.file && n.clash.with === clash.with ? next : clashed(next, n.id, clash)
    }, s)
  })
}

function succeeded(result: unknown): boolean {
  const answer = result as { deny?: string; isError?: boolean } | undefined
  return answer !== undefined && answer.deny === undefined && answer.isError !== true
}

async function latest($: EngineInterface): Promise<DeckState> {
  await takeOver($)
  return read($, tree)
}

async function snapshot($: EngineInterface): Promise<Carried | undefined> {
  const ending = await read($, tree).catch(() => undefined)
  if (!ending) return undefined
  return {
    tree: ending,
    look: await read($, appearance).catch(() => DEFAULT_LOOK),
    unread: await read($, unreadTexts).catch(() => ({})),
  }
}

function busy(s: DeckState): boolean {
  return counts(s).running > 0 || phaseOf(s) === 'reviewing'
}

function keepTicking($: EngineInterface, s: DeckState): void {
  if (animate && busy(s)) {
    if (ticker) return
    try {
      ticker = $.clock.every(FRAME_MS, () => {
        void update($, frame, n => (n + 1) % 1_000_000).catch(() => undefined)
      })
    } catch {
      ticker = undefined
    }
    return
  }
  ticker?.cancel()
  ticker = undefined
}







function paneColumns(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 90
  return Math.min(140, Math.max(40, n))
}

function agentLimit(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 30
  return Math.min(200, Math.max(5, n))
}

function handbackId(): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let id = 'toolu_01'
  for (let i = 0; i < 22; i++) id += letters[Math.floor(Math.random() * letters.length)]
  return id
}

async function clock($: EngineInterface): Promise<number> {
  return $.clock.now().catch(() => Date.now())
}

async function change($: EngineInterface, apply: (s: DeckState) => DeckState): Promise<DeckState> {
  await takeOver($)
  return commitTree($, apply)
}

async function commitTree($: EngineInterface, apply: (s: DeckState) => DeckState): Promise<DeckState> {
  const next = await update($, tree, apply)
  const ending = carried?.sessionId
  if (ending !== undefined && (await $.session.id().catch(() => undefined)) === ending) {
    if (carried && carried.sessionId === ending) carried = { ...carried, tree: apply(carried.tree) }
    return next
  }
  stoppingIds = new Set(next.stopping ?? [])
  stopSentIds = new Set(next.stopSent ?? [])
  $.ui.status(statusText(next, lang, lastEdu))
  keepTicking($, next)
  return next
}

function withoutTexts(texts: Record<string, string[]>, drop: (agentId: string) => boolean): Record<string, string[]> {
  return Object.fromEntries(Object.entries(texts).filter(([id]) => !drop(id)))
}

async function remember($: EngineInterface, agentId: string, text: string): Promise<void> {
  await update($, unreadTexts, texts => ({ ...texts, [agentId]: [...(texts[agentId] ?? []), text] }))
}

async function forget($: EngineInterface, agentId: string): Promise<void> {
  await update($, unreadTexts, texts => withoutTexts(texts, id => id === agentId))
}

async function applyLook($: EngineInterface, row: LookRow, id: string): Promise<void> {
  const saved = await $.store.get(LOOK_KEY).then(
    value => ({ value }),
    () => undefined,
  )
  const stored = lookFrom(saved ? saved.value : await read($, appearance))
  await $.store.set(LOOK_KEY, lookFrom({ ...stored, [row]: id })).catch(() => undefined)
  await update($, appearance, look => lookFrom({ ...lookFrom(look), [row]: id }))
}

async function resetLook($: EngineInterface): Promise<void> {
  await $.store.set(LOOK_KEY, DEFAULT_LOOK).catch(() => undefined)
  await update($, appearance, () => DEFAULT_LOOK)
}

async function restoreLook($: EngineInterface): Promise<void> {
  const look = await $.store.get(LOOK_KEY).then(
    value => ({ value }),
    () => undefined,
  )
  if (look) await update($, appearance, () => lookFrom(look.value))
}

async function restoreChoices($: EngineInterface, interactive: boolean): Promise<boolean> {
  await restoreLook($)
  if (!interactive || choicesOf(await latest($)).restored) return false
  const model = await $.store.get(MODEL_KEY).catch(() => undefined)
  const effort = await $.store.get(EFFORT_KEY).catch(() => undefined)
  const mainEffort = await $.store.get(MAIN_EFFORT_KEY).catch(() => undefined)
  await change($, s => restoredChoices(s, familyFrom(model), effortFrom(effort), effortFrom(mainEffort)))
  return true
}

async function chooseModel($: EngineInterface, target: string, family: string | undefined): Promise<void> {
  const now = await clock($)
  await change($, t => chosen(t, target, family, now))
  if (target === NEW_AGENTS) await $.store.set(MODEL_KEY, family ?? null).catch(() => undefined)
}

async function chooseEffort($: EngineInterface, target: string, effort: string | undefined): Promise<void> {
  const now = await clock($)
  await change($, t => effortChosen(t, target, effort, now))
  if (target === NEW_AGENTS) await $.store.set(EFFORT_KEY, effort ?? null).catch(() => undefined)
  if (target === MAIN) await $.store.set(MAIN_EFFORT_KEY, effort ?? null).catch(() => undefined)
}

async function catchUp($: EngineInterface, now: number, keep: number): Promise<void> {
  const list = await $.agent.list().catch(() => [])
  for (const entry of list) seen.add(entry.id)
  await change($, s => trimmed(synced(adopted(s, list, now), list, now), keep))
}

type Found = { task?: string; answer?: string; denied?: boolean }

function handedBack(uses: unknown): string | undefined {
  if (!Array.isArray(uses)) return undefined
  for (const use of [...uses].reverse()) {
    const { tool, input } = use as { tool?: unknown; input?: { message?: unknown } }
    if (tool === HANDBACK && typeof input?.message === 'string' && input.message.trim() !== '') return input.message
  }
  return undefined
}

function summarize(rows: unknown): Found {
  if (!Array.isArray(rows)) return { denied: true }
  const messages = rows.filter(
    (m): m is { role: string; text: string } => typeof m === 'object' && m !== null && typeof m.text === 'string',
  )
  const task = messages.find(m => m.role === 'user' && m.text.trim() !== '')?.text
  let answer: string | undefined
  for (const m of [...messages].reverse()) {
    const handed = handedBack((m as { toolUses?: unknown }).toolUses)
    if (handed !== undefined) {
      answer = handed
      break
    }
    if (m.role === 'assistant' && m.text.trim() !== '') {
      answer = m.text
      break
    }
  }
  return { task, answer }
}

async function openDetail($: EngineInterface, agentId: string): Promise<void> {
  const s = await change($, t => detailOpened(t, agentId))
  if (s.detail?.agentId !== agentId || s.detail.state !== 'loading') return
  const rows = await $.session.messages({ agentId }).catch(() => undefined)
  await change($, t => detailLoaded(t, agentId, summarize(rows)))
}

async function loadReport($: EngineInterface, agentId: string | undefined): Promise<void> {
  if (!agentId) return
  reportRequest += 1
  const request = reportRequest
  await update($, reportTexts, shown => ({ [agentId]: shown[agentId] ?? { agentId, state: 'loading' as const } }))
  const rows = await $.session.messages({ agentId }).catch(() => undefined)
  if (request !== reportRequest) return
  await update($, reportTexts, shown => (shown[agentId] ? { [agentId]: reportLoaded(agentId, summarize(rows)) } : shown))
}

async function ensureReport($: EngineInterface, s: DeckState): Promise<void> {
  if (tabOf(s) !== 'reports') return
  const agentId = reportAgent(s)
  if (!agentId) return
  const shown = await read($, reportTexts)
  if (!shown[agentId]) await loadReport($, agentId)
}

async function appendRow($: EngineInterface, text: string, agentId?: string): Promise<boolean> {
  const row = { message: { type: 'user' as const, content: [{ type: 'text' as const, text }] }, ...(agentId ? { agentId } : {}) }
  const kept = await $.session.append(row).then(
    result => (result as { deny?: string }).deny === undefined,
    () => false,
  )
  if (kept) delivered.add(agentId ?? MAIN)
  return kept
}

async function sayTo($: EngineInterface, agentId: string, text: string): Promise<boolean> {
  if (!text.trim()) return false
  const w = wordsFor(lang)
  const current = await latest($)
  const node = current.agents.find(n => n.id === agentId)
  if (!node) {
    $.ui.status(w.correctionFailedStatus)
    return false
  }
  const before = current.corrections?.[agentId]
  const now = await clock($)
  const framed = w.correctionFrame(text, HANDBACK)
  if (node.status === 'running' && (await appendRow($, framed, agentId))) {
    await remember($, agentId, framed)
    await change($, t => correctionSent(t, { agentId, text, via: 'append' }, now))
  } else {
    await forget($, agentId)
    await change($, t => correctionSent(t, { agentId, text, via: 'send', recount: false }, now))
    const sent = await $.session.send({ to: { agentId }, text: framed }).catch(() => undefined)
    if (!sent?.isDelivered) {
      await change($, t => correctionFailed(t, { agentId, text, before }, now))
      $.ui.status(w.correctionFailedStatus)
      return false
    }
    await change($, t => correctionCounted(t, agentId))
  }
  const note = w.mainNote(`${typeLabel(node.type)} · ${node.description}`, text)
  await appendRow($, note)
  const parent = node.parentId ? current.agents.find(n => n.id === node.parentId) : undefined
  if (parent?.status === 'running') await appendRow($, note, parent.id)
  return true
}

const WRITE_PREFIX = /^\/edu-deck\s+(?:to|say)\s+\S+\s?/i

async function startWrite($: EngineInterface, agentId: string): Promise<void> {
  const s = await latest($)
  const node = s.agents.find(n => n.id === agentId)
  if (!node) return
  const w = wordsFor(lang)
  const box = await $.prompt.read().catch(() => ({ text: '', cursor: 0 }))
  const text = `/${COMMAND} ${w.writeWord} ${shortId(s, agentId)} ${box.text.replace(WRITE_PREFIX, '')}`
  const filled = await $.prompt.fill({ text }).catch(() => undefined)
  $.ui.toast(filled?.isFilled ? w.writeHint(`${typeLabel(node.type)} · ${node.description}`) : w.writeNoPrompt)
}

async function readAdvisor($: EngineInterface): Promise<void> {
  const model = await $.settings.read({ key: 'advisorModel' }).catch(() => undefined)
  const name = typeof model === 'string' && model ? model : undefined
  if (name) lastAdvisor = name
  await change($, s => withAdvisorModel(s, name))
}

async function advisorSettled($: EngineInterface, wanted: boolean): Promise<boolean> {
  for (let i = 0; i < 8; i++) {
    const model = await $.settings.read({ key: 'advisorModel' }).catch(() => undefined)
    if ((typeof model === 'string' && model !== '') === wanted) return true
    await $.clock.sleep(250).catch(() => undefined)
  }
  return false
}

async function toggleAdvisor($: EngineInterface): Promise<void> {
  const args = (await latest($)).advisor.model ? 'off' : lastAdvisor
  const ran = await $.command.run({ command: 'advisor', args }).then(
    () => true,
    () => false,
  )
  if (!ran) {
    $.ui.toast(wordsFor(lang).advisorUnavailable)
    return
  }
  if (!(await advisorSettled($, args !== 'off'))) $.ui.toast(wordsFor(lang).advisorUnchanged)
  await readAdvisor($)
}

async function fastHeld($: EngineInterface): Promise<boolean | undefined> {
  const rows = await $.config.list()
  const value = rows.find(row => row.key === 'fast')?.value
  return typeof value === 'boolean' ? value : undefined
}

async function readFast($: EngineInterface): Promise<void> {
  const held = await fastHeld($)
  await change($, s => withFast(s, held))
}

async function fastSettled($: EngineInterface, wanted: boolean): Promise<boolean> {
  for (let i = 0; i < 8; i++) {
    const held = await fastHeld($).catch(() => undefined)
    if (held === wanted) return true
    await $.clock.sleep(250).catch(() => undefined)
  }
  return false
}

async function toggleFast($: EngineInterface): Promise<void> {
  const wanted = (await latest($)).main.fast !== true
  const ran = await $.command.run({ command: 'fast', args: wanted ? 'on' : 'off' }).then(
    () => true,
    () => false,
  )
  if (!ran) {
    $.ui.toast(wordsFor(lang).fastUnavailable)
    return
  }
  if (!(await fastSettled($, wanted))) $.ui.toast(wordsFor(lang).fastUnchanged)
  await readFast($)
}

async function mainModelsHeld($: EngineInterface): Promise<MainModels | undefined> {
  const rows = await $.config.list()
  return mainModelsFrom(rows.find(row => row.key === 'model'))
}

async function readMainModels($: EngineInterface): Promise<void> {
  const held = await mainModelsHeld($)
  await change($, s => withMainModels(s, held))
  if (!held || (await latest($)).main.model !== undefined) return
  const model = await $.session.model().catch(() => undefined)
  await change($, s => (s.main.model === undefined ? withMainModel(s, typeof model === 'string' ? model : undefined) : s))
}

async function mainModelSettled($: EngineInterface, wanted: string): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const held = await mainModelsHeld($).catch(() => undefined)
    if (held?.held === wanted) return
    await $.clock.sleep(250).catch(() => undefined)
  }
}

async function chooseMainModel($: EngineInterface, family: string | undefined): Promise<void> {
  await change($, t => closed(t))
  const wanted = family ?? MENU_DEFAULT
  const ran = await $.command.run({ command: 'model', args: wanted }).then(
    () => true,
    () => false,
  )
  if (!ran) {
    $.ui.toast(wordsFor(lang).mainModelUnavailable)
    return
  }
  await mainModelSettled($, wanted)
  await readMainModels($)
  const model = await $.session.model().catch(() => undefined)
  await change($, s => withMainModel(s, typeof model === 'string' ? model : undefined))
}

async function settleUnread($: EngineInterface, s: DeckState, agentId: string, now: number): Promise<void> {
  const texts = (await read($, unreadTexts))[agentId] ?? []
  await forget($, agentId)
  const waiting = pendingCorrection(s, agentId)
  const node = s.agents.find(n => n.id === agentId)
  if (!waiting || !node) return
  const w = wordsFor(lang)
  if (node.status === 'done' && waiting.via === 'append' && texts.length) {
    await change($, t => correctionResent(t, agentId, now))
    const sent = await $.session.send({ to: { agentId }, text: w.resendFrame(texts.join('\n\n')) }).catch(() => undefined)
    if (sent?.isDelivered) return
  }
  await change($, t => correctionFailed(t, { agentId, text: waiting.text, count: waiting.count }, now))
  $.ui.status(w.correctionFailedStatus)
  await appendRow($, w.mainNoteLost(`${typeLabel(node.type)} · ${node.description}`))
}

function actionsFor($: EngineInterface): TreeActions {
  const ignore = () => undefined
  return {
    select: target => void change($, t => selectionToggled(t, target)).catch(ignore),
    pick: target => void change($, t => pickerOpened(t, target)).catch(ignore),
    choose: (target, family) => void (target === MAIN ? chooseMainModel($, family) : chooseModel($, target, family)).catch(ignore),
    effort: (target, effort) => void chooseEffort($, target, effort).catch(ignore),
    close: () => void change($, t => closed(t)).catch(ignore),
    detail: agentId => void openDetail($, agentId).catch(ignore),
    stop: agentId => {
      void forget($, agentId)
        .then(() => clock($))
        .then(now => change($, t => stopRequested(t, agentId, now)))
        .catch(ignore)
    },
    write: agentId => void startWrite($, agentId).catch(ignore),
    advisor: () => void toggleAdvisor($).catch(ignore),
    fast: () => void toggleFast($).catch(ignore),
    deselect: () => void change($, t => deselected(t)).catch(ignore),
    look: () => void change($, t => (t.lookOpen ? closed(t) : lookOpened(t))).catch(ignore),
    restyle: (row, id) => void applyLook($, row, id).catch(ignore),
    restyleDefault: () => void resetLook($).catch(ignore),
    logFilter: source => void change($, t => logFiltered(t, source)).catch(ignore),
    tab: id => {
      void clock($)
        .then(now => change($, t => tabChosen(t, id, now)))
        .then(t => (id === 'reports' ? loadReport($, reportAgent(t)) : id === 'edu' ? eduTick($) : undefined))
        .catch(ignore)
    },
    report: agentId => {
      void clock($)
        .then(now => change($, t => reportPinned(t, agentId, now)))
        .then(t => (tabOf(t) === 'reports' && reportAgent(t) === agentId ? loadReport($, agentId) : undefined))
        .catch(ignore)
    },
    eduRefresh: () => void refreshEdu($).catch(ignore),
    eduAsk: (jobId, verdict) => void change($, t => (isJobRef(jobId) ? confirmAsked(t, jobId, verdict) : t)).catch(ignore),
    eduConfirm: () => void decideCrew($).catch(ignore),
    eduCancel: () => void change($, t => confirmCleared(t)).catch(ignore),
  }
}

// Edu's own data: one `edu deck --json` run at a time, on events and on a slow timer, never per frame.
let eduTimer: Timer | undefined
let eduRunning: Promise<void> | undefined
let eduAgain = false
let eduRanAt: number | undefined
let eduSessionFlag = true
let eduHead: readonly string[] | undefined
let lastEdu: DeckEdu | undefined

const EDU_HEADS: readonly (readonly string[])[] = [['edu'], ['cmd', '/c', 'edu']]
const EDU_TOOL = /(?:^|__)edu_/

type EduMissing = { missing: string }

/**
 * Runs the edu CLI by argv (no shell); on Windows its npm shim needs `cmd /c`. `{ missing }` when neither
 * starts, with what the engine said; a run that times out rejects.
 */
async function runEdu($: EngineInterface, args: readonly string[], timeoutMs = EDU_TIMEOUT_MS): Promise<ProcessRunResult | EduMissing> {
  const reasons: string[] = []
  for (const head of eduHead ? [eduHead] : EDU_HEADS) {
    try {
      const result = await $.process.run([...head, ...args], { timeoutMs })
      if (head[0] === 'cmd' && result.exitCode !== 0 && /not recognized/i.test(result.stderr)) {
        reasons.push(result.stderr)
        continue
      }
      eduHead = head
      return result
    } catch (error) {
      if (timedOut(error)) throw error
      reasons.push(errorText(error))
    }
  }
  return { missing: reasons[0] ?? '' }
}

const isMissing = (value: unknown): value is EduMissing => typeof value === 'object' && value !== null && 'missing' in value

async function readEdu($: EngineInterface): Promise<void> {
  const sessionId = await $.session.id().catch(() => undefined)
  const attempt = () => runEdu($, eduArgs(sessionId, eduSessionFlag)).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))))
  let result = await attempt()
  if (!isMissing(result) && !(result instanceof Error) && result.exitCode !== 0 && eduSessionFlag && unknownOption(result.stderr)) {
    eduSessionFlag = false
    result = await attempt()
  }
  const now = await clock($)
  eduRanAt = now
  const next = await update($, eduData, previous => {
    if (isMissing(result)) return eduMissing(previous, now, result.missing)
    if (result instanceof Error) return eduFailed(previous, result.message, now)
    if (result.exitCode !== 0) return eduFailed(previous, failureReason(result), now)
    const parsed = eduFrom(result.stdout, now)
    return parsed.state === 'ready' ? parsed : eduFailed(previous, parsed.error ?? '', now)
  })
  lastEdu = next
  const s = await read($, tree).catch(() => undefined)
  if (s) $.ui.status(statusText(s, lang, next))
}

async function refreshEdu($: EngineInterface): Promise<void> {
  if (eduRunning) {
    eduAgain = true
    return eduRunning
  }
  const run = (async () => {
    do {
      eduAgain = false
      await readEdu($).catch(() => undefined)
    } while (eduAgain)
  })()
  eduRunning = run.finally(() => {
    eduRunning = undefined
  })
  return eduRunning
}

async function eduTick($: EngineInterface): Promise<void> {
  if (eduRunning) return
  lastEdu ??= await read($, eduData).catch(() => undefined)
  const s = await read($, tree).catch(() => undefined)
  if (eduDue(lastEdu, await clock($), eduRanAt, s !== undefined && tabOf(s) === 'edu')) await refreshEdu($)
}

function watchEdu($: EngineInterface): void {
  eduTimer?.cancel()
  try {
    eduTimer = $.clock.every(EDU_TICK_MS, () => {
      void eduTick($).catch(() => undefined)
    })
  } catch {
    eduTimer = undefined
  }
}

/** Runs the crew verdict the person pressed twice (Approve or Reject, then Yes). */
async function decideCrew($: EngineInterface): Promise<void> {
  const ask = (await latest($)).confirming
  if (!ask) return
  await change($, t => confirmCleared(t))
  const w = wordsFor(lang).edu
  if (!isJobRef(ask.jobId)) return
  // The gate the pane showed: the CLI refuses it if another gate opened since.
  const shown = lastEdu ?? (await read($, eduData).catch(() => undefined))
  const requestId = shown?.jobs.find(job => job.id === ask.jobId)?.requestId
  const result = await runEdu($, verdictArgs(ask.jobId, ask.verdict, requestId), 60_000).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))))
  if (isMissing(result)) {
    $.ui.toast(w.missing)
    return
  }
  if (result instanceof Error || result.exitCode !== 0) {
    $.ui.toast(w.approveFailed(ask.jobId, result instanceof Error ? result.message : failureReason(result)))
    return
  }
  const now = await clock($)
  await change($, t => crewDecided(t, ask.jobId, ask.verdict, now))
  $.ui.toast(ask.verdict === 'approve' ? w.approved(ask.jobId) : w.rejected(ask.jobId))
  await refreshEdu($)
}





export const register: Register = (on, options) => {
  const columns = paneColumns(options.columns)
  const keep = agentLimit(options.maxAgents)
  // Unset options read as their manifest defaults; an install that never set them still opens the pane.
  const openOnStart = options.openOnStart !== false
  animate = options.animate !== false
  lang = resolveLang()

  on('session.start', async ($, e, next) => {
    carried = undefined
    handing = undefined
    generation += 1
    delivered.clear()
    seen.clear()
    starting.clear()
    standing.clear()
    changers.clear()
    const result = await next(e)
    await $.command
      .register({ name: COMMAND, description: wordsFor(lang).commandDescription, argumentHint: wordsFor(lang).commandHint, immediate: true })
      .catch(() => undefined)
    const restored = await restoreChoices($, e.isInteractive !== false).catch(() => false)
    const saved = restored ? choicesOf(await latest($)) : undefined
    if (saved && (saved.newAgents || saved.newEffort)) {
      const w = wordsFor(lang)
      $.ui.toast(w.savedChoice(`${familyOr(saved.newAgents, w.standard)}${saved.newEffort ? ` · ${effortLabel(saved.newEffort)}` : ''}`))
    }
    if (saved?.mainEffort) $.ui.toast(wordsFor(lang).savedMainEffort(effortLabel(saved.mainEffort)))
    const usage = await $.session.usage().catch(() => undefined)
    if (usage) await change($, s => withLimits(s, limitsFrom(usage.rateLimits))).catch(() => undefined)
    const listed = await $.command.list().catch(() => undefined)
    advisorCommand = !listed || listed.some(c => c.name === 'advisor')
    await readAdvisor($).catch(() => undefined)
    await readFast($).catch(() => undefined)
    await readMainModels($).catch(() => undefined)
    await catchUp($, await clock($), keep).catch(() => undefined)
    watchEdu($)
    void refreshEdu($).catch(() => undefined)
    if (openOnStart && e.isInteractive !== false) await $.ui.open({ id: PANE, title: TITLE, columns, rows: INLINE_ROWS }).catch(() => undefined)
    return result
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    await takeOver($).catch(() => undefined)
    const w = wordsFor(lang)
    const said = /^(?:to|say)\s+(\S+)(?:\s+([\s\S]*))?$/i.exec(e.args.trim())
    if (said) {
      const node = agentByPrefix(await latest($), said[1] ?? '')
      if (!node) return { text: w.writeUnknown(said[1] ?? '') }
      const label = `${typeLabel(node.type)} · ${node.description}`
      const message = (said[2] ?? '').trim()
      if (!message) return { text: w.writeEmpty(label) }
      return { text: (await sayTo($, node.id, message)) ? w.writeSent(label) : w.writeFailed(label) }
    }
    const arg = e.args.trim().toLowerCase()
    if (arg === 'stop' || arg === 'close') {
      await $.ui.close({ id: PANE }).catch(() => undefined)
      return { text: w.closedText }
    }
    const [word = '', ...names] = arg.split(/\s+/)
    const choice = lookChoice(word, names.join(' '))
    if (choice) {
      const row = choice.row
      const id = choice.id
      const choices = (LOOK_OPTIONS[row] as readonly string[]).map(option => lookOptionLabel(w, row, option)).join(', ')
      if (!id) return { text: w.lookUnknown(names.join(' '), w.lookRow[row], choices) }
      await applyLook($, row, id)
      return { text: w.lookSet(w.lookRow[row], lookOptionLabel(w, row, id)) }
    }
    if (word === 'look' && /^(?:reset|standard|default)$/i.test(names.join(' '))) {
      await resetLook($)
      return { text: w.lookResetDone }
    }
    if (arg === 'refresh') {
      await refreshEdu($)
      return { text: w.edu.refreshed }
    }
    const now = await clock($)
    if (arg === 'clear') {
      const alive = runningIds(await latest($))
      await change($, s => freshTree(s, now))
      await update($, unreadTexts, texts => withoutTexts(texts, id => !alive.has(id)))
      return { text: w.cleared }
    }
    if (arg && arg !== 'edu') return { text: w.commandUnknown(e.args.trim()) }
    await catchUp($, now, keep)
    if (arg === 'edu') {
      await change($, t => tabChosen(t, 'edu', now))
      void refreshEdu($).catch(() => undefined)
    }
    const opened = await $.ui.open({ id: PANE, title: TITLE, focus: true, columns, rows: INLINE_ROWS }).catch((err: unknown) => ({ isPlaced: false, reason: String(err) }))
    if (!opened.isPlaced) return { text: w.notOpened('reason' in opened && opened.reason ? String(opened.reason) : '') }
    const s = await latest($)
    return { text: w.opened(s.agents.length) }
  }).catch(() => ({ text: wordsFor(lang).commandFailed }))

  on('turn.start', async ($, e, next) => {
    await takeOver($).catch(() => undefined)
    const result = await next(e)
    const now = await clock($)
    await change($, s => turnStarted(s, { text: e.text, agentId: e.agentId }, now)).catch(() => undefined)
    if (!e.agentId) await readAdvisor($).catch(() => undefined)
    if (!e.agentId) await readFast($).catch(() => undefined)
    if (!e.agentId) await readMainModels($).catch(() => undefined)
    if (!e.agentId) await restoreLook($).catch(() => undefined)
    return result
  })

  on('turn.step', async function* ($, e, next) {
    await takeOver($).catch(() => undefined)
    const agentId = e.agentId
    const fed = delivered.delete(agentId ?? MAIN)
    const before = agentId !== undefined || e.effort !== undefined ? await latest($).catch(() => undefined) : undefined
    if (agentId && before && isStopping(before, agentId)) {
      const report = wordsFor(lang).stopAnswer(before.agents.find(n => n.id === agentId)?.toolCount ?? 0)
      const first = !wasStopSent(before, agentId)
      if (first) await change($, s => stopSent(s, agentId)).catch(() => undefined)
      const stopReason = first ? ('tool_use' as const) : ('end_turn' as const)
      yield { kind: 'text' as const, index: 0, text: report }
      if (first) {
        yield { kind: 'tool' as const, index: 1, id: handbackId(), name: HANDBACK }
        yield { kind: 'input' as const, index: 1, json: JSON.stringify({ message: report }) }
      }
      yield { kind: 'stop' as const, stopReason, usage: null }
      return {
        turnId: e.turnId,
        index: e.index,
        answer: report,
        toolUses: first ? [{ name: HANDBACK, input: { message: report } }] : [],
        stopReason,
        usage: null,
      }
    }
    const carriesInput = e.index === 0 || fed || Boolean(agentId && before && pendingCorrection(before, agentId))
    if (agentId && before && pendingCorrection(before, agentId)) {
      const readAt = await clock($)
      await forget($, agentId).catch(() => undefined)
      await change($, s => correctionRead(s, agentId, readAt)).catch(() => undefined)
    }
    const family = before && e.agentId ? choicesOf(before).agents[e.agentId] : undefined
    const model = before && family ? stepModelFor(before, family) : undefined
    const unrecorded = agentId !== undefined && before !== undefined && !before.agents.some(n => n.id === agentId)
    const fallback = agentId === undefined ? undefined : starting.has(agentId) ? starting.get(agentId) : unrecorded && !seen.has(agentId) && spawning > 0 ? choicesOf(before as DeckState).newEffort : undefined
    const effort =
      before && agentId && (e.effort !== undefined || model !== undefined)
        ? stepEffortFor(before, agentId, fallback)
        : before && !agentId && e.effort !== undefined
          ? mainStepEffort(before)
          : undefined
    const known = agentId ? before?.agents.find(n => n.id === agentId)?.effort : before?.main.effort
    const sent = effort ?? e.effort
    const applies = carriesInput || typeof sent === 'number'
    if (applies && sent !== undefined) standing.set(agentId ?? MAIN, sent)
    else if (applies) standing.delete(agentId ?? MAIN)
    const shownEffort = applies ? sent : known === undefined ? (standing.get(agentId ?? MAIN) ?? e.effort) : undefined
    const changed = model !== undefined || (effort !== undefined && effort !== e.effort)
    const result = yield* next(changed ? { ...e, ...(model ? { model } : {}), ...(effort ? { effort } : {}) } : e)
    const usage = result.usage
    const contextTokens = usage
      ? usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
      : undefined
    const advisorUses = (result.serverToolUses ?? [])
      .filter(use => use.name === 'advisor')
      .map(use => ({ id: use.id, startedAt: use.startedAt, endedAt: use.endedAt }))
    const now = await clock($)
    await change($, s =>
      stepped(
        s,
        {
          agentId: e.agentId,
          answer: result.answer,
          model: usage?.model ?? model ?? e.model,
          effort: shownEffort,
          effortless: e.index === 0 && effort === undefined && e.effort === undefined,
          contextTokens,
          advisorUses,
        },
        now,
      ),
    ).catch(() => undefined)
    return result
  })

  on('agent.spawn', async ($, e, next) => {
    await takeOver($).catch(() => undefined)
    const choices = choicesOf(await latest($))
    const family = choices.newAgents
    if (e.resume) seen.add(e.resume.agentId)
    const input = family && !e.model && !e.fork && !e.resume ? { ...e, model: family } : e
    spawning += 1
    let result: Awaited<ReturnType<typeof next>>
    try {
      result = await next(input)
    } finally {
      spawning -= 1
    }
    const agentId = result.agentId
    if (agentId) {
      const pin = e.resume ? undefined : choices.newEffort
      seen.add(agentId)
      starting.set(agentId, pin)
      const now = await clock($)
      let written = true
      try {
        const grown = await change($, s =>
          trimmed(
            spawned(
              s,
              {
                agentId,
                parentAgentId: e.parentAgentId,
                agentType: e.subagentType,
                description: e.description,
                prompt: e.prompt,
                model: result.model,
                background: e.background,
                fork: e.fork,
                workflowRunId: e.workflow?.runId || undefined,
                effort: pin,
              },
              now,
            ),
            keep,
          ),
        )
        await ensureReport($, grown).catch(() => undefined)
      } catch {
        written = false
      }
      if (written) starting.delete(agentId)
    }
    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    await takeOver($).catch(() => undefined)
    const agentId = e.agentId
    const input = e as unknown as Record<string, unknown>
    const kind = toolKind(String(e.tool))
    const path = kind === 'change' ? pathOf(input) : undefined
    const eduTool = EDU_TOOL.test(String(e.tool))
    if (!agentId) {
      const result = await next(e)
      if (path && succeeded(result)) await noteChange($, MAIN, path).catch(() => undefined)
      if (eduTool) void refreshEdu($).catch(() => undefined)
      return result
    }
    const stopping = stoppingIds.has(agentId)
    if (stopping) {
      if (String(e.tool) !== HANDBACK) {
        const current = await latest($)
        return { deny: wordsFor(lang).stopAnswer(current.agents.find(n => n.id === agentId)?.toolCount ?? 0) }
      }
      if (stopSentIds.has(agentId)) return next(e)
      await change($, s => stopCancelled(s, agentId)).catch(() => undefined)
    }
    if (!stopping && String(e.tool) === HANDBACK) {
      const waiting = pendingCorrection(await latest($), agentId)
      if (waiting && !waiting.held) {
        await change($, s => correctionHeld(s, agentId)).catch(() => undefined)
        return { deny: wordsFor(lang).correctionWaiting(HANDBACK) }
      }
    }
    const label = toolLabel(String(e.tool), input)
    const file = fileNameOf(input)
    const noted = (async () => {
      const known = (await latest($)).agents.some(n => n.id === agentId)
      if (!known) return
      const now = await clock($)
      await change($, s => toolRan(s, { agentId, label, kind }, now))
    })().catch(() => undefined)
    const result = await next(e)
    await noted
    if (succeeded(result)) {
      await change($, s => fileNoted(s, agentId, kind, file)).catch(() => undefined)
      if (path) await noteChange($, agentId, path).catch(() => undefined)
    }
    if (eduTool) void refreshEdu($).catch(() => undefined)
    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    await takeOver($).catch(() => undefined)
    const result = await next(e)
    const now = await clock($)
    const after = await change($, s =>
      completed(s, { agentId: e.agentId, answer: e.answer, reason: e.reason, isAborted: e.isAborted, durationMs: e.durationMs }, now),
    ).catch(() => undefined)
    if (e.agentId && after) await settleUnread($, after, e.agentId, now).catch(() => undefined)
    if (e.agentId && (await read($, reportTexts).catch(() => undefined))?.[e.agentId]) await loadReport($, e.agentId).catch(() => undefined)
    if (after) await ensureReport($, after).catch(() => undefined)
    if (!e.agentId) await catchUp($, now, keep).catch(() => undefined)
    if (!e.agentId) void refreshEdu($).catch(() => undefined)
    await dropChanger($, e.agentId ?? MAIN).catch(() => undefined)
    return result
  })

  on('session.measure', async ($, e, next) => {
    await takeOver($).catch(() => undefined)
    const result = await next(e)
    if (e.changed.includes('context') || e.changed.includes('cost') || e.changed.includes('rateLimits')) {
      await change($, s =>
        measured(s, {
          tokens: e.context.tokens,
          window: e.context.window,
          percent: e.context.percent,
          costUsd: e.cost?.usd,
          limits: limitsFrom(e.rateLimits),
        }),
      ).catch(() => undefined)
    }
    return result
  })

  on('session.end', async ($, e, next) => {
    if (e.reason !== 'clear' && e.reason !== 'resume') return next(e)
    try {
      return await next(e)
    } finally {
      const ending = carried ?? (await snapshot($))
      if (ending) {
        carried = { ...ending, sessionId: e.sessionId }
        handing = undefined
        generation += 1
        delivered.delete(MAIN)
        ticker?.cancel()
        ticker = undefined
        $.ui.status(undefined)
        try {
          $.ui.invalidate('ui.render')
        } catch {}
      }
    }
  })

  on('session.append', { door: ['prompt', 'command', 'delivery', 'note', 'attachment'] }, async ($, e, next) => {
    const kept = await next(e)
    if (isNewInput(e.door, e.message) && (kept as { deny?: string }).deny === undefined) delivered.add(e.agentId ?? MAIN)
    return kept
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = elements
    const reports = await read($, reportTexts)
    const draft = carried
    const now = await clock($)
    const stored = await read($, tree)
    const storedLook = await read($, appearance)
    const edu = await read($, eduData)
    const tick = animate ? await read($, frame) : 0
    const s = draft ? freshTree(draft.tree, now) : stored
    const look = draft ? draft.look : storedLook
    return drawTree({ Box, Text, Button, Markdown } as never, s, e.props.bodyColumns, e.props.scroll?.bodyRows, {
      frame: tick,
      animate,
      now,
      lang,
      actions: actionsFor($),
      appearance: look,
      canAdvise: advisorCommand,
      reports,
      edu,
      docked: e.props.placement === 'dock',
    })
  })

  on('ui.press', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    await takeOver($).catch(() => undefined)
    return pressKey(actionsFor($), e.element) ? { element: e.element } : next(e)
  })
}
