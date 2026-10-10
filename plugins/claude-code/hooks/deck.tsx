// Edu Deck: Claude Code mod pane. Generated into plugins/claude-code by scripts/build-plugins.ts.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { DeckJob, DeckSnapshot, DeckSpec } from '../types'

const PANE = 'edu-deck'
const TITLE = 'Edu Deck'
const REFRESH_MS = 2000
const snapshot = atom({ plugin: 'edu', key: 'snapshot' } as const, null as DeckSnapshot | null)

// Edu's warm accent on dark, matching the EDU wordmark.
const ACCENT = '#F5A97F'
const OK = '#A6DA95'
const WARN = '#EED49F'
const BAD = '#ED8796'
const MUTED = '#8087A2'

/** Counts Markdown notes under a brain layer, one level of sub-folders deep. */
async function countNotes($: EngineInterface, dir: string): Promise<number> {
  if (!(await $.fs.exists(dir))) return 0
  let total = 0
  for (const entry of await $.fs.list(dir)) {
    if (entry.kind === 'file' && entry.name.endsWith('.md')) total++
    else if (entry.kind === 'dir') {
      for (const inner of await $.fs.list(`${dir}/${entry.name}`)) {
        if (inner.kind === 'file' && inner.name.endsWith('.md')) total++
      }
    }
  }
  return total
}

async function latestSpec($: EngineInterface): Promise<DeckSpec | undefined> {
  const dir = '.edu/specs'
  if (!(await $.fs.exists(dir))) return undefined
  const newest = (await $.fs.list(dir))
    .filter(entry => entry.kind === 'file' && entry.name.endsWith('.md'))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
  if (!newest) return undefined
  const text = await $.fs.read(`${dir}/${newest.name}`)
  return {
    name: newest.name.replace(/\.md$/, ''),
    requirements: (text.match(/^- \*\*R-/gm) ?? []).length,
    checks: (text.match(/^### C-/gm) ?? []).length,
  }
}

async function crewJobs($: EngineInterface): Promise<DeckJob[]> {
  const dir = '.edu/crew'
  if (!(await $.fs.exists(dir))) return []
  const files = (await $.fs.list(dir))
    .filter(entry => entry.kind === 'file' && entry.name.endsWith('.json'))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 8)
  const jobs: DeckJob[] = []
  for (const file of files) {
    try {
      const job = JSON.parse(await $.fs.read(`${dir}/${file.name}`)) as Record<string, unknown>
      const usage = (job.usage ?? {}) as { inputTokens?: number; outputTokens?: number }
      jobs.push({
        id: String(job.id ?? file.name).slice(0, 8),
        cli: String(job.cli ?? '?'),
        task: String(job.goal ?? job.task ?? '').replace(/\s+/g, ' ').trim(),
        status: String(job.status ?? 'queued'),
        mode: String(job.kind === 'orchestration' ? 'run' : job.mode ?? 'headless'),
        startedAt: Date.parse(String(job.createdAt ?? '')) || file.mtimeMs,
        endedAt: job.endedAt ? Date.parse(String(job.endedAt)) : undefined,
        tokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
      })
    } catch {
      // A job file being written right now is skipped until the next refresh.
    }
  }
  return jobs
}

const elapsed = (from: number, to: number) => {
  const s = Math.max(0, Math.round((to - from) / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`
}
const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const bar = (percent: number, width: number) => {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)
  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}
const glyph: Record<string, [string, string]> = {
  running: ['●', ACCENT],
  queued: ['○', MUTED],
  'awaiting-approval': ['⏸', WARN],
  done: ['✓', OK],
  failed: ['✗', BAD],
  cancelled: ['⊘', MUTED],
}

async function refresh($: EngineInterface): Promise<void> {
  const hasBrain = await $.fs.exists('.edu/brain')
  const usage = await $.session.usage().catch(() => undefined)
  const next: DeckSnapshot = {
    hasBrain,
    notes: hasBrain
      ? {
          canonical: await countNotes($, '.edu/brain/1-canonical'),
          episodic: await countNotes($, '.edu/brain/2-episodic'),
          transitive: await countNotes($, '.edu/brain/3-transitive'),
        }
      : { canonical: 0, episodic: 0, transitive: 0 },
    jobs: hasBrain ? await crewJobs($) : [],
    spec: hasBrain ? await latestSpec($) : undefined,
    context: usage?.context ? { tokens: usage.context.tokens, window: usage.context.window, percent: usage.context.percent } : undefined,
    costUsd: usage?.cost?.usd,
    updatedAt: Date.now(),
  }
  await update($, snapshot, () => next)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'edu-deck', description: 'Open the Edu Deck pane (context, brain, spec, crew)' })
    await refresh($).catch(() => undefined)
    $.clock.every(REFRESH_MS, () => { void refresh($).catch(() => undefined) })
    // Open on its own only inside an Edu project; elsewhere it waits for /edu-deck.
    if (await $.fs.exists('.edu/brain')) void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })

  on('command.run', { command: 'edu-deck' }, async $ => {
    await refresh($).catch(() => undefined)
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Edu Deck opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const deck = await read($, snapshot)
    const width = Math.max(30, (e.viewport?.columns ?? 48) - 4)
    const barWidth = Math.max(8, Math.min(24, width - 22))
    const now = Date.now()

    const section = (title: string, right: string | undefined, children: RenderChildren, color = ACCENT) => (
      <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} marginBottom={0}>
        <Box justifyContent="space-between">
          <Text color={color} bold>{title}</Text>
          {right ? <Text color={MUTED}>{right}</Text> : null}
        </Box>
        {children}
      </Box>
    )

    if (!deck) return <Text color={MUTED}>Edu Deck is loading…</Text>

    const ctx = deck.context
    const contextLine = ctx?.percent !== undefined
      ? <Text><Text color={ctx.percent > 80 ? BAD : ctx.percent > 60 ? WARN : OK}>{bar(ctx.percent, barWidth)}</Text> <Text bold>{ctx.percent}%</Text> <Text color={MUTED}>{compact(ctx.tokens ?? 0)}/{compact(ctx.window)}</Text></Text>
      : <Text color={MUTED}>waiting for the first response…</Text>

    const running = deck.jobs.filter(job => job.status === 'running' || job.status === 'awaiting-approval').length

    return (
      <Box flexDirection="column">
        <Box justifyContent="space-between" paddingX={1}>
          <Text color={ACCENT} bold>◆ EDU DECK</Text>
          <Text color={MUTED}>{deck.costUsd !== undefined ? `$${deck.costUsd.toFixed(2)}` : ''}</Text>
        </Box>

        {section('CONTEXT', ctx ? `window ${compact(ctx.window)}` : undefined, contextLine)}

        {deck.hasBrain
          ? section('BRAIN', `${deck.notes.canonical + deck.notes.episodic + deck.notes.transitive} notes`,
            <Text>
              <Text color={OK}>canonical {deck.notes.canonical}</Text>
              <Text color={MUTED}> · </Text>
              <Text>episodic {deck.notes.episodic}</Text>
              <Text color={MUTED}> · </Text>
              <Text color={WARN}>transitive {deck.notes.transitive}</Text>
            </Text>)
          : section('BRAIN', undefined, <Text color={MUTED}>No Edu brain here. Run `edu init` in this folder.</Text>, MUTED)}

        {deck.spec
          ? section('SPEC', `${deck.spec.requirements} req · ${deck.spec.checks} checks`,
            <Text wrap="truncate-end" color={MUTED}>{deck.spec.name}</Text>)
          : null}

        {section('CREW', deck.jobs.length ? `${running} active · ${deck.jobs.length} recent` : undefined,
          deck.jobs.length === 0
            ? <Text color={MUTED}>No crew jobs yet. Ask: "delegate to codex …" or /edu:run</Text>
            : <Box flexDirection="column">
                {deck.jobs.map(job => {
                  const [mark, color] = glyph[job.status] ?? ['?', MUTED]
                  const time = elapsed(job.startedAt, job.endedAt ?? now)
                  return (
                    <Box key={job.id} justifyContent="space-between">
                      <Text wrap="truncate-end">
                        <Text color={color}>{mark} </Text>
                        <Text bold>{job.cli}</Text>
                        <Text color={MUTED}> {job.mode} </Text>
                        <Text>{job.task}</Text>
                      </Text>
                      <Text color={MUTED}> {job.tokens ? `${compact(job.tokens)} · ` : ''}{time}</Text>
                    </Box>
                  )
                })}
              </Box>)}

        <Box paddingX={1}>
          <Text color={MUTED}>updated {elapsed(deck.updatedAt, now)} ago · /edu-deck to reopen</Text>
        </Box>
      </Box>
    )
  })
}
