import { cp, mkdtemp, mkdir, readFile, realpath, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { applySetup, planSetup, type SetupRunner } from './index.js';
import type { Runner } from '../update/update.js';
import { migrateWorkspaces } from '../update/migrate.js';
import { registerProject } from '../vault/registry.js';
import { packageTemplatesDir } from '../cli/package.js';
import { captureContext, runCli } from '../cli/testkit.js';
const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
async function fixture() {
  const home = await realpath(await mkdtemp(join(tmpdir(), '09-setup-old-'))); dirs.push(home);
  const brainRoot = join(home, '.edu'); await mkdir(brainRoot);
  const old = await readFile(new URL('../update/fixtures/EDU-0.10.2.md', import.meta.url), 'utf8');
  await writeFile(join(brainRoot, 'EDU.md'), old.replaceAll('{{name}}', 'Private Identity') + '\nCUSTOM RULE\n');
  await writeFile(join(brainRoot, 'plugin-setup.json'), JSON.stringify({ version: 1, packageRoot: '/old/0.10.2', native: [], fallback: ['claude'] }));
  await mkdir(join(home, '.claude/skills/my-skill'), { recursive: true });
  await writeFile(join(home, '.claude/skills/my-skill/SKILL.md'), 'CUSTOM SKILL');
  await writeFile(join(home, '.claude/CLAUDE.md'), 'CUSTOM BEFORE\n<!-- edu:core:start -->\nOLD PROTOCOL\n<!-- edu:core:end -->\nCUSTOM AFTER\n');
  return { home, brainRoot };
}
async function installedPackage(home: string) {
  // Native upgrades localize owned package files on Windows; never use the development checkout.
  const packageRoot = join(home, 'node_modules/edu-agent');
  await mkdir(packageRoot, { recursive: true });
  for (const path of ['plugins', 'templates', 'package.json']) {
    await cp(join(process.cwd(), path), join(packageRoot, path), { recursive: true });
  }
  return realpath(packageRoot);
}
it('new setup invoked by old updater backs up before refresh, preserves custom files, and repeated migrate is unchanged', async () => {
  const { home, brainRoot } = await fixture();
  const calls: string[] = [];
  const runner: SetupRunner = async c => { calls.push(c.args.join(' ')); return { exitCode: 0, stdout: '' }; };
  const plan = await planSetup({ home, packageRoot: process.cwd(), clis: ['claude'], runner });
  calls.length = 0;
  // 0.10.2 order: new setup first, new migrate second. No model CLI is actually run.
  const order: string[] = [];
  const oldUpdaterRunner: Runner = async (_command, args) => {
    expect(args[0]).toBe('/installed-new/edu/dist/cli.js');
    if (args[1] === 'setup') {
      order.push('setup');
      await applySetup(plan, { runner, brainRoot, platform: 'linux', templatesDir: packageTemplatesDir() });
      return { code: 0, stdout: '', stderr: '' };
    }
    expect(args.slice(1)).toEqual(['internal', 'migrate-workspaces', '--json']);
    order.push('migrate');
    const report = await migrateWorkspaces(brainRoot);
    return { code: report.every(r => r.status === 'migrated') ? 0 : 1, stdout: JSON.stringify(report), stderr: '' };
  };
  await oldUpdaterRunner('node', ['/installed-new/edu/dist/cli.js', 'setup', '--yes']);
  expect(calls).toEqual([]); // fallback refresh must not install native plugins
  const instructions = await readFile(join(home, '.claude/CLAUDE.md'), 'utf8');
  expect(instructions).toContain('CUSTOM BEFORE'); expect(instructions).toContain('CUSTOM AFTER');
  expect(instructions).not.toContain('OLD PROTOCOL'); expect(instructions).toContain('edu_capabilities');
  expect(await readFile(join(home, '.claude/skills/my-skill/SKILL.md'), 'utf8')).toBe('CUSTOM SKILL');
  const contract = await readFile(join(brainRoot, 'EDU.md'), 'utf8'); expect(contract).toContain('CUSTOM RULE');
  const stamp = await readFile(join(brainRoot, 'state/upgrade.json'), 'utf8');
  const backups = await readdir(join(brainRoot, 'backups'));
  expect((await oldUpdaterRunner('node', ['/installed-new/edu/dist/cli.js', 'internal', 'migrate-workspaces', '--json'])).code).toBe(0);
  expect(order).toEqual(['setup', 'migrate']);
  expect(await readFile(join(brainRoot, 'state/upgrade.json'), 'utf8')).toBe(stamp);
  await applySetup(plan, { runner, brainRoot, platform: 'linux', templatesDir: packageTemplatesDir() });
  expect(await readFile(join(home, '.claude/CLAUDE.md'), 'utf8')).toBe(instructions);
  expect(await readdir(join(brainRoot, 'backups'))).toEqual(backups);
});
it('a broken registered project stops setup before any native mutation', async () => {
  const { home, brainRoot } = await fixture(); const project = join(home, 'broken'); await mkdir(project);
  await registerProject(brainRoot, project);
  const calls: string[] = []; const runner: SetupRunner = async c => { calls.push(c.args.join(' ')); return { exitCode: 0 }; };
  const plan = await planSetup({ home, packageRoot: process.cwd(), clis: ['claude'], runner }); calls.length = 0;
  await expect(applySetup(plan, { runner, brainRoot, platform: 'linux' })).rejects.toThrow(/migration|upgrade/i);
  expect(calls).toEqual([]);
  expect(await readFile(join(home, '.claude/CLAUDE.md'), 'utf8')).toContain('OLD PROTOCOL');
});
it('actual setup registration reports a migration error with exit 1, with no detected CLIs', async () => {
  const c = await captureContext();
  const root = c.ctx.env.EDU_HOME!; await mkdir(root, { recursive: true });
  await writeFile(join(root, 'EDU.md'), '# Old identity');
  await writeFile(join(root, 'config.json'), '{bad');
  await runCli(c, ['setup', '--yes']);
  expect(c.exitCode).toBe(1);
  expect(c.stderr.join(' ')).toMatch(/migration|upgrade/i);
});
it('fresh setup with no CLIs and no registered global brain still initializes normally', async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), '09-setup-fresh-'))); dirs.push(home);
  const runner: SetupRunner = async () => { throw new Error('No native command expected'); };
  const plan = await planSetup({ home, packageRoot: process.cwd(), clis: [], runner });
  await applySetup(plan, { runner, brainRoot: join(home, '.edu'), platform: 'linux', templatesDir: packageTemplatesDir() });
  expect(await readFile(join(home, '.edu/EDU.md'), 'utf8')).toContain('contract');
});
it('refreshes existing project blocks under their project manifest and leaves project custom content intact', async () => {
  const { home, brainRoot } = await fixture(); const project = join(home, 'project'); const root = join(project, '.edu');
  await mkdir(root, { recursive: true }); await writeFile(join(root, 'EDU.md'), '# Project identity');
  await registerProject(brainRoot, project);
  await writeFile(join(project, 'CLAUDE.md'), 'PROJECT CUSTOM\n<!-- edu:core:start -->\nOLD\n<!-- edu:core:end -->\n');
  const runner: SetupRunner = async () => ({ exitCode: 0 });
  const plan = await planSetup({ home, packageRoot: process.cwd(), clis: ['claude'], runner });
  await applySetup(plan, { runner, brainRoot, platform: 'linux', templatesDir: packageTemplatesDir() });
  expect(await readFile(join(project, 'CLAUDE.md'), 'utf8')).toContain('PROJECT CUSTOM');
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  expect(manifest.scope).toBe('project');
  expect(manifest.actions.every((a: { kind: string }) => a.kind === 'managed-block')).toBe(true);
  const global = JSON.parse(await readFile(join(brainRoot, 'manifest.json'), 'utf8'));
  expect(global.actions.some((a: { path: string }) => a.path === join(project, 'CLAUDE.md'))).toBe(false);
});
it('aborts the host refresh if the versioned backup cannot be written', async () => {
  const { home, brainRoot } = await fixture();
  await writeFile(join(brainRoot, 'backups'), 'blocked');
  const runner: SetupRunner = async () => ({ exitCode: 0 });
  const plan = await planSetup({ home, packageRoot: process.cwd(), clis: ['claude'], runner });
  await expect(applySetup(plan, { runner, brainRoot, platform: 'linux' })).rejects.toThrow(/migration/i);
  expect(await readFile(join(home, '.claude/CLAUDE.md'), 'utf8')).toContain('OLD PROTOCOL');
});

it.each(['claude', 'codex'] as const)('preserves custom EDU_HOME pointer for %s and adds no host integration to custom-only project rules', async cli => {
  const home = await realpath(await mkdtemp(join(tmpdir(), '09-setup-p1-'))); dirs.push(home);
  const brainRoot = join(home, 'private-brain');
  await mkdir(brainRoot); await mkdir(join(home, '.edu'));
  await writeFile(join(brainRoot, 'EDU.md'), '# Private identity');
  await writeFile(join(home, '.edu/plugin-setup.json'), JSON.stringify({ version: 1, packageRoot: '/old/0.10.2', native: [], fallback: [cli] }));
  const global = join(home, cli === 'claude' ? '.claude/CLAUDE.md' : '.codex/AGENTS.md');
  await mkdir(join(home, cli === 'claude' ? '.claude' : '.codex'));
  await writeFile(global, `CUSTOM GLOBAL\n<!-- edu:core:start -->\n@${join(brainRoot, 'EDU.md')}\nOLD\n<!-- edu:core:end -->\n`);
  const project = join(home, 'registered'); await mkdir(join(project, '.edu'), { recursive: true });
  await writeFile(join(project, '.edu/EDU.md'), '# Project identity');
  const rules = join(project, cli === 'claude' ? 'CLAUDE.md' : 'AGENTS.md');
  const custom = 'CUSTOM PROJECT RULES ONLY\n'; await writeFile(rules, custom);
  await registerProject(brainRoot, project);
  const runner: SetupRunner = async () => ({ exitCode: 0 });
  const plan = await planSetup({ home, packageRoot: process.cwd(), clis: [cli], runner });
  await applySetup(plan, { runner, brainRoot, platform: 'linux', templatesDir: packageTemplatesDir() });
  const refreshed = await readFile(global, 'utf8');
  expect(refreshed).toContain(`@${join(brainRoot, 'EDU.md')}`);
  expect(refreshed).not.toContain(`@${join(home, '.edu/EDU.md')}`);
  await expect(readFile(join(home, '.edu/EDU.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(refreshed).toContain('CUSTOM GLOBAL'); expect(refreshed).toContain('edu_capabilities');
  expect(await readFile(rules, 'utf8')).toBe(custom);
  await expect(readFile(join(project, '.edu/manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  await applySetup(plan, { runner, brainRoot, platform: 'linux', templatesDir: packageTemplatesDir() });
  expect(await readFile(rules, 'utf8')).toBe(custom);
  expect(await readFile(global, 'utf8')).toBe(refreshed);
});

it.each(['claude', 'codex'] as const)('does not add an Edu block to unowned global custom instructions for %s', async cli => {
  const { home, brainRoot } = await fixture();
  await writeFile(join(brainRoot, 'plugin-setup.json'), JSON.stringify({ version: 1, packageRoot: '/old', native: [], fallback: [cli] }));
  const dir = join(home, cli === 'claude' ? '.claude' : '.codex'); await mkdir(dir, { recursive: true });
  const path = join(dir, cli === 'claude' ? 'CLAUDE.md' : 'AGENTS.md');
  await writeFile(path, 'ONLY MY RULES\n');
  await migrateWorkspaces(brainRoot);
  const before = await stat(path);
  const backups = await readdir(join(brainRoot, 'backups'));
  const runner: SetupRunner = async () => ({ exitCode: 0 });
  const plan = await planSetup({ home, packageRoot: process.cwd(), clis: [cli], runner });
  await applySetup(plan, { runner, brainRoot, platform: 'linux', templatesDir: packageTemplatesDir() });
  expect(await readFile(path, 'utf8')).toBe('ONLY MY RULES\n');
  expect((await stat(path)).mtimeMs).toBe(before.mtimeMs);
  expect(await readdir(join(brainRoot, 'backups'))).toEqual(backups);
  await expect(readFile(join(brainRoot, 'manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it.each(['claude', 'codex'] as const)('registration of a brain is not consent to add %s to custom-only project instructions', async cli => {
  const { home, brainRoot } = await fixture();
  await writeFile(join(brainRoot, 'plugin-setup.json'), JSON.stringify({ version: 1, packageRoot: '/old', native: [], fallback: [cli] }));
  const project = join(home, 'custom-project'); await mkdir(join(project, '.edu'), { recursive: true });
  await writeFile(join(project, '.edu/EDU.md'), '# Project'); await registerProject(brainRoot, project);
  const path = join(project, cli === 'claude' ? 'CLAUDE.md' : 'AGENTS.md'); await writeFile(path, 'CUSTOM ONLY\n');
  await migrateWorkspaces(brainRoot);
  const projectFiles = await readdir(join(project, '.edu'));
  const before = await stat(path);
  const stamp = await readFile(join(project, '.edu/state/upgrade.json'), 'utf8');
  const runner: SetupRunner = async () => ({ exitCode: 0 });
  const plan = await planSetup({ home, packageRoot: process.cwd(), clis: [cli], runner });
  await applySetup(plan, { runner, brainRoot, platform: 'linux' });
  expect(await readFile(path, 'utf8')).toBe('CUSTOM ONLY\n');
  expect((await stat(path)).mtimeMs).toBe(before.mtimeMs);
  expect(await readdir(join(project, '.edu'))).toEqual(projectFiles);
  expect(await readFile(join(project, '.edu/state/upgrade.json'), 'utf8')).toBe(stamp);
  await expect(readFile(join(project, '.edu/manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it.each(['claude', 'codex'] as const)('rejects malformed %s blocks before any host refresh or host backup', async cli => {
  const { home, brainRoot } = await fixture();
  await writeFile(join(brainRoot, 'plugin-setup.json'), JSON.stringify({ version: 1, packageRoot: '/old', native: [], fallback: [cli] }));
  await migrateWorkspaces(brainRoot);
  const backups = await readdir(join(brainRoot, 'backups'));
  const directory = join(home, cli === 'claude' ? '.claude' : '.codex'); await mkdir(directory, { recursive: true });
  const path = join(directory, cli === 'claude' ? 'CLAUDE.md' : 'AGENTS.md');
  const malformed = 'CUSTOM\n<!-- edu:core:start -->\nNO END'; await writeFile(path, malformed);
  const runner: SetupRunner = async () => ({ exitCode: 0 });
  const plan = await planSetup({ home, packageRoot: process.cwd(), clis: [cli], runner });
  await expect(applySetup(plan, { runner, brainRoot, platform: 'linux' })).rejects.toThrow('Malformed Edu managed block');
  expect(await readFile(path, 'utf8')).toBe(malformed);
  expect(await readdir(join(brainRoot, 'backups'))).toEqual(backups);
  await expect(readFile(join(brainRoot, 'manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('refreshes only unchanged manifest-owned fallback skills, keeps untracked custom, and is idempotent', async () => {
  const { home, brainRoot } = await fixture();
  const { applyInstall } = await import('../adapters/installer.js');
  const templatesDir = join(home, 'templates');
  await mkdir(join(templatesDir, 'skills/edu-test'), { recursive: true });
  await writeFile(join(templatesDir, 'skills/edu-test/SKILL.md'), 'NEW MANAGED SKILL');
  const target = join(home, '.claude/skills/edu-test/SKILL.md');
  await applyInstall({ scope: 'global', root: process.cwd(), home, templatesDir, notes: [], actions: [{ cli: 'claude', kind: 'file', path: target, content: 'OLD MANAGED SKILL', description: 'skill' }] });
  const runner: SetupRunner = async () => ({ exitCode: 0 });
  const plan = await planSetup({ home, packageRoot: process.cwd(), clis: ['claude'], runner });
  await applySetup(plan, { runner, brainRoot, templatesDir });
  expect(await readFile(target, 'utf8')).toBe('NEW MANAGED SKILL');
  const before = await stat(target);
  await applySetup(plan, { runner, brainRoot, templatesDir });
  expect((await stat(target)).mtimeMs).toBe(before.mtimeMs);
  await writeFile(target, 'CUSTOM EDIT');
  await expect(applySetup(plan, { runner, brainRoot, templatesDir })).rejects.toThrow(/manual conflict/i);
  expect(await readFile(target, 'utf8')).toBe('CUSTOM EDIT');
  expect(await readFile(join(home, '.claude/skills/my-skill/SKILL.md'), 'utf8')).toBe('CUSTOM SKILL');
});
it.each([
  ['claude', 'linux'], ['claude', 'win32'], ['codex', 'linux'], ['codex', 'win32'],
] as const)('does not report success for %s native installation without verifiable cache ownership on %s', async (cli, platform) => {
  const { home, brainRoot } = await fixture();
  const packageRoot = await installedPackage(home);
  await writeFile(join(brainRoot, 'plugin-setup.json'), JSON.stringify({ version: 1, packageRoot: '/old', native: [cli], fallback: [] }));
  const calls: string[] = [];
  const runner: SetupRunner = async c => { calls.push(c.args.join(' ')); return { exitCode: 0, stdout: 'edu@edu' }; };
  const plan = await planSetup({ home, packageRoot, clis: [cli], runner });
  await expect(applySetup(plan, { runner, brainRoot, platform })).rejects.toThrow(/manual conflict.*cache/i);
  expect(calls.every(c => c.startsWith('plugin list'))).toBe(true);
});

it.each([
  ['claude', 'linux'], ['claude', 'win32'], ['pi', 'linux'], ['pi', 'win32'],
] as const)('accepts verified %s loading the installed package in place on %s, without a mutating command', async (cli, platform) => {
  const { home, brainRoot } = await fixture();
  const packageRoot = await installedPackage(home);
  await writeFile(join(brainRoot, 'plugin-setup.json'), JSON.stringify({ version: 1, packageRoot, native: [cli], fallback: [] }));
  const calls: string[] = [];
  const runner: SetupRunner = async c => {
    calls.push(c.args.join(' '));
    return { exitCode: 0, stdout: cli === 'pi' ? packageRoot : JSON.stringify([{ id: 'edu@edu', scope: 'user', readFromFolder: join(packageRoot, 'plugins/claude-code'), installPath: '', version: '0.10.2', enabled: true }]) };
  };
  const plan = await planSetup({ home, packageRoot, clis: [cli], runner });
  await applySetup(plan, { runner, brainRoot, platform });
  expect(calls.every(c => c === 'list' || c.startsWith('plugin list'))).toBe(true);
});

it('upgrades a pristine owned skill with new declared helpers, retires old helpers and refuses custom collisions', async () => {
  const { home, brainRoot } = await fixture();
  const { applyInstall } = await import('../adapters/installer.js');
  const { skillActions } = await import('../adapters/common.js');
  const templatesDir = join(home, 'bundle-templates'), source = join(templatesDir, 'skills/edu-bundle'), destination = join(home, '.claude/skills/edu-bundle');
  await mkdir(source, { recursive: true });
  const document = (file: string) => `---\nname: edu-bundle\ndescription: Bundle\nbundle:\n  files:\n    - path: ${file}\n---\nUse the helper.\n`;
  // Start from a legacy, individually owned SKILL.md with no bundle metadata.
  const old = 'Legacy managed document';
  await applyInstall({ scope: 'global', root: process.cwd(), home, templatesDir, notes: [], actions: [{ cli: 'claude', kind: 'file', path: join(destination, 'SKILL.md'), content: old, description: 'skill' }] });
  await writeFile(join(source, 'SKILL.md'), document('old.mjs')); await writeFile(join(source, 'old.mjs'), 'console.log("old")');
  const runner: SetupRunner = async () => ({ exitCode: 0 });
  const upgrade = async () => applySetup(await planSetup({ home, packageRoot: process.cwd(), clis: ['claude'], runner }), { runner, brainRoot, templatesDir });
  await upgrade(); expect(await readFile(join(destination, 'old.mjs'), 'utf8')).toContain('old');
  await writeFile(join(source, 'SKILL.md'), document('new.mjs')); await writeFile(join(source, 'new.mjs'), 'console.log("new")');
  await upgrade();
  await expect(readFile(join(destination, 'old.mjs'))).rejects.toThrow();
  expect(await readFile(join(destination, 'new.mjs'), 'utf8')).toContain('new');
  await writeFile(join(source, 'SKILL.md'), document('custom.mjs')); await writeFile(join(source, 'custom.mjs'), 'managed');
  await writeFile(join(destination, 'custom.mjs'), 'CUSTOM');
  const before = await readFile(join(destination, 'SKILL.md'));
  await expect(upgrade()).rejects.toThrow(/manual conflict|unowned/i);
  expect(await readFile(join(destination, 'SKILL.md'))).toEqual(before);
  expect(await readFile(join(destination, 'custom.mjs'), 'utf8')).toBe('CUSTOM');
  expect((await skillActions('claude', 'global', process.cwd(), { home, templatesDir })).some(a => a.path.endsWith('custom.mjs'))).toBe(true);
});
