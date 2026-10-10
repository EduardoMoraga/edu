import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { captureContext, out, runCli } from './testkit.js';
import { registerProject } from '../vault/registry.js';

describe('edu vault command', () => {
  it('creates a vault from registered projects and returns JSON', async () => {
    const c = await captureContext();
    await runCli(c, ['init']);
    c.stdout.length = 0;
    await runCli(c, ['vault', '--no-register', '--json']);
    const report = JSON.parse(out(c));
    expect(report.path).toBe(join(c.dirs.home, 'EduVault'));
    expect(report.linked).toEqual(['project', '_global']);
    expect((await readdir(join(report.path, 'Edu'))).sort()).toEqual(['_global', 'project']);
    expect(await readFile(join(report.path, 'Home.md'), 'utf8')).toContain('[[Edu/project/0-index/INDEX]]');
  });

  it('checks the vault without mutating it', async () => {
    const c = await captureContext();
    await runCli(c, ['init']);
    await runCli(c, ['vault', '--no-register']);
    c.stdout.length = 0;
    await runCli(c, ['vault', '--check', '--json']);
    const report = JSON.parse(out(c));
    expect(report.unsafe).toBeUndefined();
    expect(report.links.map((link: { state: string }) => link.state)).toEqual(['ok', 'ok']);
    expect(c.exitCode).toBeUndefined();
    c.stdout.length = 0;
    await runCli(c, ['doctor', '--json']);
    expect(JSON.parse(out(c)).vault.state).toBe('ok');
  });

  it('doctor reports a missing registered project without pruning it', async () => {
    const c = await captureContext();
    await runCli(c, ['init']);
    const missing = join(c.dirs.home, 'missing-project');
    await mkdir(join(missing, '.edu', 'brain'), { recursive: true });
    await registerProject(c.dirs.eduHome, missing);
    await rm(missing, { recursive: true });
    c.stdout.length = 0;
    await runCli(c, ['doctor', '--json']);
    const report = JSON.parse(out(c));
    expect(report.projects).toHaveLength(2);
    expect(report.lines.some((line: { text: string }) => line.text.includes('Missing registered project: missing-project'))).toBe(true);
    expect(JSON.parse(await readFile(join(c.dirs.eduHome, 'projects.json'), 'utf8')).projects).toHaveLength(2);
  });
});
