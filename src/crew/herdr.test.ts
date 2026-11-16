import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dispatchPane, paneAnswer, refreshPane, type HerdrRunner, type HerdrTarget } from './herdr.js';
import { createCrewStore, isCrewWorker } from './store.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

// Screens as `herdr agent read --source recent-unwrapped` returns them once the turn is over.
const CODEX_TASK = 'Sync the notes folder with the remote and report what changed. Keep the report under five lines.';

const codexAnswered = `user@mac notes % codex --no-daemon --sandbox workspace-write --ask-for-approval on-request
╭──────────────────────────────────────────────╮
│ >_ OpenAI Codex (v0.63.0)                    │
│                                              │
│ model:     gpt-5.1-codex   /model to change  │
│ directory: ~/notes                           │
╰──────────────────────────────────────────────╯

  To get started, describe a task or try one of these commands:

  /init - create an AGENTS.md file with instructions for Codex
  /status - show current session configuration

› Sync the notes folder with the remote and report what changed. Keep the
  report under five lines.

• I'll pull the remote changes and summarize them.

• Ran git -C notes pull --ff-only
  └ Updating 3f2a1c4..9b7e2d0
    Fast-forward
     inbox.md | 4 ++++

─ Worked for 9s ──────────────────────────────────────────────

• Synced notes: one new commit (9b7e2d0) added four lines to inbox.md. No
  conflicts and nothing left to push.

› Find and fix a bug in @filename

  100% context left · ? for shortcuts
`;

// Codex on the alternate screen: the answer scrolled off rows that never reach herdr's scrollback.
const codexAltScreen = `user@mac notes % codex --no-daemon --sandbox workspace-write --ask-for-approval on-request

› Sync the notes folder with the remote and report what changed. Keep the
  report under five lines.

› Find and fix a bug in @filename

  98% context left · ? for shortcuts
`;

const claudeAnswered = `╭───────────────────────────────────────────────────╮
│ ✻ Welcome to Claude Code!                         │
│                                                   │
│   /help for help, /status for your current setup  │
│                                                   │
│   cwd: /Users/me/project                          │
╰───────────────────────────────────────────────────╯

> List the TODO comments in src with their file paths.

⏺ Search(pattern: "TODO", path: "src")
  ⎿  Found 2 files

⏺ Two TODO comments in src:
  - src/a.ts:12 — handle the empty response
  - src/b.ts:4 — remove the debug flag

╭───────────────────────────────────────────────────╮
│ >                                                 │
╰───────────────────────────────────────────────────╯
  ⏵⏵ accept edits on (shift+tab to cycle)
`;

// A multi-line task arrives as a bracketed paste; Claude Code echoes a placeholder instead of the text.
const claudePasted = `╭───────────────────────────────────────────────────╮
│ ✻ Welcome to Claude Code!                         │
╰───────────────────────────────────────────────────╯

> [Pasted text #1 +6 lines]

⏺ Done: the changelog now lists the three fixes under 6.0.

╭───────────────────────────────────────────────────╮
│ >                                                 │
╰───────────────────────────────────────────────────╯
  ? for shortcuts
`;

describe('paneAnswer', () => {
  it('returns what Codex wrote after the echoed prompt, without the banner or the composer', () => {
    const answer = paneAnswer(codexAnswered, CODEX_TASK);
    expect(answer).toMatch(/^• I'll pull the remote changes/);
    expect(answer).toContain('• Synced notes: one new commit (9b7e2d0)');
    expect(answer).toMatch(/nothing left to push\.$/);
    expect(answer).not.toContain('Sync the notes folder');
    expect(answer).not.toContain('OpenAI Codex');
    expect(answer).not.toContain('Find and fix a bug');
  });

  it('returns nothing when the screen holds only the prompt (alternate screen)', () => {
    expect(paneAnswer(codexAltScreen, CODEX_TASK)).toBeUndefined();
  });

  it('returns what Claude Code wrote after the prompt, without its input box', () => {
    const answer = paneAnswer(claudeAnswered, 'List the TODO comments in src with their file paths.');
    expect(answer).toBe([
      '⏺ Search(pattern: "TODO", path: "src")',
      '  ⎿  Found 2 files',
      '',
      '⏺ Two TODO comments in src:',
      '  - src/a.ts:12 — handle the empty response',
      '  - src/b.ts:4 — remove the debug flag',
    ].join('\n'));
  });

  it('finds the prompt when the CLI echoed a pasted-text placeholder instead', () => {
    expect(paneAnswer(claudePasted, 'Update the changelog.\nList the three fixes.\nUnder 6.0.')).toBe('⏺ Done: the changelog now lists the three fixes under 6.0.');
  });

  it('keeps a plain answer when the prompt is no longer on screen', () => {
    expect(paneAnswer('READY', 'Say READY')).toBe('READY');
  });
});

describe('pane job summary', () => {
  async function paneJob(task: string, screen: () => string, baseline: string) {
    const root = await mkdtemp(join(tmpdir(), 'edu-herdr-'));
    roots.push(root);
    const store = createCrewStore(root);
    const job = await store.create({ cli: 'codex', task, mode: 'pane', cwd: root, autonomy: 'ask' });
    let status = 'idle';
    let pane = baseline;
    const runner: HerdrRunner = async args => {
      if (args[0] === 'pane' && args[1] === 'split') return { stdout: JSON.stringify({ result: { pane: { pane_id: 'p1' } } }), stderr: '' };
      if (args[0] === 'agent' && args[1] === 'get') return { stdout: JSON.stringify({ result: { agent: { agent_status: status } } }), stderr: '' };
      if (args[1] === 'read') return { stdout: pane, stderr: '' };
      return { stdout: '{}', stderr: '' };
    };
    const options = { env: { HERDR_ENV: '1' }, hasBinary: async () => true, runner, store };
    let current = await dispatchPane(job, options);
    status = 'working';
    current = await refreshPane(current, options);
    status = 'done';
    pane = screen();
    return refreshPane(current, options);
  }

  it('summarizes a finished Codex job with its answer, not its own task text', async () => {
    const done = await paneJob(CODEX_TASK, () => codexAnswered, 'user@mac notes % codex --no-daemon');
    expect(done.status).toBe('done');
    expect(done.summary).toContain('Synced notes: one new commit');
    expect(done.summary).not.toContain(CODEX_TASK.slice(0, 40));
  });

  it('says so when the answer is not readable instead of returning the prompt', async () => {
    const done = await paneJob(CODEX_TASK, () => codexAltScreen, 'user@mac notes % codex --no-daemon');
    expect(done.status).toBe('done');
    expect(done.summary).toContain('could not be read from herdr pane p1');
    expect(done.summary).toContain('alternate screen');
    expect(done.summary).not.toContain('Sync the notes folder');
  });

  it('says so when the pane did not change after the prompt was delivered', async () => {
    const screen = 'user@mac notes % codex --no-daemon\nWelcome to the session';
    const done = await paneJob('Say READY', () => screen, screen);
    expect(done.status).toBe('done');
    expect(done.summary).toContain('could not be read from herdr pane p1');
  });
});

describe('pane agents run as crew workers', () => {
  /** The variables herdr sets for the pane's shell, which the agent CLI started in that shell (and its Edu MCP server) inherit. */
  const paneEnv = (args: readonly string[]): NodeJS.ProcessEnv => Object.fromEntries(args.flatMap((arg, index) => {
    if (args[index - 1] !== '--env') return [];
    const at = arg.indexOf('=');
    return [[arg.slice(0, at), arg.slice(at + 1)]];
  }));

  it.each([
    ['a split beside the caller, inside herdr', { kind: 'inside' }, ['pane', 'split']],
    ['a tab in the Edu workspace', { kind: 'outside', workspaceId: 'w1' }, ['tab', 'create']],
    ['a new Edu workspace', { kind: 'outside' }, ['workspace', 'create']],
  ] satisfies Array<[string, HerdrTarget, [string, string]]>)('marks %s with the job id, as a headless worker is marked', async (_where, target, [command, sub]) => {
    const root = await mkdtemp(join(tmpdir(), 'edu-herdr-'));
    roots.push(root);
    const store = createCrewStore(root);
    const job = await store.create({ cli: 'claude', task: 'Approve the open gate', mode: 'pane', cwd: root, autonomy: 'ask' });
    const calls: string[][] = [];
    const runner: HerdrRunner = async args => {
      calls.push(args);
      if (args[0] === command && args[1] === sub) return { stdout: JSON.stringify({ result: { pane: { pane_id: 'p1' }, root_pane: { pane_id: 'p1' } } }), stderr: '' };
      return { stdout: '{}', stderr: '' };
    };
    const started = await dispatchPane(job, { target, runner, store });
    expect(started).toMatchObject({ status: 'running', paneId: 'p1' });
    const opened = calls.find(args => args[0] === command && args[1] === sub)!;
    // Exactly the marker headless workers get (engine/process.ts): the job's own id, nothing else added.
    expect(paneEnv(opened)).toEqual({ EDU_CREW_JOB: job.id });
    expect(isCrewWorker(paneEnv(opened))).toBe(true);
  });
});
