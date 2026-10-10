/** @jsxImportSource @opentui/solid */
// Edu for OpenCode: EDU wordmark on home, a stats line, a live deck in the session sidebar and
// the /edu-deck command. Generated into plugins/opencode/tui by scripts/build-plugins.ts and
// installed by `edu setup` into ~/.config/opencode/tui-plugins/edu.tsx (listed in tui.json).
// @ts-nocheck: @opentui/solid and solid-js are provided by OpenCode at load time.
import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import { useTerminalDimensions } from '@opentui/solid'
import { createSignal, For, Show } from 'solid-js'

const id = 'edu'
const windows = process.platform === 'win32'
const EDU = process.env.EDU_BIN || 'edu'
const REFRESH_MS = 3000

// Edu's warm accent on dark, the same palette as the Claude Code deck and the Pi extension.
const ACCENT = '#F5A97F'
const OK = '#A6DA95'
const WARN = '#EED49F'
const BAD = '#ED8796'
const MUTED = '#8087A2'

const WORDMARK = [
  '███████ ██████  ██   ██',
  '██      ██   ██ ██   ██',
  '█████   ██   ██ ██   ██',
  '██      ██   ██ ██   ██',
  '███████ ██████   █████ ',
]
const WORDMARK_SMALL = ['█▀▀ █▀▄ █ █', '██▄ █▄▀ █▄█']

const ACTIVE = new Set(['running', 'queued', 'awaiting-approval'])
const GLYPH = {
  running: ['●', ACCENT],
  queued: ['○', MUTED],
  'awaiting-approval': ['⏸', WARN],
  done: ['✓', OK],
  failed: ['✗', BAD],
  cancelled: ['⊘', MUTED],
}

const elapsed = (from, to) => {
  const s = Math.max(0, Math.round((to - from) / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`
}
const compact = (n) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)).replace('.0', '')
const clip = (text, max) => {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, Math.max(0, max - 1))}…` : flat
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** `edu deck --json` (contract v1). Never throws; resolves undefined when edu is missing, old or slow. */
function fetchDeck(cwd) {
  return new Promise((resolve) => {
    try {
      const args = windows ? ['deck', '--json'] : ['deck', '--json', '--cwd', cwd]
      execFile(EDU, args, { cwd, timeout: 1500, shell: windows, windowsHide: true, encoding: 'utf8', maxBuffer: 1 << 20 }, (error, stdout) => {
        if (error) return resolve(undefined)
        try {
          const deck = JSON.parse(stdout)
          resolve(deck?.version === 1 && deck.brain && Array.isArray(deck.jobs) ? { recent: [], approvals: 0, spec: null, ...deck } : undefined)
        } catch { resolve(undefined) }
      })
    } catch { resolve(undefined) }
  })
}

function summary(deck, cwd) {
  if (!deck) return `Edu · ${basename(cwd)}\nThe live deck needs \`edu deck\` (edu ≥ 0.6). Update edu, then reopen.`
  const b = deck.brain
  const now = Date.now()
  const lines = [`${deck.identity} · ${deck.project.name}`, '']
  lines.push(b.present
    ? `Brain   ${b.canonical} canonical · ${b.proposed} proposed · ${b.episodic} episodic · ${b.transitive} transitive · ${plural(b.lessons, 'lesson')}`
    : 'Brain   none here. Run `edu init` in this folder.')
  if (deck.spec) lines.push(`Spec    ${deck.spec.name} · ${plural(deck.spec.requirements, 'requirement')} · ${plural(deck.spec.checks, 'check')}`)
  const active = deck.jobs.filter((job) => ACTIVE.has(job.status)).length
  lines.push(`Crew    ${active} active · ${deck.jobs.length} recent${deck.approvals ? ` · ${deck.approvals} awaiting approval` : ''}`)
  for (const job of deck.jobs.slice(0, 8)) {
    const [mark] = GLYPH[job.status] ?? ['?']
    lines.push(`  ${mark} ${job.cli.padEnd(8)} ${clip(job.task, 46)}  ${elapsed(job.startedAt, job.endedAt ?? now)}`)
  }
  if (deck.recent.length) {
    lines.push('', 'Recent')
    for (const note of deck.recent.slice(0, 5)) lines.push(`  ◆ ${note.tier.padEnd(10)} ${clip(note.title, 44)}`)
  }
  return lines.join('\n')
}

const tui = async (api) => {
  const cwd = () => api.state?.path?.directory || process.cwd()
  const [deck, setDeck] = createSignal(undefined)
  const [now, setNow] = createSignal(Date.now())
  let inflight = false
  const refresh = async () => {
    if (inflight) return
    inflight = true
    try {
      const next = await fetchDeck(cwd())
      // A failed refresh keeps the last good snapshot instead of flickering to empty.
      if (next || !deck()) setDeck(next)
      setNow(Date.now())
    } finally { inflight = false }
  }
  void refresh()
  const timer = setInterval(() => { void refresh() }, REFRESH_MS)
  timer.unref?.()
  api.lifecycle.onDispose(() => clearInterval(timer))

  const text = () => api.theme.current.text
  const muted = () => api.theme.current.textMuted ?? MUTED

  const Logo = () => {
    const dim = useTerminalDimensions()
    const art = () => (dim().width >= 40 && dim().height >= 20 ? WORDMARK : WORDMARK_SMALL)
    return (
      <box flexDirection="column" alignItems="center">
        <For each={art()}>{(line) => <text fg={ACCENT}>{line}</text>}</For>
        <text fg={muted()}>your agent, with a memory</text>
      </box>
    )
  }

  const Stats = () => (
    <box flexDirection="row" justifyContent="center" gap={1}>
      <text fg={ACCENT}>◆</text>
      <Show when={deck()} fallback={<text fg={muted()}>{`Edu · ${basename(cwd())}`}</text>}>
        <text fg={text()}>{deck().project.name}</text>
        <Show when={deck().brain.present} fallback={<text fg={muted()}>· no brain here · edu init</text>}>
          <text fg={muted()}>· brain</text>
          <text fg={OK}>{String(deck().brain.canonical)}</text>
          <text fg={muted()}>/</text>
          <text fg={WARN}>{String(deck().brain.proposed)}</text>
          <text fg={muted()}>/</text>
          <text fg={text()}>{String(deck().brain.episodic)}</text>
          <text fg={muted()}>/</text>
          <text fg={muted()}>{String(deck().brain.transitive)}</text>
          <text fg={muted()}>· crew</text>
          <text fg={deck().jobs.some((job) => job.status === 'running') ? ACCENT : muted()}>
            {String(deck().jobs.filter((job) => job.status === 'running').length)}
          </text>
          <text fg={muted()}>/</text>
          <text fg={deck().approvals ? WARN : muted()}>{String(deck().approvals)}</text>
          <Show when={deck().spec}>
            <text fg={muted()}>· spec</text>
            <text fg={text()}>{clip(deck().spec.name, 24)}</text>
          </Show>
        </Show>
      </Show>
    </box>
  )

  const Row = (props) => (
    <box flexDirection="row" justifyContent="space-between">
      <box flexDirection="row" gap={1}>{props.children}</box>
      <Show when={props.right}><text fg={muted()}>{props.right}</text></Show>
    </box>
  )

  const Sidebar = () => (
    <Show when={deck()}>
      <box flexDirection="column">
        <Row right={deck().spec ? clip(deck().spec.name, 18) : undefined}>
          <text fg={ACCENT}><b>◆ EDU</b></text>
        </Row>
        <Show when={deck().brain.present} fallback={<text fg={muted()}>no brain · edu init</text>}>
          <box flexDirection="row" gap={1}>
            <text fg={OK}>{`${deck().brain.canonical} canon`}</text>
            <text fg={WARN}>{`${deck().brain.proposed} prop`}</text>
            <text fg={text()}>{`${deck().brain.episodic} epi`}</text>
            <text fg={muted()}>{`${deck().brain.transitive} trans`}</text>
          </box>
        </Show>
        <Show when={deck().jobs.length} fallback={<text fg={muted()}>crew idle</text>}>
          <For each={deck().jobs.slice(0, 6)}>
            {(job) => {
              const [mark, color] = GLYPH[job.status] ?? ['?', MUTED]
              return (
                <Row right={elapsed(job.startedAt, job.endedAt ?? now())}>
                  <text fg={color}>{mark}</text>
                  <text fg={text()}>{job.cli}</text>
                  <text fg={muted()}>{clip(job.task, 16)}</text>
                </Row>
              )
            }}
          </For>
        </Show>
        <Show when={deck().approvals}>
          <text fg={WARN}>{`⏸ ${plural(deck().approvals, 'job')} awaiting approval`}</text>
        </Show>
      </box>
    </Show>
  )

  api.slots.register({
    order: 100,
    slots: {
      home_logo() { return <Logo /> },
      home_bottom() { return <Stats /> },
      sidebar_content() { return <Sidebar /> },
    },
  })

  const open = async () => {
    await refresh()
    const message = summary(deck(), cwd())
    const Alert = api.ui.DialogAlert
    if (Alert && api.ui.dialog) api.ui.dialog.replace(() => <Alert title="◆ Edu Deck" message={message} />)
    else api.ui.toast({ variant: 'info', title: 'Edu Deck', message, duration: 8000 })
  }

  const unregister = api.command?.register?.(() => [{
    title: 'Edu Deck',
    value: 'edu.deck',
    description: 'Brain, spec and crew for this project',
    category: 'Edu',
    slash: { name: 'edu-deck' },
    onSelect: () => { void open() },
  }])
  if (typeof unregister === 'function') api.lifecycle.onDispose(unregister)
}

const plugin = { id, tui }
export default plugin
