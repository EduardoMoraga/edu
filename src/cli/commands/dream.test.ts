import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openBrain } from '../../brain/index.js';
import { captureContext, out, runCli, type Captured } from '../testkit.js';

async function initialized(): Promise<Captured> {
  const c = await captureContext({ detected: [] });
  await runCli(c, ['init']);
  c.stdout.length = 0;
  return c;
}
const reset = (c: Captured) => { c.stdout.length = 0; c.stderr.length = 0; c.exitCode = undefined; };

describe('edu brain lint', () => {
  it('reports grouped findings, JSON, and fails only with --strict on errors', async () => {
    const c = await initialized();
    const brain = openBrain([{ scope: 'project', root: join(c.dirs.cwd, '.edu') }]);
    await runCli(c, ['brain', 'lint']);
    expect(out(c)).toContain('No findings in 0 notes.');
    reset(c);

    await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Points nowhere', body: 'See [[never-written]].' });
    await brain.write({ tier: 'transitive', kind: 'commitment', title: 'Send the report', body: 'Due long ago.', due: '2020-01-01', links: ['L-points-nowhere'] });
    await runCli(c, ['brain', 'lint']);
    expect(c.exitCode).toBeUndefined();
    const text = out(c);
    expect(text).toContain('missing-page (1)');
    expect(text).toContain('overdue (1)');
    expect(text).toMatch(/2 finding\(s\) in 2 notes: 1 error · 1 warning/);
    reset(c);

    await runCli(c, ['brain', 'lint', '--json', '--strict']);
    expect(c.exitCode).toBe(1);
    const report = JSON.parse(out(c));
    expect(report.summary).toMatchObject({ 'missing-page': 1, overdue: 1, error: 1, total: 2 });
    reset(c);
    await runCli(c, ['brain', 'lint', '--stale-days', 'soon']);
    expect(c.stderr.join('\n')).toContain('--stale-days');
  });
});

describe('edu dream', () => {
  it('plans, saves a reviewable plan, and applies only what stays checked', async () => {
    const c = await initialized();
    await runCli(c, ['dream', '--apply']);
    expect(c.exitCode).toBe(1);
    expect(c.stderr.join('\n')).toContain('run: edu dream');
    reset(c);

    const brain = openBrain([{ scope: 'project', root: join(c.dirs.cwd, '.edu') }]);
    for (const [title, source] of [['One', 'claude'], ['Two', 'pi'], ['Three', 'codex']] as const) {
      const s = await brain.openSession(title, source);
      await brain.closeSession(s.meta.id, `The flaky snapshot tests broke the ${title} build.`);
    }
    await runCli(c, ['dream']);
    const text = out(c);
    expect(text).toContain('Dream over 3 session(s) from the last 14 days');
    expect(text).toMatch(/\[x\] P-[a-f0-9]{8} new-lesson\s+Recurring: flaky snapshot tests broke \(prevalence 3\)/);
    const path = join(c.dirs.cwd, '.edu', 'state', 'dream-plan.md');
    expect(text).toContain(path);
    reset(c);

    // Untick everything: applying changes nothing.
    await writeFile(path, (await readFile(path, 'utf8')).replace(/- \[x\]/g, '- [ ]'));
    await runCli(c, ['dream', '--apply', '--json']);
    expect(JSON.parse(out(c))).toMatchObject({ applied: [], unchecked: 1 });
    expect(await brain.list({ kind: 'lesson' })).toEqual([]);
    reset(c);

    await runCli(c, ['dream', '--json']);
    expect(JSON.parse(out(c)).proposals[0].checked).toBe(true);
    reset(c);
    await runCli(c, ['dream', '--apply']);
    expect(out(c)).toContain('Dream applied: 1 proposal(s)');
    expect((await brain.list({ kind: 'lesson' }))[0]?.meta).toMatchObject({ source: 'edu:dream', band: 'inferred', status: 'candidate' });
    reset(c);

    await runCli(c, ['dream', '--model']);
    expect(c.exitCode).toBe(1);
    expect(c.stderr.join('\n')).toContain('--model needs an installed agent CLI');
  });

  it('needs a brain', async () => {
    const c = await captureContext();
    await runCli(c, ['dream']);
    expect(c.exitCode).toBe(1);
    expect(c.stderr.join('\n')).toContain('edu init');
  });

  it.each([['dream'], ['brain', 'lint']])('parses `edu %s --help`', async (...path) => {
    const c = await captureContext();
    const exit = await runCli(c, [...path, '--help']);
    expect(exit?.code).toBe('commander.helpDisplayed');
    expect(out(c)).toContain(`edu ${path.join(' ')}`);
  });
});
