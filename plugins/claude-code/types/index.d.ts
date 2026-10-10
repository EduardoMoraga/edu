export type DeckJob = {
  id: string
  cli: string
  task: string
  status: string
  mode: string
  startedAt: number
  endedAt?: number
  tokens: number
}

export type DeckSpec = { name: string; requirements: number; checks: number }

export type DeckSnapshot = {
  hasBrain: boolean
  notes: { canonical: number; episodic: number; transitive: number }
  /** Canonical notes with `status: proposed`, waiting for a human. */
  toApprove?: number
  /** From `.edu/state/maintain.json` plus commitments currently overdue. */
  maintenance?: { lastRun: number | null; promoted: number; retired: number; overdue: number }
  jobs: DeckJob[]
  spec?: DeckSpec
  context?: { tokens?: number; window: number; percent?: number }
  costUsd?: number
  updatedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'edu': { snapshot: DeckSnapshot | null }
  }
}
