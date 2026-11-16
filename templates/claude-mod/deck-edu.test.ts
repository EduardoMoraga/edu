import { describe, expect, it } from 'vitest';
import {
  EDU_ACTIVE_MS,
  EDU_IDLE_MS,
  JOBS_KEPT,
  TASK_LIMIT,
  activeJobs,
  ago,
  eduArgs,
  eduDue,
  eduFailed,
  eduFrom,
  eduLoading,
  eduMissing,
  elapsed,
  failureReason,
  isJobRef,
  isSessionRef,
  plainArgv,
  stripParts,
  timedOut,
  totalNotes,
  unknownOption,
  verdictArgs,
} from './deck-edu.ts';
import { WORDS } from './deck-words.ts';

const snapshot = (over: Record<string, unknown> = {}) => JSON.stringify({
  version: 1,
  project: { name: 'edu', root: '/work/edu' },
  identity: 'Albert',
  brain: { present: true, canonical: 11, proposed: 1, toApprove: 1, episodic: 235, transitive: 76, lessons: 48 },
  maintenance: { lastRun: 1000, promoted: 2, retired: 1, overdue: 3 },
  spec: { name: 'deck', requirements: 4, checks: 2 },
  jobs: [
    { id: 'abcd1234', cli: 'codex', task: '  Build\n the   deck ', status: 'awaiting-approval', mode: 'run', startedAt: 1000, endedAt: null, tokens: 12, tokensKnown: true },
    { id: 'beef5678', cli: 'pi', task: 'Verify', status: 'done', mode: 'pane', startedAt: 2000, endedAt: 9000, tokens: 0, tokensKnown: false },
  ],
  approvals: 1,
  recent: [{ title: 'A note', tier: 'transitive', at: 500 }, { title: '', tier: 'episodic', at: 400 }],
  updatedAt: 3000,
  ...over,
});

const words = WORDS.en.edu;

describe('eduFrom', () => {
  it('reads a version 1 snapshot into the deck shape', () => {
    const edu = eduFrom(snapshot(), 5000);
    expect(edu).toMatchObject({
      state: 'ready',
      checkedAt: 5000,
      identity: 'Albert',
      project: { name: 'edu', root: '/work/edu' },
      brain: { canonical: 11, proposed: 1, toApprove: 1, episodic: 235, transitive: 76, lessons: 48 },
      maintenance: { lastRun: 1000, promoted: 2, retired: 1, overdue: 3 },
      spec: { name: 'deck', requirements: 4, checks: 2 },
      approvals: 1,
      sessionKnown: false,
    });
    expect(edu.scope).toBeUndefined();
    expect(eduFrom(snapshot({ scope: 'global' }), 1).scope).toBe('global');
    expect(eduFrom(snapshot({ scope: 'elsewhere' }), 1).scope).toBeUndefined();
    expect(edu.jobs[0]).toEqual({ id: 'abcd1234', cli: 'codex', task: 'Build the deck', status: 'awaiting-approval', mode: 'run', startedAt: 1000, tokens: 12, tokensKnown: true });
    expect(edu.jobs[1]?.endedAt).toBe(9000);
    expect(edu.recent).toEqual([{ title: 'A note', tier: 'transitive', at: 500 }]);
    expect(edu.session).toBeUndefined();
  });

  it('reads the session a newer CLI reports, and knows when it reported none', () => {
    const open = eduFrom(snapshot({ session: { id: '2026-11-15-claude-code-session-x', status: 'open-session', title: 'Claude Code session x' } }), 1);
    expect(open.session).toEqual({ id: '2026-11-15-claude-code-session-x', status: 'open-session', title: 'Claude Code session x' });
    expect(open.sessionKnown).toBe(true);
    const none = eduFrom(snapshot({ session: null }), 1);
    expect(none.session).toBeUndefined();
    expect(none.sessionKnown).toBe(true);
  });

  it('degrades missing, wrong-typed and hostile fields instead of failing', () => {
    const jobs = Array.from({ length: 20 }, (_, i) => ({ id: `job-${i}`, task: `x\u001b[31m${'y'.repeat(400)}`, startedAt: 'soon', tokens: -5 }));
    const edu = eduFrom(JSON.stringify({ version: 1, brain: { present: false }, jobs: [...jobs, null, { cli: 'no id' }], recent: 'nope', maintenance: 7 }), 1);
    expect(edu.state).toBe('ready');
    expect(edu.brain).toBeUndefined();
    expect(edu.maintenance).toBeUndefined();
    expect(edu.jobs).toHaveLength(JOBS_KEPT);
    expect(edu.jobs[0]).toMatchObject({ cli: '?', status: 'queued', mode: 'headless', startedAt: 0, tokens: 0, tokensKnown: false });
    expect(edu.jobs[0]?.task).toHaveLength(TASK_LIMIT);
    expect(edu.jobs[0]?.task).not.toMatch(/\u001b/);
    expect(edu.recent).toEqual([]);
    expect(edu.identity).toBe('Edu');
  });

  it('fails on output that is not a version 1 snapshot', () => {
    expect(eduFrom('Error: no brain', 1)).toMatchObject({ state: 'failed', error: 'the output is not JSON' });
    expect(eduFrom(JSON.stringify({ version: 2 }), 1)).toMatchObject({ state: 'failed', error: 'unknown snapshot version' });
    expect(eduFrom('[]', 1).state).toBe('failed');
  });
});

describe('failures keep what was known', () => {
  it('a failed read keeps the last figures and says why on one line', () => {
    const ready = eduFrom(snapshot(), 1);
    const failed = eduFailed(ready, 'Error: locked\n  at x', 2);
    expect(failed).toMatchObject({ state: 'failed', error: 'Error: locked at x', checkedAt: 2, brain: ready.brain, jobs: ready.jobs });
    expect(eduFailed(ready, '', 3).error).toBe('unknown error');
  });

  it('a missing CLI keeps the reason it was given and clears an older one', () => {
    const missing = eduMissing(eduFailed(eduLoading(), 'old', 1), 2, 'spawn edu ENOENT');
    expect(missing).toMatchObject({ state: 'missing', error: 'spawn edu ENOENT', checkedAt: 2 });
    expect(eduMissing(missing, 3)).not.toHaveProperty('error');
  });
});

describe('refresh policy', () => {
  const idle = eduFrom(snapshot({ jobs: [] }), 0);
  const busy = eduFrom(snapshot(), 0);

  it('reads at once the first time', () => {
    expect(eduDue(undefined, 0, undefined, false)).toBe(true);
  });

  it('reads often while crew jobs are active or the Edu tab is open, rarely otherwise', () => {
    expect(activeJobs(busy)).toBe(1);
    expect(eduDue(busy, EDU_ACTIVE_MS - 1, 0, false)).toBe(false);
    expect(eduDue(busy, EDU_ACTIVE_MS, 0, false)).toBe(true);
    expect(eduDue(idle, EDU_ACTIVE_MS, 0, false)).toBe(false);
    expect(eduDue(idle, EDU_ACTIVE_MS, 0, true)).toBe(true);
    expect(eduDue(idle, EDU_IDLE_MS, 0, false)).toBe(true);
  });

  it('asks for the session only while the CLI knows the flag', () => {
    expect(eduArgs('s1', true)).toEqual(['deck', '--json', '--session', 's1']);
    expect(eduArgs('6f1c2a90-7d4e-4b8a-9c3d-0e5f6a7b8c9d', true)).toEqual(['deck', '--json', '--session', '6f1c2a90-7d4e-4b8a-9c3d-0e5f6a7b8c9d']);
    expect(eduArgs('s1', false)).toEqual(['deck', '--json']);
    expect(eduArgs(undefined, true)).toEqual(['deck', '--json']);
    expect(unknownOption("error: unknown option '--session'")).toBe(true);
    expect(unknownOption('Error: brain locked')).toBe(false);
  });

  it('tells a timeout apart from a command that cannot start', () => {
    expect(timedOut(new Error('process still running after 15000 ms'))).toBe(true);
    expect(timedOut(new Error('Timed out'))).toBe(true);
    expect(timedOut(new Error('spawn edu ENOENT'))).toBe(false);
    expect(timedOut('denied')).toBe(false);
  });

  it('names the first meaningful line of a failed run', () => {
    expect(failureReason({ exitCode: 1, stderr: '\n  Error: locked \n at x', stdout: '' })).toBe('Error: locked');
    expect(failureReason({ exitCode: 3, stderr: '', stdout: '' })).toBe('exit code 3');
  });
});

describe('crew verdicts', () => {
  it('only a job id or prefix ever reaches argv', () => {
    for (const id of ['abcd1234', 'abcd1234-ef56-7890', 'job_1']) expect(isJobRef(id)).toBe(true);
    for (const id of ['abc', '--help', '-x', 'a b', 'a;rm', '', 'x'.repeat(65), '../x']) expect(isJobRef(id)).toBe(false);
    expect(verdictArgs('abcd1234', 'approve')).toEqual(['crew', 'approve', 'abcd1234']);
    expect(verdictArgs('abcd1234', 'reject')).toEqual(['crew', 'reject', 'abcd1234']);
  });
});

describe('arguments that reach edu (and cmd.exe through the npm shim on Windows)', () => {
  it('a host session id must be a plain id', () => {
    for (const id of ['s1', '6f1c2a90-7d4e-4b8a-9c3d-0e5f6a7b8c9d', 'session_2']) expect(isSessionRef(id)).toBe(true);
    for (const id of ['', '-s', '--help', 's1&calc', 's1|x', 's1>x', 's1"x', "s1'x", 's 1', '%TEMP%', 's1^x', 's1!x', 's1\\nx', 'x'.repeat(129)]) {
      expect(isSessionRef(id)).toBe(false);
      expect(eduArgs(id, true)).toEqual(['deck', '--json']);
    }
  });

  it('only plain words, options and --option=value pass the last check', () => {
    expect(plainArgv(['deck', '--json', '--session', 's1'])).toBe(true);
    expect(plainArgv(['crew', 'approve', 'abcd1234', '--request-id=-a_b'])).toBe(true);
    for (const bad of ['a&b', 'a b', '"a"', 'a|b', 'a>b', '%PATH%', 'a^b', '!x!', '--x=a&b', '', '=x', '---x', 'a\\nb']) expect(plainArgv(['deck', bad])).toBe(false);
  });
});

describe('the strip on the tree tab', () => {
  it('says what needs attention, in a stable order', () => {
    const edu = eduFrom(snapshot({ session: { id: 's', status: 'open-session' } }), 0);
    expect(totalNotes(edu.brain)).toBe(323);
    expect(stripParts(edu, words)).toEqual(['brain 323', '1 to approve', '3 overdue', 'crew 1 active', '1 crew run needs approval', 'session open']);
  });

  it('stays quiet about zeros and closed things', () => {
    const edu = eduFrom(snapshot({ jobs: [], approvals: 0, brain: { present: true, canonical: 1, proposed: 0, toApprove: 0, episodic: 0, transitive: 0, lessons: 0 }, maintenance: { overdue: 0 }, session: { id: 's', status: 'closed' } }), 0);
    expect(stripParts(edu, words)).toEqual(['brain 1', 'session closed']);
  });

  it('shows loading, missing and failed states', () => {
    expect(stripParts(undefined, words)).toEqual([]);
    expect(stripParts(eduLoading(), words)).toEqual([words.loading]);
    expect(stripParts(eduMissing(eduLoading(), 1), words)).toEqual([words.missing]);
    expect(stripParts(eduFailed(eduLoading(), 'x', 1), words)).toEqual([words.stripFailed]);
    expect(stripParts(eduFailed(eduFrom(snapshot({ jobs: [] }), 0), 'x', 1), words)[0]).toBe('brain 323');
  });
});

describe('times', () => {
  it('formats ages and runtimes', () => {
    expect(ago(0, 30_000)).toBe('just now');
    expect(ago(0, 5 * 60_000)).toBe('5m ago');
    expect(ago(0, 3 * 3_600_000)).toBe('3h ago');
    expect(ago(0, 2 * 86_400_000)).toBe('2d ago');
    expect(elapsed(0, 42_000)).toBe('42s');
    expect(elapsed(0, 185_000)).toBe('3m05s');
    expect(elapsed(0, 7_800_000)).toBe('2h10m');
    expect(elapsed(10, 0)).toBe('0s');
  });
});
