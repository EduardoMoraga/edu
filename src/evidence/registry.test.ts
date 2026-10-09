import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkSpawnOptions, loadChecks, saveChecks, runCheck } from './registry.js';

const roots: string[] = [];
async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'edu-evidence-registry-'));
  roots.push(root);
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('evidence registry', () => {
  it('uses the platform shell without creating Windows process groups', () => {
    expect(checkSpawnOptions('win32')).toEqual({ shell: true, detached: false });
    expect(checkSpawnOptions('darwin')).toEqual({ shell: true, detached: true });
  });
  it('round-trips validated checks in .edu/harness/checks.json', async () => {
    const root = await tempRoot();
    const checks = [{ id: 'unit', requirementIds: ['req-1'], command: 'printf green', expect: { exitCode: 0, stdoutIncludes: 'green' }, timeoutMs: 1000 }];
    await saveChecks(root, checks);
    expect(JSON.parse(await readFile(join(root, '.edu/harness/checks.json'), 'utf8'))).toEqual(checks);
    expect(await loadChecks(root)).toEqual(checks);
    await expect(readdir(join(root, '.edu/harness'))).resolves.toEqual(['checks.json']);
  });

  it('records passing and failing command results', async () => {
    const pass = await runCheck({ id: 'pass', requirementIds: [], command: 'printf green', expect: { stdoutIncludes: 'green' }, timeoutMs: 1000 }, process.cwd());
    const fail = await runCheck({ id: 'fail', requirementIds: [], command: 'printf red', expect: { stdoutIncludes: 'green' }, timeoutMs: 1000 }, process.cwd());
    expect(pass).toMatchObject({ checkId: 'pass', ok: true, exitCode: 0, timedOut: false });
    expect(fail).toMatchObject({ checkId: 'fail', ok: false, exitCode: 0, timedOut: false });
    expect(fail.output).toContain('red');
  });

  it('matches stdoutIncludes against stdout rather than stderr', async () => {
    const result = await runCheck({ id: 'stderr', requirementIds: [], command: "printf green >&2", expect: { stdoutIncludes: 'green' }, timeoutMs: 1000 }, process.cwd());
    expect(result.ok).toBe(false);
    expect(result.output).toContain('green');
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('green');
  });

  it('marks a timed-out command', async () => {
    const result = await runCheck({ id: 'slow', requirementIds: [], command: 'sleep 1', expect: {}, timeoutMs: 20 }, process.cwd());
    expect(result).toMatchObject({ checkId: 'slow', ok: false, timedOut: true });
  });

  it('stops a running command when its signal is aborted', async () => {
    const controller = new AbortController();
    const running = runCheck({ id: 'cancel', requirementIds: [], command: 'sleep 1', expect: {}, timeoutMs: 2000 }, process.cwd(), controller.signal);
    setTimeout(() => controller.abort(), 20);
    const result = await running;
    expect(result).toMatchObject({ checkId: 'cancel', ok: false, timedOut: false });
  });
});
