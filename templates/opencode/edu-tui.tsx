/** @jsxImportSource @opentui/solid */
// Edu for OpenCode 2: a brain/crew line in the home footer, a live deck in the session sidebar and
// the /edu-deck command. OpenCode 2 TUI plugin contract: `export default { id, setup(context) }`,
// UI placed with context.ui.slot({ append: '<slot path>', render }), commands with context.keymap.layer.
// Generated into plugins/opencode/tui by scripts/build-plugins.ts and installed by `edu setup` as
// ~/.config/opencode/plugins/edu-deck/tui.tsx (OpenCode 2 discovers TUI plugins as directories).
// @ts-nocheck: @opentui/solid and solid-js are provided by OpenCode at load time.
import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import { useTerminalDimensions } from '@opentui/solid'
import { createSignal, For, Show } from 'solid-js'

/** Edu's tagline, Spanish when EDU_LANG or the POSIX locale says so (same rule as the CLI). */
const TAGLINE = (() => {
  const env = process.env;
  const lang = (env.EDU_LANG || env.LC_ALL || env.LC_MESSAGES || env.LANG || '').toLowerCase();
  return lang.startsWith('es') ? 'tu agente orquestador, con memoria propia' : 'your orchestrator agent, with a memory of its own';
})();

const id = 'edu.deck'
const windows = process.platform === 'win32'
const EDU = process.env.EDU_BIN || 'edu'
const REFRESH_MS = 3000

// Edu's warm accent on dark, the same palette as the Claude Code deck and the Pi extension.
const ACCENT = '#F5A97F'
const OK = '#A6DA95'
const WARN = '#EED49F'
const BAD = '#ED8796'
const MUTED = '#8087A2'

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
/** Coarse age for maintenance stamps: just now · 5m ago · 3h ago · 2d ago. */
const ago = (from, to) => {
  const m = Math.max(0, Math.floor((to - from) / 60000))
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`
}
// edu ≥ 0.7 fields; older snapshots read as zero so nothing extra renders.
const toApprove = (deck) => Number(deck?.brain?.toApprove) || 0
const overdue = (deck) => Number(deck?.maintenance?.overdue) || 0

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
  if (b.present) {
    const m = deck.maintenance
    const upkeep = [
      m?.lastRun ? `maintained ${ago(m.lastRun, now)}` : '',
      m?.lastRun && m.promoted ? `${m.promoted} promoted` : '',
      m?.lastRun && m.retired ? `${m.retired} retired` : '',
      toApprove(deck) ? `${toApprove(deck)} to approve` : '',
      overdue(deck) ? `${overdue(deck)} overdue` : '',
    ].filter(Boolean)
    if (upkeep.length) lines.push(`Upkeep  ${upkeep.join(' · ')}`)
    if (toApprove(deck)) lines.push('        review: edu brain proposals · approve: edu brain approve <id> or --all')
  }
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

function setup(context) {
  const cwd = () => context.location?.directory || process.cwd()
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

  const text = () => context.theme?.text?.base ?? '#CAD3F5'
  const muted = () => context.theme?.text?.muted ?? MUTED

  // Home footer status row: ◆ EDU project · brain c/p/e/t · crew running/approvals · spec.
  const Stats = () => {
    const dim = useTerminalDimensions()
    return (
      <box flexDirection="row" flexShrink={0} gap={1}>
        <text fg={ACCENT}><b>◆ EDU</b></text>
        <Show when={deck()} fallback={<text fg={muted()}>{basename(cwd())}</text>}>
          <text fg={text()}>{clip(deck().project.name, 20)}</text>
          <Show when={deck().brain.present} fallback={<text fg={muted()}>· no brain · edu init</text>}>
            <text fg={muted()}>· brain</text>
            <text fg={OK}>{String(deck().brain.canonical)}</text>
            <text fg={muted()}>/</text>
            <text fg={WARN}>{String(deck().brain.proposed)}</text>
            <text fg={muted()}>/</text>
            <text fg={text()}>{String(deck().brain.episodic)}</text>
            <text fg={muted()}>· crew</text>
            <text fg={deck().jobs.some((job) => job.status === 'running') ? ACCENT : muted()}>
              {String(deck().jobs.filter((job) => job.status === 'running').length)}
            </text>
            <Show when={deck().approvals}>
              <text fg={WARN}>{`⏸ ${deck().approvals}`}</text>
            </Show>
            <Show when={toApprove(deck())}>
              <text fg={WARN}>{`· ${toApprove(deck())} to approve`}</text>
            </Show>
            <Show when={overdue(deck())}>
              <text fg={BAD}>{`· ${overdue(deck())} overdue`}</text>
            </Show>
            <Show when={deck().spec && dim().width >= 100}>
              <text fg={muted()}>· spec</text>
              <text fg={text()}>{clip(deck().spec.name, 20)}</text>
            </Show>
          </Show>
        </Show>
      </box>
    )
  }

  const Row = (props) => (
    <box flexDirection="row" justifyContent="space-between">
      <box flexDirection="row" gap={1}>{props.children}</box>
      <Show when={props.right}><text fg={muted()}>{props.right}</text></Show>
    </box>
  )

  const Sidebar = () => (
    <Show when={deck()}>
      <box flexDirection="column" paddingTop={1}>
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
          <Show when={toApprove(deck()) || overdue(deck())}>
            <box flexDirection="row" gap={1}>
              <Show when={toApprove(deck())}><text fg={WARN}>{`${toApprove(deck())} to approve`}</text></Show>
              <Show when={overdue(deck())}><text fg={BAD}>{`${overdue(deck())} overdue`}</text></Show>
            </box>
          </Show>
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

  // OpenCode 2 has no home-logo slot; the wordmark and tagline open the /edu-deck dialog instead.
  const open = async () => {
    await refresh()
    const message = [...WORDMARK_SMALL, TAGLINE, '', summary(deck(), cwd())].join('\n')
    await context.ui.dialog.alert({ title: '◆ Edu Deck', message })
  }

  context.ui.slot({ append: 'home.footer.status', render: () => <Stats /> })
  context.ui.slot({ append: 'sidebar.content', render: () => <Sidebar /> })
  // Commands live in a keymap layer owned by a mounted component; the app slot is always mounted.
  context.ui.slot({
    append: 'app',
    render() {
      context.keymap.layer(() => ({
        mode: 'global',
        commands: [{
          id: 'edu.deck',
          title: 'Edu Deck',
          description: 'Brain, spec and crew for this project',
          group: 'Edu',
          slash: { name: 'edu-deck' },
          palette: true,
          run() { void open() },
        }],
      }))
      return null
    },
  })

  return () => clearInterval(timer)
}

export default { id, setup }
