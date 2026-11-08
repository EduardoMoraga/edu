import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, parse, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CliId } from '../core/contracts.js';
import { applySetup, planSetup, type SetupCommand, type SetupRunner } from './index.js';
import { assertPurgeableBrain, uninstallEdu } from './uninstall.js';

const packageRoot = process.cwd();
const templatesDir = join(packageRoot, 'templates');
const ALL: CliId[] = ['claude', 'codex', 'pi', 'opencode', 'agy'];
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

/** A home with the user's own config in every file Edu may touch (no trailing newline on purpose in some). */
async function userHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'edu-uninstall-'));
  dirs.push(home);
  const files: Record<string, string> = {
    '.claude/settings.json': '{\n  "theme": "dark",\n  "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "say done" }] }] }\n}\n',
    '.claude.json': '{"numStartups":3,"mcpServers":{"other":{"command":"other"}}}',
    '.claude/CLAUDE.md': '# My rules\n\nBe brief.',
    '.codex/config.toml': 'model = "gpt-x"\n\n[mcp_servers.other]\ncommand = "other"\n',
    '.codex/AGENTS.md': 'Codex user rules\n',
    '.pi/agent/mcp.json': '{\n  "mcpServers": { "other": { "command": "other" } }\n}\n',
    '.pi/agent/AGENTS.md': 'Pi rules',
    '.config/opencode/opencode.json': '{\n  // my comment\n  "theme": "tokyo",\n}\n',
    '.config/opencode/AGENTS.md': 'OpenCode rules\n\n',
    '.gemini/GEMINI.md': 'Gemini rules\n',
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(home, path)), { recursive: true });
    await writeFile(join(home, path), content);
  }
  return home;
}

/** Every file and directory outside the brain, with file bytes. */
async function snapshot(home: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const rel = relative(home, path);
      if (rel === '.edu') continue;
      if (entry.isDirectory()) { out[`${rel}/`] = ''; await walk(path); }
      else out[rel] = (await readFile(path)).toString('base64');
    }
  }
  await walk(home);
  return out;
}

function runner(native: 'ok' | 'fail') {
  const calls: SetupCommand[] = [];
  const run: SetupRunner = async (command) => {
    calls.push(command);
    if (command.args.includes('list')) return { exitCode: 0, stdout: '' };
    return native === 'ok' ? { exitCode: 0 } : { exitCode: 1, stderr: 'not available' };
  };
  return { calls, run };
}

async function setup(home: string, native: 'ok' | 'fail') {
  const { calls, run } = runner(native);
  const plan = await planSetup({ clis: ALL, packageRoot, home, runner: run });
  const report = await applySetup(plan, { runner: run, templatesDir, detected: ALL, brainRoot: join(home, '.edu') });
  return { calls, run, report };
}

describe('edu uninstall', () => {
  it('restores every host config byte for byte after a managed-file setup of all hosts', async () => {
    const home = await userHome();
    const before = await snapshot(home);
    const { run, report } = await setup(home, 'fail');
    expect(report.fallback.sort()).toEqual([...ALL].sort());
    expect(await snapshot(home)).not.toEqual(before);
    const result = await uninstallEdu({ home, cwd: home, brainRoot: join(home, '.edu'), runner: run });
    expect(result.removed.map(r => r.scope)).toEqual(['global']);
    expect(await snapshot(home)).toEqual(before);
    expect(result.brain.action).toBe('kept');
    expect(await readFile(join(home, '.edu/EDU.md'), 'utf8')).toBeTruthy();
  });

  it('runs the native removal commands and restores configs after a plugin setup', async () => {
    const home = await userHome();
    await rm(join(home, '.codex'), { recursive: true });
    const before = await snapshot(home);
    const { calls, run } = await setup(home, 'ok');
    calls.length = 0;
    await uninstallEdu({ home, cwd: home, brainRoot: join(home, '.edu'), runner: run });
    expect(calls.map(c => `${c.command} ${c.args.join(' ')}`)).toEqual(expect.arrayContaining([
      'claude plugin uninstall edu@edu', 'claude plugin marketplace remove edu', 'codex plugin remove edu@edu',
      'codex plugin marketplace remove edu', `pi remove ${packageRoot}`, 'agy plugin uninstall edu',
    ]));
    // Includes the ~/.codex directory setup created for Codex and nothing else.
    expect(await snapshot(home)).toEqual(before);
  });

  it('is idempotent: a second run removes nothing and does not fail', async () => {
    const home = await userHome();
    const before = await snapshot(home);
    const { run } = await setup(home, 'fail');
    await uninstallEdu({ home, cwd: home, brainRoot: join(home, '.edu'), runner: run });
    const again = await uninstallEdu({ home, cwd: home, brainRoot: join(home, '.edu'), runner: run });
    expect(again.removed).toEqual([]);
    expect(await snapshot(home)).toEqual(before);
  });

  it('adds a newly installed CLI only when named explicitly, and still uninstalls exactly', async () => {
    const home = await userHome();
    const before = await snapshot(home);
    const { run } = runner('fail');
    const brainRoot = join(home, '.edu');
    await applySetup(await planSetup({ clis: ['claude'], packageRoot, home, runner: run }), { runner: run, templatesDir, brainRoot });
    const codexRules = await readFile(join(home, '.codex/AGENTS.md'), 'utf8');
    // Detected (as `edu update` runs it): refresh only, with a note naming the new CLI.
    const detected = await applySetup(await planSetup({ clis: ['claude', 'codex'], packageRoot, home, runner: run }), { runner: run, templatesDir, brainRoot });
    expect(detected.notes?.join('\n')).toContain('edu setup --yes --cli codex');
    expect(await readFile(join(home, '.codex/AGENTS.md'), 'utf8')).toBe(codexRules);
    // Named with --cli: set up.
    const named = await applySetup(await planSetup({ clis: ['claude', 'codex'], packageRoot, home, runner: run }), { runner: run, templatesDir, brainRoot, addNew: true });
    expect(named.fallback).toEqual(expect.arrayContaining(['claude', 'codex']));
    expect(await readFile(join(home, '.codex/AGENTS.md'), 'utf8')).toContain('edu:core');
    await uninstallEdu({ home, cwd: home, brainRoot, runner: run });
    expect(await snapshot(home)).toEqual(before);
  });

  it('purges the brain only when asked, and never a directory that holds the home', async () => {
    const home = await userHome();
    const { run } = await setup(home, 'fail');
    const result = await uninstallEdu({ home, cwd: home, brainRoot: join(home, '.edu'), runner: run, purgeBrain: true });
    expect(result.brain.action).toBe('purged');
    await expect(readdir(join(home, '.edu'))).rejects.toThrow();
    await expect(assertPurgeableBrain(home, home)).rejects.toThrow(/home directory/);
    await expect(assertPurgeableBrain(dirname(home), home)).rejects.toThrow(/home directory/);
    await mkdir(join(home, 'not-a-brain'));
    await expect(assertPurgeableBrain(join(home, 'not-a-brain'), home)).rejects.toThrow(/not an Edu brain/);
  });
});

describe('purge home protection', () => {
  /** A complete Edu brain layout: the strongest markers the guard accepts. */
  async function brainLayout(root: string): Promise<void> {
    await mkdir(join(root, 'brain/1-canonical'), { recursive: true });
    await mkdir(join(root, 'brain/0-index'), { recursive: true });
    await writeFile(join(root, 'EDU.md'), '# Edu');
    await writeFile(join(root, 'config.json'), '{}');
  }
  async function sandbox(): Promise<string> {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'edu-purge-')));
    dirs.push(root);
    return root;
  }

  it('refuses a target that reaches the home through a symlinked ancestor, and leaves the home intact', async () => {
    const root = await sandbox();
    const home = join(root, 'real/home');
    await brainLayout(home);
    await writeFile(join(home, 'precious.txt'), 'keep me');
    const alias = join(root, 'alias');
    await symlink(join(root, 'real'), alias, 'junction');
    await expect(assertPurgeableBrain(join(alias, 'home'), home)).rejects.toThrow(/home directory/);
    await expect(uninstallEdu({ home, cwd: home, brainRoot: join(alias, 'home'), purgeBrain: true, runner: runner('fail').run })).rejects.toThrow(/home directory/);
    // And through an aliased HOME: the canonical target is still the real home.
    await expect(assertPurgeableBrain(home, join(alias, 'home'))).rejects.toThrow(/home directory/);
    await expect(assertPurgeableBrain(join(root, 'real'), join(alias, 'home'))).rejects.toThrow(/home directory/);
    expect(await readFile(join(home, 'precious.txt'), 'utf8')).toBe('keep me');
  });

  it('refuses the home itself, the filesystem root and every ancestor of the home', async () => {
    const root = await sandbox();
    const home = join(root, 'home');
    await brainLayout(home);
    await expect(assertPurgeableBrain(home, home)).rejects.toThrow(/home directory/);
    await expect(assertPurgeableBrain(root, home)).rejects.toThrow(/home directory/);
    await expect(assertPurgeableBrain(parse(root).root, home)).rejects.toThrow(/home directory|root/);
  });

  it('refuses a directory without an Edu brain layout (config.json alone is not enough)', async () => {
    const root = await sandbox();
    const home = join(root, 'home');
    const target = join(home, '.edu');
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'config.json'), '{}');
    await expect(assertPurgeableBrain(target, home)).rejects.toThrow(/not an Edu brain/);
    await writeFile(join(target, 'EDU.md'), '# Edu');
    await expect(assertPurgeableBrain(target, home)).rejects.toThrow(/not an Edu brain/);
  });

  it('refuses a brain that is itself a symlink, or whose markers are symlinks', async () => {
    const root = await sandbox();
    const home = join(root, 'home');
    const real = join(root, 'elsewhere');
    await brainLayout(real);
    await mkdir(home, { recursive: true });
    await symlink(real, join(home, '.edu'), 'junction');
    await expect(assertPurgeableBrain(join(home, '.edu'), home)).rejects.toThrow(/symlink/);
    await expect(uninstallEdu({ home, cwd: home, brainRoot: join(home, '.edu'), purgeBrain: true, runner: runner('fail').run })).rejects.toThrow(/symlink/);
    expect(await readFile(join(real, 'EDU.md'), 'utf8')).toBe('# Edu');
    const linked = join(root, 'linked');
    await mkdir(linked);
    await writeFile(join(linked, 'EDU.md'), '# Edu');
    await symlink(join(real, 'brain'), join(linked, 'brain'), 'junction');
    await expect(assertPurgeableBrain(linked, home)).rejects.toThrow(/not an Edu brain|symlink/);
  });

  it('purges a legitimate brain by its canonical path without following links inside it', async () => {
    const root = await sandbox();
    const home = join(root, 'home');
    const brain = join(home, '.edu');
    await brainLayout(brain);
    const outside = join(root, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'keep.txt'), 'outside');
    await symlink(outside, join(brain, 'brain/1-canonical/link'), 'junction');
    const result = await uninstallEdu({ home, cwd: home, brainRoot: brain, purgeBrain: true, runner: runner('fail').run });
    expect(result.brain.action).toBe('purged');
    await expect(readdir(brain)).rejects.toThrow();
    expect(await readFile(join(outside, 'keep.txt'), 'utf8')).toBe('outside');
    expect(await readdir(home)).toEqual([]);
  });
});
