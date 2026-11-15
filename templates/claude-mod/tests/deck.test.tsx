// Edu Deck engine tests: run with `npm run test:deck` (claude plugin test on a copy of plugins/claude-code).
// The engine stubs follow Agent Tree's tests (MIT, (c) 2026 Mike Pollow, Digitalroots; see THIRD_PARTY_NOTICES.md).
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const usage = { input_tokens: 2000, output_tokens: 40, cache_read_input_tokens: 30000, cache_creation_input_tokens: 0 }

const SNAPSHOT = {
  version: 1,
  project: { name: 'edu', root: '/work/edu' },
  identity: 'Edu',
  brain: { present: true, canonical: 11, proposed: 1, toApprove: 1, episodic: 235, transitive: 76, lessons: 48 },
  maintenance: { lastRun: 1000, promoted: 0, retired: 0, overdue: 2 },
  spec: { name: 'deck-spec', requirements: 3, checks: 2 },
  jobs: [
    { id: 'abcd1234', cli: 'codex', task: 'Build the deck', status: 'awaiting-approval', mode: 'run', startedAt: 1000, endedAt: null, tokens: 0, tokensKnown: false },
    { id: 'beef5678', cli: 'pi', task: 'Review the tests', status: 'running', mode: 'headless', startedAt: 2000, endedAt: null, tokens: 1500, tokensKnown: true },
    { id: 'cafe9012', cli: 'claude', task: 'Old work', status: 'done', mode: 'pane', startedAt: 500, endedAt: 900, tokens: 0, tokensKnown: false },
  ],
  approvals: 1,
  recent: [{ title: 'Deck decision', tier: 'transitive', at: 1500 }],
  session: { id: '2026-11-15-claude-code-session-s1', status: 'open-session', title: 'Claude Code session s1' },
  updatedAt: 3000,
}

type EduCli = { missing?: boolean; old?: boolean; broken?: boolean; crewFails?: boolean }
type Appended = { agentId?: string; message: { type: string; content: { type: string; text: string }[] } }

function engine(on: On, cli: EduCli = {}) {
  const status: string[] = []
  const toasts: string[] = []
  const runs: string[][] = []
  const commands: { command: string; args: string }[] = []
  const appended: Appended[] = []
  const spawnModels: (string | undefined)[] = []
  const stepModels: string[] = []
  const settings: Record<string, unknown> = {}
  const stored: Record<string, unknown> = {}
  let spawnCount = 0
  on('store.get', (_, e) => ({ value: stored[(e as { key: string }).key] }) as never)
  on('store.set', (_, e) => {
    const { key, value } = e as { key: string; value: unknown }
    stored[key] = value
    return { value: undefined } as never
  })
  on('process.run', (_, e) => {
    const argv = [...(e as { argv: readonly string[] }).argv]
    runs.push(argv)
    // A hook's deny rejects the caller, as a command that cannot start does.
    if (cli.missing) return { deny: `spawn ${argv[0]} ENOENT` } as never
    if (argv[0] !== 'edu') return { deny: `spawn ${argv[0]} ENOENT` } as never
    if (argv[1] === 'deck') {
      if (cli.broken) return { value: { exitCode: 1, stdout: '', stderr: 'Error: brain is locked\n    at x' } } as never
      if (cli.old && argv.includes('--session')) return { value: { exitCode: 1, stdout: '', stderr: "error: unknown option '--session'" } } as never
      const { session: _session, ...older } = SNAPSHOT
      return { value: { exitCode: 0, stdout: JSON.stringify(cli.old ? older : SNAPSHOT), stderr: '' } } as never
    }
    if (argv[1] === 'crew') {
      return { value: cli.crewFails ? { exitCode: 1, stdout: '', stderr: 'Error: Crew job is not awaiting approval' } : { exitCode: 0, stdout: '{}', stderr: '' } } as never
    }
    return { value: { exitCode: 2, stdout: '', stderr: 'unknown command' } } as never
  })
  on('ui.toast', (_, e) => {
    toasts.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  on('ui.status', (_, e) => {
    status.push(e.text ?? '')
    return { value: undefined } as never
  })
  on('command.list', () => ({ value: [{ name: 'advisor', description: 'Advisor', source: 'builtin' }] }) as never)
  on('config.list', () => ({ value: [] }) as never)
  on('settings.read', () => ({ value: { ...settings } }) as never)
  on('command.run', (_, e) => {
    commands.push({ command: e.command, args: e.args })
    if (e.command === 'advisor') {
      if (e.args === 'off') delete settings.advisorModel
      else settings.advisorModel = e.args
    }
    return { text: 'ok' } as never
  })
  on('prompt.fill', () => ({ isFilled: true }) as never)
  on('prompt.read', () => ({ text: '', cursor: 0 }) as never)
  on('session.append', async (_, e, next) => {
    appended.push(e as unknown as Appended)
    return next(e)
  })
  on('session.send', async () => ({ isDelivered: true }) as never)
  on('command.register', () => ({ value: { command: 'edu-deck' } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.close', () => ({ value: undefined }) as never)
  on('ui.invalidate', (_, e, next) => next(e))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('session.id', () => ({ value: 's1' }) as never)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('agent.list', () => ({ value: [] }) as never)
  on('agent.spawn', async (_, e) => {
    spawnModels.push(e.model)
    spawnCount += 1
    return { model: 'claude-haiku-4-5-20251001', agentId: `sub-${spawnCount}` }
  })
  on('turn.start', async (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_, e) => ({ text: e.answer }) as never)
  on('tool.call', async () => ({ result: 'ok', text: 'ok' }) as never)
  on('turn.step', async function* (_, e) {
    stepModels.push(e.model)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: { ...usage, model: e.model } }
  })
  return { status, toasts, runs, commands, appended, spawnModels, stepModels, settings }
}

async function step($: Engine, options: { agentId?: string; chunks?: unknown[] } = {}) {
  const stream = $.turn.step({
    turnId: 't1',
    index: 0,
    model: options.agentId ? 'claude-haiku-4-5-20251001' : 'claude-opus-5-5',
    effort: options.agentId ? ('medium' as const) : ('high' as const),
    messageCount: 3,
    ...(options.agentId ? { agentId: options.agentId } : {}),
  })
  let read = await stream.next()
  while (!read.done) {
    options.chunks?.push(read.value)
    read = await stream.next()
  }
  return read.value
}

const pane = (bodyColumns: number, bodyRows = 60) =>
  ({
    plugin: 'edu',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'edu-deck',
    props: { title: 'Edu Deck', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows }, view: {} },
  }) as const

async function screen(ui: { drawn: () => Promise<unknown> }): Promise<string> {
  return JSON.stringify(await ui.drawn())
}

type Pressable = { press: (target: { key: string }) => Promise<unknown>; drawn: () => Promise<unknown> }

/** Selects the agent first when its action buttons are not on screen yet. */
async function steer(ui: Pressable, key: string) {
  const target = key.slice(key.indexOf(':') + 1)
  const drawn = JSON.stringify(await ui.drawn())
  if (!drawn.includes(`"key":"${key}"`) && drawn.includes(`"key":"select:${target}"`)) await ui.press({ key: `select:${target}` })
  return ui.press({ key })
}

const deck = ($: Engine, args: string) =>
  $.command.run({ command: 'edu-deck', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } } as never) as Promise<{ text: string }>

/** Starts a session and waits for the first Edu read (the start hook does not wait for it). */
async function start($: Engine) {
  await $.session.start({ cwd: '/work/edu', surface: 'terminal', isInteractive: true })
  await deck($, 'refresh')
}

async function oneAgent($: Engine) {
  await start($)
  await $.turn.start({ text: 'Check the auth module', turnId: 't1' })
  await step($)
  await $.agent.spawn({ prompt: 'Read the code.', description: 'Read code', subagentType: 'Explore' } as never)
  await step($, { agentId: 'sub-1' })
  await $.tool.call({ tool: 'Read', file_path: '/x/auth.ts', agentId: 'sub-1' } as never)
}

describe('Edu Deck', () => {
  test('/edu-deck opens the pane and the tree tab names the deck and Edu', async ($, on) => {
    const seen = engine(on)
    await start($)
    const opened = await deck($, '')
    expect(opened.text).toMatch(/Edu Deck opened · 0 agents so far/)
    const ui = await $.ui.mount(pane(90))
    const text = await screen(ui)
    expect(text).toMatch(/EDU DECK/)
    expect(text).toMatch(/brain 323 · 1 to approve · 2 overdue · crew 2 active · 1 crew run needs approval · session open/)
    expect(seen.runs[0]).toEqual(['edu', 'deck', '--json', '--session', 's1'])
    await ui.unmount()
  })

  test('the Edu tab shows the brain, the session, the spec and the crew, active jobs first', async ($, on) => {
    engine(on)
    await start($)
    const ui = await $.ui.mount(pane(100))
    await ui.press({ key: 'tab:edu' })
    const text = await screen(ui)
    expect(text).toMatch(/canonical 11/)
    expect(text).toMatch(/episodic 235/)
    expect(text).toMatch(/lessons 48/)
    expect(text).toMatch(/open · 2026-11-15-claude-code-session-s1/)
    expect(text).toMatch(/deck-spec · 3 req · 2 checks/)
    expect(text).toMatch(/2 active · 3 recent/)
    expect(text.indexOf('Build the deck')).toBeLessThan(text.indexOf('Old work'))
    expect(text).toMatch(/1.5k tok/)
    expect(text).toMatch(/Deck decision/)
    expect(await ui.find({ key: 'edu:approve:abcd1234' })).toBeDefined()
    expect(await ui.find({ key: 'edu:approve:beef5678' })).toBeUndefined()
    await ui.unmount()
  })

  test('pressing the strip opens the Edu tab', async ($, on) => {
    engine(on)
    await start($)
    const ui = await $.ui.mount(pane(90))
    await ui.press({ key: 'edu:open' })
    expect(await screen(ui)).toMatch(/Recent notes/)
    await ui.unmount()
  })

  test('approving a crew run asks once more, then runs edu crew approve and says so', async ($, on) => {
    const seen = engine(on)
    await start($)
    const ui = await $.ui.mount(pane(100))
    await ui.press({ key: 'tab:edu' })
    await ui.press({ key: 'edu:approve:abcd1234' })
    expect(await screen(ui)).toMatch(/Approve crew run abcd1234\? It starts other agents\./)
    expect(seen.runs.some(argv => argv[1] === 'crew')).toBe(false)
    await ui.press({ key: 'edu:confirm' })
    expect(seen.runs).toContainEqual(['edu', 'crew', 'approve', 'abcd1234'])
    expect(seen.toasts).toContain('Edu: crew run abcd1234 approved')
    expect(await screen(ui)).not.toMatch(/It starts other agents/)
    await ui.press({ key: 'tab:log' })
    expect(await screen(ui)).toMatch(/Crew run abcd1234 approved/)
    await ui.unmount()
  })

  test('No cancels a crew verdict and nothing runs', async ($, on) => {
    const seen = engine(on)
    await start($)
    const ui = await $.ui.mount(pane(100))
    await ui.press({ key: 'tab:edu' })
    await ui.press({ key: 'edu:reject:abcd1234' })
    expect(await screen(ui)).toMatch(/Reject crew run abcd1234\?/)
    await ui.press({ key: 'edu:cancel' })
    expect(await screen(ui)).not.toMatch(/Reject crew run/)
    expect(seen.runs.some(argv => argv[1] === 'crew')).toBe(false)
    await ui.unmount()
  })

  test('a refused verdict is reported with the CLI reason', async ($, on) => {
    const seen = engine(on, { crewFails: true })
    await start($)
    const ui = await $.ui.mount(pane(100))
    await ui.press({ key: 'tab:edu' })
    await ui.press({ key: 'edu:reject:abcd1234' })
    await ui.press({ key: 'edu:confirm' })
    expect(seen.toasts).toContain('Edu: crew run abcd1234 not changed: Error: Crew job is not awaiting approval')
    await ui.unmount()
  })

  test('without the edu command the deck says how to get it and the tree still works', async ($, on) => {
    const seen = engine(on, { missing: true })
    await start($)
    // The plain command first, then the Windows npm shim through cmd; neither starts, so Edu is missing.
    expect(seen.runs.slice(0, 2)).toEqual([
      ['edu', 'deck', '--json', '--session', 's1'],
      ['cmd', '/c', 'edu', 'deck', '--json', '--session', 's1'],
    ])
    const ui = await $.ui.mount(pane(90))
    expect(await screen(ui)).toMatch(/The edu command is not on PATH/)
    await ui.press({ key: 'tab:edu' })
    const text = await screen(ui)
    expect(text).toMatch(/install edu-agent/)
    expect(text).toMatch(/The engine said: .*ENOENT/)
    await ui.unmount()
  })

  test('an Edu 5.0 CLI without --session is read again without it, once', async ($, on) => {
    const seen = engine(on, { old: true })
    await start($)
    const reads = seen.runs.length
    await deck($, 'refresh')
    expect(seen.runs.slice(0, 2)).toEqual([
      ['edu', 'deck', '--json', '--session', 's1'],
      ['edu', 'deck', '--json'],
    ])
    expect(seen.runs.filter(argv => argv.includes('--session'))).toHaveLength(1)
    expect(seen.runs.slice(reads)).toEqual([['edu', 'deck', '--json']])
    const ui = await $.ui.mount(pane(100))
    await ui.press({ key: 'tab:edu' })
    expect(await screen(ui)).toMatch(/not reported by this edu version: run edu update/)
    await ui.unmount()
  })

  test('a failing edu deck shows its first line and keeps the pane up', async ($, on) => {
    engine(on, { broken: true })
    await start($)
    const ui = await $.ui.mount(pane(100))
    await ui.press({ key: 'tab:edu' })
    expect(await screen(ui)).toMatch(/edu deck failed: Error: brain is locked/)
    await ui.unmount()
  })

  test('an Edu tool call and a finished main turn read Edu again', async ($, on) => {
    const seen = engine(on)
    await start($)
    const before = seen.runs.length
    await $.tool.call({ tool: 'mcp__plugin_edu_edu__edu_crew_dispatch', cli: 'codex', task: 'x' } as never)
    await deck($, 'refresh')
    expect(seen.runs.length - before).toBeGreaterThanOrEqual(2)
    const reads = seen.runs.length
    await $.tool.call({ tool: 'Read', file_path: '/x/a.ts' } as never)
    expect(seen.runs.length).toBe(reads)
  })

  test('the status line counts active crew jobs', async ($, on) => {
    const seen = engine(on)
    await start($)
    expect(seen.status.at(-1)).toMatch(/Crew \[2\]/)
  })

  test('stop: tools are denied and the next step ends the agent with a handback', async ($, on) => {
    const seen = engine(on)
    await oneAgent($)
    const ui = await $.ui.mount(pane(90))
    await steer(ui, 'halt:sub-1')
    const denied = await $.tool.call({ tool: 'Read', file_path: '/x/b.ts', agentId: 'sub-1' } as never)
    expect(JSON.stringify(denied)).toMatch(/Stopped by the user in Edu Deck after 1 tool call/)
    const before = seen.stepModels.length
    const chunks: unknown[] = []
    const first = await step($, { agentId: 'sub-1', chunks })
    expect(chunks.map(c => (c as { kind: string }).kind)).toEqual(['text', 'tool', 'input', 'stop'])
    expect((chunks[1] as { name: string }).name).toBe('SubagentHandback')
    expect([seen.stepModels.length - before, first.stopReason]).toEqual([0, 'tool_use'])
    await $.turn.complete({ answer: 'stopped', durationMs: 900, isAborted: false, turnId: 't1', agentId: 'sub-1', reason: 'answer' })
    await ui.redraw()
    expect(await screen(ui)).toMatch(/stopped/)
    await ui.unmount()
  })

  test('/edu-deck to <id> writes to a running sub-agent and tells the main session', async ($, on) => {
    const seen = engine(on)
    await oneAgent($)
    const said = await deck($, 'to sub-1 Focus on the tests')
    expect(said.text).toMatch(/Explore · Read code/)
    const toAgent = seen.appended.find(row => row.agentId === 'sub-1')
    expect(toAgent?.message.content[0]?.text).toMatch(/^Message from the user via Edu Deck: Focus on the tests/)
    const toMain = seen.appended.find(row => row.agentId === undefined)
    expect(toMain?.message.content[0]?.text).toMatch(/The user wrote to the sub-agent Explore · Read code via Edu Deck/)
  })

  test('a model picked for new sub-agents is set when one starts', async ($, on) => {
    const seen = engine(on)
    await start($)
    const ui = await $.ui.mount(pane(90))
    await ui.press({ key: 'pick:new' })
    await ui.press({ key: 'choose:new:sonnet' })
    await $.agent.spawn({ prompt: 'Read.', description: 'Read', subagentType: 'Explore' } as never)
    expect(seen.spawnModels.at(-1)).toBe('sonnet')
    await ui.unmount()
  })

  test('a model picked for a running agent applies to its next step', async ($, on) => {
    const seen = engine(on)
    await oneAgent($)
    const ui = await $.ui.mount(pane(90))
    await steer(ui, 'pick:sub-1')
    await ui.press({ key: 'choose:sub-1:sonnet' })
    await step($, { agentId: 'sub-1' })
    expect(seen.stepModels.at(-1)).toBe('sonnet')
    await ui.unmount()
  })

  test('the advisor button runs /advisor', async ($, on) => {
    const seen = engine(on)
    await start($)
    const ui = await $.ui.mount(pane(100))
    await ui.press({ key: 'advisor:toggle' })
    expect(seen.commands).toContainEqual({ command: 'advisor', args: 'opus' })
    await ui.unmount()
  })

  test('the pane draws at a narrow width too', async ($, on) => {
    engine(on)
    await oneAgent($)
    for (const columns of [40, 60, 140]) {
      const ui = await $.ui.mount(pane(columns, 30))
      expect(await screen(ui)).toMatch(/EDU DECK/)
      await ui.unmount()
    }
  })
})
