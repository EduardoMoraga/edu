// Edu Deck. Ported from Agent Tree 0.7.5 (https://github.com/MikeGT4/agent-tree, commit 2b5ab2d).
// Copyright (c) 2026 Mike Pollow, Digitalroots. MIT License, full text in THIRD_PARTY_NOTICES.md.
// Edu changes: Copyright (c) 2026 Eduardo Moraga. MIT License.
import type { DeckCorrectionState, DeckLogEntry, DeckLogSource, DeckPhase, DeckStatus, DeckTab } from '../types'
import type { LookRow } from './deck-looks.ts'
import { DEFAULT_LOOK, LOOK_OPTIONS } from './deck-looks.ts'
import { effortLabel, familyLabel, fmtDuration, fmtTokens, toolKind } from './deck-model.ts'

export type Lang = 'en'

export type Words = {
  working: string
  idle: string
  advisorOnCall: (model: string) => string
  main: string
  agents: string
  advisor: string
  phase: Record<DeckPhase, string>
  status: Record<DeckStatus, string>
  mainEnd: Record<DeckStatus, string>
  running: (n: number) => string
  done: string
  effortNone: string
  context: string
  contextNone: string
  round: string
  noRound: string
  toAgents: string
  model: string
  standard: string
  noAgents: string
  back: string
  waiting: string
  ready: string
  answers: (n: number) => string
  tools: string
  under: string
  more: (n: number, running: number) => string
  earlier: (n: number) => string
  advisorTitle: string
  onCall: string
  off: string
  reads: [string, string]
  calls: string
  fromMain: string
  fromSub: string
  last: string
  duration: string
  notAsked: string
  writes: [string, string]
  log: string
  logEmpty: string
  source: Record<DeckLogSource, string>
  pickerFor: (name: string) => string
  effortFor: string
  mainEffortFor: string
  mainEffortHint: readonly string[]
  mainModelFor: string
  mainModelHint: string
  mainModelUnavailable: string
  effortNextMessage: string
  newAgents: string
  help: readonly string[]
  tabs: Record<DeckTab, string>
  fullReport: string
  helpKeys: string
  helpFast: string
  helpSize: string
  helpSizeLines: readonly string[]
  helpGlyphs: string
  helpCommands: string
  helpGuide: string
  guideUrl: string
  filesNone: string
  filesClash: string
  logAll: string
  logOrder: string
  logEntries: (count: number) => string
  task: string
  reply: string
  loading: string
  close: string
  noReply: string
  noAccess: string
  advisorShort: string
  contextShort: string
  cost: (usd: number) => string
  decimal: string
  percent: (p: number) => string
  latest: string
  stopping: string
  stopAnswer: (tools: number) => string
  writeWord: string
  writeHint: (label: string) => string
  writeSent: (label: string) => string
  writeFailed: (label: string) => string
  writeUnknown: (id: string) => string
  writeEmpty: (label: string) => string
  writeNoPrompt: string
  savedChoice: (label: string) => string
  savedMainEffort: (label: string) => string
  limitKind: (kind: string) => string
  limitReset: (time: string) => string
  locale: string
  correctionFrame: (text: string, tool: string) => string
  mainNote: (agent: string, text: string) => string
  mainNoteLost: (agent: string) => string
  resendFrame: (text: string) => string
  correctionWaiting: (tool: string) => string
  correctionFailedStatus: string
  correctionLabel: string
  correction: Record<DeckCorrectionState, string>
  toolWords: Record<string, string>
  activity: {
    read: (x: string) => string
    change: (x: string) => string
    search: (x: string) => string
    searchCode: string
    run: (x: string) => string
    web: (x: string) => string
    webSearch: string
    agent: string
  }
  actionHint: string
  stopButton: string
  writeButton: string
  detailsButton: string
  readFiles: string
  changedFiles: string
  alsoChanges: (file: string, other: string) => string
  feedback: {
    modelPending: (x: string) => string
    modelDone: (x: string) => string
    effortPending: (x: string) => string
    effortDone: (x: string) => string
    mainEffortPending: (x: string) => string
    writePending: string
    writeDone: string
    writeFailed: string
    stopPending: string
    stopDone: string
  }
  subModel: string
  advisorOn: string
  advisorOff: string
  advisorUnavailable: string
  advisorUnchanged: string
  fastOn: string
  fastOff: string
  fastUnavailable: string
  fastUnchanged: string
  look: string
  lookRow: Record<LookRow, string>
  lookOption: { [R in LookRow]: Record<(typeof LOOK_OPTIONS)[R][number], string> }
  lookReset: string
  lookSet: (row: string, option: string) => string
  lookUnknown: (name: string, row: string, options: string) => string
  commandDescription: string
  commandHint: string
  commandUnknown: (arg: string) => string
  lookResetDone: string
  opened: (count: number) => string
  closedText: string
  cleared: string
  notOpened: (reason: string) => string
  commandFailed: string
  edu: {
    title: string
    loading: string
    missing: string
    failed: (reason: string) => string
    noBrain: string
    brain: string
    canonical: string
    toApprove: (n: number) => string
    episodic: string
    transitive: string
    lessons: string
    overdue: (n: number) => string
    maintained: (ago: string) => string
    neverMaintained: string
    spec: string
    specLine: (name: string, requirements: number, checks: number) => string
    crew: string
    crewNone: string
    crewActive: (n: number) => string
    crewRecent: (n: number) => string
    crewStatus: Record<string, string>
    tokens: (amount: string) => string
    tokensPartial: (amount: string) => string
    session: string
    sessionOpen: string
    sessionClosed: string
    sessionNone: string
    sessionOld: string
    recent: string
    updated: (ago: string) => string
    refresh: string
    approve: string
    reject: string
    confirmApprove: (id: string) => string
    confirmReject: (id: string) => string
    yes: string
    no: string
    approved: (id: string) => string
    rejected: (id: string) => string
    approveFailed: (id: string, reason: string) => string
    strip: (parts: readonly string[]) => string
    stripNotes: (n: number) => string
    stripCrew: (n: number) => string
    stripFailed: string
    scope: Record<'project' | 'global', string>
    stripApprovals: (n: number) => string
    missingReason: (reason: string) => string
    statusCrew: (n: number) => string
    refreshed: string
  }
  lines: {
    turn: (d: Record<string, string | number>) => string
    mainDone: (d: Record<string, string | number>) => string
    agentStarted: (d: Record<string, string | number>) => string
    workflowStarted: (d: Record<string, string | number>) => string
    agentEnded: (d: Record<string, string | number>) => string
    workflowDone: (d: Record<string, string | number>) => string
    resumed: (d: Record<string, string | number>) => string
    adopted: (d: Record<string, string | number>) => string
    advisor: (d: Record<string, string | number>) => string
    choice: (d: Record<string, string | number>) => string
    effort: (d: Record<string, string | number>) => string
    stopRequested: (d: Record<string, string | number>) => string
    correction: (d: Record<string, string | number>) => string
    correctionFailed: (d: Record<string, string | number>) => string
    correctionResent: (d: Record<string, string | number>) => string
    crew: (d: Record<string, string | number>) => string
  }
}

export const familyOr = (family: string | number | undefined, standard: string) => (family ? familyLabel(String(family)) : standard)

export const WORDS: Record<Lang, Words> = {
  en: {
    working: 'WORKING',
    idle: 'IDLE',
    advisorOnCall: model => `ADVISOR ${model} ON CALL`,
    main: 'Main session',
    agents: 'Sub-agents',
    advisor: 'Advisor',
    phase: { idle: 'idle', planning: 'plans and decides', delegating: 'waits for sub-agents', reviewing: 'reviews and verifies' },
    status: { running: 'running', done: 'done', failed: 'failed', stopped: 'stopped' },
    mainEnd: { running: 'running', done: 'done', failed: 'failed', stopped: 'aborted' },
    running: n => `${n} running`,
    done: 'done',
    effortNone: 'no effort level',
    context: 'Context',
    contextNone: 'context not measured yet',
    round: 'Round',
    noRound: 'no round yet',
    toAgents: 'to sub-agents',
    model: 'Model',
    standard: 'Default',
    noAgents: 'no sub-agents yet',
    back: 'back to main session',
    waiting: 'waits for answers',
    ready: 'idle',
    answers: n => `${n} ${n === 1 ? 'answer' : 'answers'}`,
    tools: 'Tools',
    under: 'under',
    more: (n, r) => (r > 0 ? `+${n} more, ${r} of them running` : `+${n} more finished`),
    earlier: n => `from earlier rounds: ${n} ${n === 1 ? 'agent' : 'agents'}`,
    advisorTitle: 'ADVISOR',
    onCall: 'on call',
    off: 'not enabled',
    reads: ['reads the whole', 'session'],
    calls: 'Calls',
    fromMain: 'main',
    fromSub: 'sub',
    last: 'last',
    duration: 'took',
    notAsked: 'not asked yet',
    writes: ['never writes', 'code itself'],
    log: 'Session log',
    logEmpty: 'nothing happened yet',
    source: { session: 'session', main: 'main', agent: 'agent', advisor: 'advisor' },
    pickerFor: name => `Model for ${name}:`,
    effortFor: 'Effort:',
    mainEffortFor: 'Main session effort:',
    mainEffortHint: ['from your next message ·', "Default = Claude Code's setting ·", 'kept for new sessions'],
    mainModelFor: 'Main session model:',
    mainModelHint: 'Model: like /model, also saved for new sessions',
    mainModelUnavailable: 'Edu Deck: /model is not available in this session',
    effortNextMessage: 'applies once it gets a new message (models with effort only)',
    newAgents: 'new sub-agents',
    help: ['ctrl+x tab: pane', 'box: select', 's: stop', 'e: effort', 'm: model', 'a: look', 'Tab: move'],
    tabs: { tree: 'Tree', edu: 'Edu', reports: 'Reports', files: 'Files', log: 'Log', usage: 'Usage', help: 'Help' },
    fullReport: 'full report ›',
    helpKeys: 'Keys',
    helpFast: 'f: fast mode',
    helpSize: 'Size',
    helpSizeLines: ['Drag the left edge of the pane with the mouse: wider or narrower.', 'The width is kept for new sessions.'],
    helpGlyphs: 'Glyphs',
    helpCommands: 'Commands',
    helpGuide: 'Guide',
    guideUrl: 'github.com/EduardoMoraga/edu/blob/main/docs/guides/claude-code-deck.md',
    filesNone: 'no files yet',
    filesClash: 'Same file',
    logAll: 'all',
    logOrder: 'newest first',
    logEntries: count => (count === 1 ? '1 entry' : `${count} entries`),
    task: 'Task',
    reply: 'Answer',
    loading: 'loading …',
    close: 'close',
    noReply: 'no answer yet',
    noAccess: 'not readable',
    advisorShort: 'advisor',
    contextShort: 'context',
    cost: usd => `$${usd.toFixed(2)}`,
    decimal: '.',
    percent: p => `${p}%`,
    latest: 'Latest',
    stopping: 'stopping …',
    stopAnswer: n => `Stopped by the user in Edu Deck after ${n} tool ${n === 1 ? 'call' : 'calls'}.`,
    writeWord: 'to',
    writeHint: label => `Edu Deck: type the message to ${label}, Enter sends it`,
    writeSent: label => `Message sent to ${label}`,
    writeFailed: label => `Message to ${label} not delivered`,
    writeUnknown: id => `No agent ${id} in the pane`,
    writeEmpty: label => `Text missing: /edu-deck to <id> <text> sends it to ${label}`,
    writeNoPrompt: 'Edu Deck: the prompt is busy, a dialog is open',
    savedChoice: label => `Edu Deck: saved sub-agent choice: ${label} (m in the pane changes it)`,
    savedMainEffort: label => `Edu Deck: saved main session effort: ${label} (e in the pane changes it)`,
    limitKind: kind => (kind === 'five_hour' ? '5h' : kind === 'seven_day' ? 'week' : kind === 'spend_limit' ? 'spend' : kind),
    limitReset: time => `resets ${time}`,
    locale: 'en-US',
    correctionFrame: (text, tool) =>
      `Message from the user via Edu Deck: ${text}\n\nIt applies to your task from now on. Take it into account in your remaining work and in your report via ${tool}.`,
    mainNote: (agent, text) =>
      `The user wrote to the sub-agent ${agent} via Edu Deck: "${text}". Its result may differ from the task for that reason.`,
    mainNoteLost: agent => `Note: the user's message to ${agent} did not arrive; its result does not reflect it.`,
    resendFrame: text => `This message arrived before you finished and was not read:\n\n${text}`,
    correctionWaiting: tool => `Before you finish: the user sent you a new message, shown above. Act on it, then call ${tool} again with a report that reflects it.`,
    correctionFailedStatus: 'Edu Deck: correction not delivered',
    correctionLabel: 'Correction',
    correction: { sent: 'sent', read: 'read', failed: 'not delivered' },
    toolWords: { SubagentHandback: 'answer handed back' },
    activity: {
      read: x => `reads ${x}`,
      change: x => `edits ${x}`,
      search: x => `searches ${x}`,
      searchCode: 'searches the code',
      run: x => `runs ${x}`,
      web: x => `browses ${x}`,
      webSearch: 'searches the web',
      agent: 'starts an agent',
    },
    actionHint: 'Click a box: stop, write, model, effort',
    stopButton: 'Stop',
    writeButton: 'Write',
    detailsButton: 'Details',
    readFiles: 'Read',
    changedFiles: 'Changed',
    alsoChanges: (file, other) => `⚠ ${other} edits ${file} too`,
    feedback: {
      modelPending: x => `✓ Model set to ${x}, applies from its next step`,
      modelDone: x => `✓ now running on ${x}`,
      effortPending: x => `✓ Effort ${x} chosen, applies from its next message`,
      effortDone: x => `✓ now working at effort ${x}`,
      mainEffortPending: x => `✓ Effort ${x} chosen, applies from your next message`,
      writePending: '✎ Message delivered',
      writeDone: '✎ Message read',
      writeFailed: '✎ Message not delivered',
      stopPending: '■ Stopping agent',
      stopDone: '■ Stopped',
    },
    subModel: 'Sub-agent model',
    advisorOn: 'turn on',
    advisorOff: 'turn off',
    advisorUnavailable: 'Edu Deck: /advisor is not available in this session',
    advisorUnchanged: 'Edu Deck: Claude Code did not switch the advisor, the transcript says why',
    fastOn: '↯ Fast mode: on',
    fastOff: '↯ Fast mode: off',
    fastUnavailable: 'Edu Deck: /fast is not available in this session',
    fastUnchanged: 'Edu Deck: Claude Code did not switch fast mode, the transcript says why',
    look: 'Look',
    lookRow: { style: 'Style', colors: 'Colors', light: 'Glow' },
    lookOption: {
      style: { line: 'Line', pixel: 'Pixel', braille: 'Braille', hud: 'HUD', ascii: 'ASCII' },
      colors: { original: 'Original', light: 'Light', retro: 'Retro', mono: 'Mono' },
      light: { standard: 'Default', white: 'White', gold: 'Gold', cyan: 'Cyan', magenta: 'Magenta' },
    },
    lookReset: 'Reset',
    lookSet: (row, option) => `Edu Deck · ${row}: ${option}`,
    lookUnknown: (name, row, options) => `Edu Deck: ${name ? `"${name}" is not a choice. ` : ''}${row}: ${options}`,
    commandDescription: "Edu Deck: the session's agents as a live tree, plus Edu's brain, crew and session (to, stop, clear, refresh, style, colors, glow)",
    commandHint: '[to <id> <text>|stop|clear|refresh|edu|style <name>|colors <name>|glow <name>|look reset]',
    commandUnknown: arg => `Edu Deck: "${arg}" is not a command. Try: to <id> <text>, stop, clear, refresh, edu, style <name>, colors <name>, glow <name>, look reset`,
    lookResetDone: 'Edu Deck · look back to default',
    opened: n => `Edu Deck opened · ${n} ${n === 1 ? 'agent' : 'agents'} so far · /edu-deck stop closes`,
    closedText: 'Edu Deck closed',
    cleared: 'Edu Deck cleared',
    notOpened: reason => `Edu Deck: pane not opened: ${reason}`,
    commandFailed: 'Edu Deck: command failed',
    edu: {
      title: 'EDU',
      loading: 'Reading Edu…',
      missing: 'The edu command is not on PATH: install edu-agent, then press r.',
      failed: reason => `edu deck failed: ${reason}`,
      noBrain: 'No Edu brain for this folder: run `edu setup` once.',
      brain: 'Brain',
      canonical: 'canonical',
      toApprove: n => `${n} to approve`,
      episodic: 'episodic',
      transitive: 'transitive',
      lessons: 'lessons',
      overdue: n => `${n} overdue`,
      maintained: ago => `maintained ${ago}`,
      neverMaintained: 'never maintained',
      spec: 'Spec',
      specLine: (name, r, c) => `${name} · ${r} req · ${c} ${c === 1 ? 'check' : 'checks'}`,
      crew: 'Crew',
      crewNone: 'No crew jobs yet. Ask "delegate to codex …" or run /edu:run.',
      crewActive: n => `${n} active`,
      crewRecent: n => `${n} recent`,
      crewStatus: { running: 'running', queued: 'queued', 'awaiting-approval': 'needs approval', done: 'done', failed: 'failed', cancelled: 'cancelled' },
      tokens: amount => `${amount} tok`,
      tokensPartial: amount => `≥${amount} tok`,
      session: 'Session',
      sessionOpen: 'open',
      sessionClosed: 'closed',
      sessionNone: 'not recorded',
      sessionOld: 'not reported by this edu version: run edu update',
      recent: 'Recent notes',
      updated: ago => `updated ${ago}`,
      refresh: 'Refresh',
      approve: 'Approve',
      reject: 'Reject',
      confirmApprove: id => `Approve crew run ${id}? It starts other agents.`,
      confirmReject: id => `Reject crew run ${id}?`,
      yes: 'Yes',
      no: 'No',
      approved: id => `Edu: crew run ${id} approved`,
      rejected: id => `Edu: crew run ${id} rejected`,
      approveFailed: (id, reason) => `Edu: crew run ${id} not changed: ${reason}`,
      strip: parts => parts.join(' · '),
      stripNotes: n => `brain ${n}`,
      stripCrew: n => `crew ${n} active`,
      stripFailed: 'Edu could not be read: see the Edu tab',
      scope: { project: 'project brain', global: 'global brain' },
      stripApprovals: n => `${n} crew ${n === 1 ? 'run needs' : 'runs need'} approval`,
      missingReason: reason => `The engine said: ${reason}`,
      statusCrew: n => `Crew [${n}]`,
      refreshed: 'Edu Deck: Edu data refreshed',
    },
    lines: {
      turn: d => `Round ${d.turn}: ${d.excerpt}`,
      mainDone: d => `Main session ${WORDS.en.mainEnd[d.status as DeckStatus] ?? d.status} after ${fmtDuration(Number(d.durationMs))}`,
      agentStarted: d => `${d.type} started: ${d.description}`,
      workflowStarted: d => `Workflow started: ${d.description}`,
      agentEnded: d =>
        d.status === 'done'
          ? `${d.type} done after ${fmtDuration(Number(d.durationMs))} · ↑ ${fmtTokens(Number(d.tokens), '.')}`
          : `${d.type} ${WORDS.en.status[d.status as DeckStatus] ?? d.status}`,
      workflowDone: d => `Workflow done: ${d.size} ${Number(d.size) === 1 ? 'agent' : 'agents'}`,
      resumed: d => `${d.type} resumed: ${d.description}`,
      adopted: d => `${d.count} ${Number(d.count) === 1 ? 'agent' : 'agents'} taken over from the agent list`,
      advisor: d => `consulted from ${d.where ? d.where : 'main session'}`,
      choice: d => `Model for ${d.who ? d.who : 'new sub-agents'}: ${familyOr(d.family, 'Default')}`,
      effort: d =>
        `${d.main ? 'Main session effort' : `Effort for ${d.who ? d.who : 'new sub-agents'}`}: ${d.effort ? effortLabel(String(d.effort)) : 'Default'}`,
      stopRequested: d => `Stop requested for ${d.type}`,
      correction: d => `Correction to ${d.type}: ${d.text}`,
      correctionFailed: d => `Correction to ${d.type} not delivered${d.text ? `: ${d.text}` : ''}`,
      correctionResent: d => `Correction to ${d.type} sent again`,
      crew: d => `Crew run ${d.id} ${d.verdict === 'approve' ? 'approved' : 'rejected'}`,
    },
  },
}

const LOOK_WORDS = new Map<string, LookRow>([
  ['style', 'style'],
  ['colors', 'colors'],
  ['colours', 'colors'],
  ['light', 'light'],
  ['glow', 'light'],
])

const fold = (text: string) => text.toLowerCase().replaceAll('ß', 'ss')

export function lookOptionLabel(w: Words, row: LookRow, id: string): string {
  return (w.lookOption[row] as Record<string, string>)[id] ?? id
}

export function lookChoice(word: string, name: string): { row: LookRow; id?: string } | undefined {
  const row = LOOK_WORDS.get(word.toLowerCase())
  if (!row) return undefined
  const wanted = fold(name)
  if (wanted === 'standard' || wanted === 'default') return { row, id: DEFAULT_LOOK[row] }
  const id = (LOOK_OPTIONS[row] as readonly string[]).find(option =>
    [option, lookOptionLabel(WORDS.en, row, option)].some(label => fold(label) === wanted),
  )
  return id ? { row, id } : { row }
}

export function helpItems(w: Words, fast: boolean): readonly string[] {
  return fast ? [...w.help.slice(0, -1), w.helpFast, ...w.help.slice(-1)] : w.help
}

export function wordsFor(_lang?: string): Words {
  return WORDS.en
}

export function logLine(entry: DeckLogEntry, lang: Lang = 'en'): string {
  const lines = wordsFor(lang).lines as Record<string, (d: Record<string, string | number>) => string>
  const render = entry.kind ? lines[entry.kind] : undefined
  if (render) return render(entry.data ?? {})
  return entry.text ?? ''
}

/** English for now; the type stays so a second language is one dictionary away. */
export function resolveLang(): Lang {
  return 'en'
}

export function toolText(label: string | undefined, lang: Lang = 'en'): string | undefined {
  if (label === undefined) return undefined
  return wordsFor(lang).toolWords[label] ?? label
}

export function activityText(label: string | undefined, lang: Lang = 'en'): string | undefined {
  if (label === undefined) return undefined
  const space = label.indexOf(' ')
  const tool = space < 0 ? label : label.slice(0, space)
  const detail = space < 0 ? '' : label.slice(space + 1)
  const words = wordsFor(lang).activity
  const kind = toolKind(tool)
  if (kind === 'read' && detail) return words.read(detail)
  if (kind === 'change' && detail) return words.change(detail)
  if (kind === 'search') return detail ? words.search(detail) : words.searchCode
  if (kind === 'run' && detail) return detail.includes(' ') ? detail : words.run(detail)
  if (kind === 'web') return detail ? words.web(detail) : words.webSearch
  if (kind === 'agent') return words.agent
  return toolText(label, lang)
}
