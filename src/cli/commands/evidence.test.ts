import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeEngine } from '../../engine/fake.js';
import { defaultConfig } from '../../orchestrator/config.js';
import { captureContext, out, runCli } from '../testkit.js';

describe('evidence CLI', () => {
  it('adds, lists, runs, and summarizes deterministic checks', async () => {
    const c = await captureContext();
    await mkdir(join(c.dirs.cwd, '.edu'), { recursive: true });
    await runCli(c, ['checks', 'add', '--id', 'hello', '--req', 'R1', '--cmd', 'printf ready', '--expect-stdout', 'ready', '--timeout', '1000']);
    expect(c.exitCode).toBeUndefined();
    const saved = JSON.parse(await readFile(join(c.dirs.cwd, '.edu/harness/checks.json'), 'utf8'));
    expect(saved).toMatchObject([{ id: 'hello', requirementIds: ['R1'], expect: { exitCode: 0, stdoutIncludes: 'ready' }, timeoutMs: 1000 }]);
    c.stdout.length = 0;
    await runCli(c, ['checks', 'list', '--json']);
    expect(JSON.parse(out(c))).toEqual(saved);
    c.stdout.length = 0;
    await runCli(c, ['checks', 'run', '--json']);
    expect(JSON.parse(out(c))).toMatchObject([{ checkId: 'hello', ok: true, stdout: 'ready' }]);
    c.stdout.length = 0;
    await runCli(c, ['metrics', '--since', '3650d', '--json']);
    expect(JSON.parse(out(c))).toEqual([]);
  });

  it('runs the real H3 CLI path with FakeEngine and reports its episode metrics', async () => {
    const c = await captureContext({ isTTY: false });
    const brainRoot = join(c.dirs.cwd, '.edu');
    const harness = join(brainRoot, 'harness');
    await mkdir(harness, { recursive: true });
    const check = { id: 'deterministic-1', requirementIds: ['R1'], command: 'printf evidence-ok', expect: { exitCode: 0, stdoutIncludes: 'evidence-ok' }, timeoutMs: 1000 };
    await writeFile(join(harness, 'checks.json'), JSON.stringify([check]));
    await writeFile(join(brainRoot, 'config.json'), JSON.stringify({ ...defaultConfig('claude'), approvals: 'auto' }));
    const plan = { requirements: [{ id: 'R1', text: 'produce verifiable evidence' }], checks: [check], steps: [{ id: 'build', role: 'builder', task: 'Implement the requested work', dependsOn: [], parallelSafe: false }] };
    const texts = [JSON.stringify(plan), 'Implementation finished.', '{"verdict":"pass","issues":[]}'];
    let invocation = 0;
    c.ctx.availableClis = ['claude'];
    c.ctx.engineFactory = () => new FakeEngine([{ type: 'agent.text', agentId: `fake-${invocation}`, text: texts[invocation++] ?? 'done', at: new Date().toISOString() }]);

    await runCli(c, ['run', 'verify evidence path', '--harness', 'H3', '--yes']);
    expect(c.exitCode).toBeUndefined();
    const runDirectories = await import('node:fs/promises').then(fs => fs.readdir(join(brainRoot, 'runs'), { withFileTypes: true }));
    const episode = runDirectories.find(entry => entry.isDirectory());
    expect(episode).toBeDefined();
    const episodeRoot = join(brainRoot, 'runs', episode!.name);
    for (const file of ['task.json', 'action.jsonl', 'verification.jsonl', 'outcome.json', 'report.md']) {
      expect(await readFile(join(episodeRoot, file), 'utf8')).toBeTruthy();
    }
    const outcome = JSON.parse(await readFile(join(episodeRoot, 'outcome.json'), 'utf8'));
    expect(outcome.label).toBe('autonomous_verified_success');
    c.stdout.length = 0;
    await runCli(c, ['metrics', '--since', '3650d', '--by', 'level', '--json']);
    expect(JSON.parse(out(c))).toEqual([expect.objectContaining({ group: 'H3', n: 1, avsr: 1 })]);
  });
});
