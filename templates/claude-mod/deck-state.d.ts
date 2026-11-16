// Edu Deck. Ported from Agent Tree 0.7.5 (https://github.com/MikeGT4/agent-tree, commit 2b5ab2d).
// Copyright (c) 2026 Mike Pollow, Digitalroots. MIT License, full text in THIRD_PARTY_NOTICES.md.
// Edu changes: Copyright (c) 2026 Eduardo Moraga. MIT License.
export type DeckStatus = 'running' | 'done' | 'failed' | 'stopped'

export type DeckPhase = 'idle' | 'planning' | 'delegating' | 'reviewing'

export type DeckNode = {
  id: string
  parentId?: string
  type: string
  description: string
  model?: string
  effort?: string
  effortless?: boolean
  background: boolean
  fork: boolean
  workflowRunId?: string
  status: DeckStatus
  startedAt: number
  endedAt?: number
  contextTokens?: number
  toolCount: number
  lastTool?: string
  tools?: string[]
  read?: string[]
  changed?: string[]
  clash?: { file: string; with: string }
  modelSince?: number
  effortSince?: number
  task?: string
  answer?: string
  answerTokens?: number
}

export type DeckStyle = 'line' | 'pixel' | 'braille' | 'hud' | 'ascii'

export type DeckColors = 'original' | 'light' | 'retro' | 'mono'

export type DeckLight = 'standard' | 'white' | 'gold' | 'cyan' | 'magenta'

export type DeckLook = { style: DeckStyle; colors: DeckColors; light: DeckLight }

export type DeckCorrectionState = 'sent' | 'read' | 'failed'

export type DeckCorrection = {
  at: number
  text: string
  via?: 'append' | 'send'
  state: DeckCorrectionState
  readAt?: number
  count: number
  held?: boolean
}

export type DeckAdvisorCall = {
  id: string
  at: number
  durationMs?: number
  agentId?: string
}

export type DeckAdvisor = {
  model?: string
  total: number
  fromMain: number
  fromAgents: number
  calls: DeckAdvisorCall[]
}

export type DeckLogSource = 'session' | 'main' | 'agent' | 'advisor'

export type DeckLogEntry = {
  at: number
  source: DeckLogSource
  kind?: string
  data?: Record<string, string | number>
  text?: string
}

export type DeckMain = {
  active: boolean
  resumed?: boolean
  turn: number
  turnStartedAt?: number
  roundStartedAt?: number
  model?: string
  effort?: string
  effortless?: boolean
  contextTokens?: number
  window?: number
  percent?: number
  returned: number
  returnedTokens: number
  costUsd?: number
  limits?: DeckLimit[]
  fast?: boolean
  modelOffer?: string[]
  modelHeld?: string
}

export type DeckLimit = {
  kind: string
  percent: number
  resetsAt?: string
}

export type DeckOrphanEnd = {
  status: DeckStatus
  at: number
  answerTokens: number
  answer?: string
  durationMs?: number
}

export type DeckChoices = {
  newAgents?: string
  newEffort?: string
  mainEffort?: string
  agents: Record<string, string>
  efforts?: Record<string, string>
  restored?: boolean
  picker?: string
  chosenAt?: Record<string, { kind: 'model' | 'effort'; at: number }>
}

export type DeckDetail = {
  agentId: string
  state: 'loading' | 'ready' | 'denied'
}

export type DeckReport = {
  agentId: string
  state: 'loading' | 'ready' | 'denied'
  task?: string
  answer?: string
}

export type DeckTab = 'tree' | 'edu' | 'reports' | 'files' | 'log' | 'usage' | 'help'

export type DeckState = {
  startedAt: number
  tab?: DeckTab
  reportsSeen?: number
  reportOf?: string
  logFilter?: DeckLogSource
  choices?: DeckChoices
  detail?: DeckDetail
  stopping?: string[]
  stopSent?: string[]
  corrections?: Record<string, DeckCorrection>
  lookOpen?: boolean
  /** A crew verdict the person pressed once and must confirm. */
  confirming?: DeckConfirm
  selected?: string
  orphans?: Record<string, DeckOrphanEnd>
  main: DeckMain
  agents: DeckNode[]
  advisor: DeckAdvisor
  log: DeckLogEntry[]
}

export type DeckCounts = {
  running: number
  done: number
  failed: number
  stopped: number
}

export type DeckGroup =
  | { kind: 'agent'; node: DeckNode }
  | {
      kind: 'workflow'
      runId: string
      size: number
      running: number
      done: number
      failed: number
      stopped: number
      startedAt: number
      lastDescription: string
    }

/** `requestId`: the approval gate the person saw (Edu 6.0); absent from older CLIs. */
export type DeckConfirm = { jobId: string; verdict: 'approve' | 'reject'; requestId?: string }

/** One Edu crew job, as `edu deck --json` reports it. */
export type DeckEduJob = {
  id: string
  cli: string
  task: string
  status: string
  mode: string
  startedAt: number
  endedAt?: number
  tokens: number
  tokensKnown: boolean
  /** The open approval gate's nonce while the job awaits approval (Edu 6.0; absent from older CLIs). The Deck passes it back to `edu crew approve|reject --request`. */
  requestId?: string
}

export type DeckEduBrain = {
  canonical: number
  proposed: number
  toApprove: number
  episodic: number
  transitive: number
  lessons: number
}

/** The Edu session note this Claude Code session opened (reported by an edu CLI that knows `deck --session`). */
export type DeckEduSession = { id: string; status: string; title?: string }

export type DeckEduState = 'loading' | 'ready' | 'missing' | 'failed'

/** Edu's own side of the Deck: brain, crew and session, read from `edu deck --json`. */
export type DeckEdu = {
  state: DeckEduState
  error?: string
  checkedAt?: number
  project?: { name: string; root: string }
  /** Which brain the CLI read: the nearest project `.edu/`, or the global one (absent from older CLIs). */
  scope?: 'project' | 'global'
  identity?: string
  brain?: DeckEduBrain
  maintenance?: { lastRun?: number; promoted: number; retired: number; overdue: number }
  spec?: { name: string; requirements: number; checks: number }
  jobs: DeckEduJob[]
  approvals: number
  recent: { title: string; tier: string; at: number }[]
  /** Undefined when the CLI does not report sessions or none is recorded for this session. */
  session?: DeckEduSession
  /** True once a CLI that knows `--session` answered. */
  sessionKnown?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    edu: { tree: Shaped<DeckState>; frame: number; look: Shaped<DeckLook>; unread: Record<string, string[]>; reports: Record<string, DeckReport>; edu: Shaped<DeckEdu> }
  }
}
