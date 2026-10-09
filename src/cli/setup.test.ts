import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { captureContext, out, runCli } from './testkit.js';

const missing = (path: string) => access(path).then(() => false, () => true);

describe('edu init', () => {
  it('creates a project brain with config, contract, roles and skills', async () => {
    const c = await captureContext({ detected: ['codex', 'claude'] });
    await runCli(c, ['init', '--name', 'Ada']);
    expect(c.exitCode).toBeUndefined();
    const root = join(c.dirs.cwd, '.edu');
    const contract = await readFile(join(root, 'EDU.md'), 'utf8');
    expect(contract.split('\n')[0]).toBe('# Ada — the contract');
    expect(contract).not.toContain('{{name}}');
    const config = JSON.parse(await readFile(join(root, 'config.json'), 'utf8'));
    expect(config).toMatchObject({ version: 1, mode: 'solo', defaultCli: 'codex', lang: 'en' });
    expect((await readdir(join(root, 'agents'))).sort()).toEqual(['builder.md', 'explorer.md', 'lead.md', 'reviewer.md']);
    expect((await readdir(join(root, 'skills'))).sort()).toEqual(['edu-brain', 'edu-reflect']);
    for (const dir of ['brain/1-canonical', 'brain/2-episodic', 'brain/3-transitive', 'runs', 'proposals']) {
      expect(await missing(join(root, dir))).toBe(false);
    }
    expect(out(c)).toContain('edu install --cli codex');
  });

  it('is idempotent and keeps an existing config', async () => {
    const c = await captureContext({ detected: ['pi'] });
    await runCli(c, ['init', '--cli', 'claude']);
    await runCli(c, ['init', '--cli', 'opencode']);
    const config = JSON.parse(await readFile(join(c.dirs.cwd, '.edu', 'config.json'), 'utf8'));
    expect(config.defaultCli).toBe('claude');
    expect(out(c)).toContain('config.json kept');
  });

  it('honors EDU_HOME with --global', async () => {
    const c = await captureContext();
    await runCli(c, ['init', '--global']);
    expect(await missing(join(c.dirs.eduHome, 'EDU.md'))).toBe(false);
    expect(await missing(join(c.dirs.cwd, '.edu'))).toBe(true);
  });

  it('rejects an unknown default CLI', async () => {
    const c = await captureContext();
    await runCli(c, ['init', '--cli', 'gpt']);
    expect(c.exitCode).toBe(1);
    expect(c.stderr.join('\n')).toContain('Unknown CLI "gpt"');
  });
});

describe('edu install', () => {
  it('prints the plan on --dry-run and writes nothing', async () => {
    const c = await captureContext();
    await runCli(c, ['install', '--cli', 'claude', '--dry-run']);
    expect(c.exitCode).toBeUndefined();
    const text = out(c);
    expect(text).toMatch(/Edu project installation: \d+ file actions/);
    expect(text).toContain('claude:');
    expect(text).toContain('Dry run: nothing was written.');
    expect(await missing(join(c.dirs.cwd, '.edu', 'manifest.json'))).toBe(true);
    expect(await missing(join(c.dirs.cwd, 'CLAUDE.md'))).toBe(true);
  });

  it('emits a JSON plan with --dry-run --json', async () => {
    const c = await captureContext();
    await runCli(c, ['install', '--cli', 'codex,pi', '--dry-run', '--json']);
    const plan = JSON.parse(out(c));
    expect(plan.scope).toBe('project');
    expect(plan.actions.length).toBeGreaterThan(0);
    expect(plan.actions.every((a: { path: string }) => a.path.startsWith('/'))).toBe(true);
    expect(new Set(plan.actions.flatMap((a: { clis: string[] }) => a.clis))).toEqual(new Set(['codex', 'pi']));
  });

  it('needs --yes when it cannot ask', async () => {
    const c = await captureContext();
    await runCli(c, ['install', '--cli', 'claude']);
    expect(c.exitCode).toBe(1);
    expect(c.stderr.join('\n')).toContain('--yes');
    expect(await missing(join(c.dirs.cwd, 'CLAUDE.md'))).toBe(true);
  });

  it('asks for --cli when nothing is detected', async () => {
    const c = await captureContext({ detected: [] });
    await runCli(c, ['install', '--dry-run']);
    expect(c.exitCode).toBe(1);
    expect(c.stderr.join('\n')).toContain('--cli all');
  });

  it('installs and uninstalls round-trip with --yes', async () => {
    const c = await captureContext();
    await runCli(c, ['install', '--cli', 'claude', '--yes']);
    expect(c.exitCode).toBeUndefined();
    expect(await readFile(join(c.dirs.cwd, 'CLAUDE.md'), 'utf8')).toContain('edu:core');
    await runCli(c, ['uninstall']);
    expect(c.exitCode).toBeUndefined();
    expect(await missing(join(c.dirs.cwd, 'CLAUDE.md'))).toBe(true);
  });
});
