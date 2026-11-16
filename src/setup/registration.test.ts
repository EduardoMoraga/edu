import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applySetup, planSetup, uninstallSetup, type SetupCommand, type SetupRunner } from './index.js';
import { captureNativeProvenance } from './native-provenance.js';
import { eduOwnedRoot, resolvesInPlace, samePath, tree } from './native-files.js';

const packageRoot = process.cwd();
const templatesDir = join(packageRoot, 'templates');
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function tempDir(): Promise<string> { const dir = await mkdtemp(join(tmpdir(), 'edu-registration-')); dirs.push(dir); return dir; }
const record = async (home: string) => JSON.parse(await readFile(join(home, '.edu/plugin-setup.json'), 'utf8')) as { native: string[] };

describe('native registrations are recorded before they run (H2)', () => {
  it('records the host before its first command and undoes finished steps when a later one fails', async () => {
    const home = await tempDir();
    const calls: SetupCommand[] = [];
    const seenWhileRegistering: string[][] = [];
    const runner: SetupRunner = async command => {
      calls.push(command);
      if (command.args.at(-1) === 'list') return { exitCode: 0, stdout: '' };
      if (command.args.includes('add')) { seenWhileRegistering.push((await record(home)).native); return { exitCode: 0 }; }
      if (command.args[1] === 'install') return { exitCode: 1, stderr: 'install failed' };
      return { exitCode: 0 };
    };
    const plan = await planSetup({ clis: ['claude'], packageRoot, home, runner });
    const report = await applySetup(plan, { runner, templatesDir, platform: 'linux', env: {} });
    expect(seenWhileRegistering).toEqual([['claude']]);
    expect(calls.map(call => call.args.join(' '))).toContain('plugin marketplace remove edu');
    expect(report.failed).toEqual([{ cli: 'claude', message: 'install failed' }]);
    expect(report.fallback).toEqual(['claude']);
    expect((await record(home)).native).toEqual([]);
  });

  it('keeps the record when the undo fails, so uninstall still removes the registration', async () => {
    const home = await tempDir();
    const runner: SetupRunner = async command => {
      if (command.args.at(-1) === 'list') return { exitCode: 0, stdout: '' };
      if (command.args.includes('add')) return { exitCode: 0 };
      return { exitCode: 1, stderr: 'host busy' };
    };
    const plan = await planSetup({ clis: ['claude'], packageRoot, home, runner });
    const report = await applySetup(plan, { runner, templatesDir, platform: 'linux', env: {} });
    expect((await record(home)).native).toEqual(['claude']);
    expect(report.notes?.join('\n')).toMatch(/could not be undone.*edu uninstall/);
    const removals: string[] = [];
    await uninstallSetup({ home, runner: async command => { removals.push(command.args.join(' ')); return { exitCode: 0 }; } });
    expect(removals).toEqual(['plugin uninstall edu@edu', 'plugin marketplace remove edu']);
  });

  it.each(['❯edu@edu', '❯ edu@edu  1.0.0', '› edu', '* edu-agent'])('recognizes an installed plugin listed as %j', async line => {
    const home = await tempDir();
    const runner: SetupRunner = async () => ({ exitCode: 0, stdout: `Installed plugins:\n  ${line}\n` });
    const plan = await planSetup({ clis: ['claude'], packageRoot, home, runner });
    expect(plan.alreadyInstalled).toEqual(['claude']);
    expect(plan.commands).toEqual([]);
  });
});

describe('symlinked ancestors (macOS /var → /private/var)', () => {
  it('captures provenance when HOME sits under a symlink', async () => {
    const base = await tempDir();
    await mkdir(join(base, 'real/home/.codex'), { recursive: true });
    await symlink(join(base, 'real'), join(base, 'alias'));
    const home = join(base, 'alias/home');
    await writeFile(join(home, '.codex/config.toml'), 'model = "x"\n');
    const listing = JSON.stringify({ installed: [{ pluginId: 'edu@edu' }] });
    const runner: SetupRunner = async () => ({ exitCode: 0, stdout: listing });
    const check = await captureNativeProvenance({ host: 'codex', home, packageRoot: join(base, 'alias/pkg'), runner, expectedRegistration: JSON.stringify([{ pluginId: 'edu@edu' }]) });
    await expect(check()).resolves.toBeUndefined();
    await writeFile(join(home, '.codex/config.toml'), 'model = "changed"\n');
    await expect(check()).rejects.toThrow(/provenance metadata/);
  });

  it('hashes a plugin tree under a symlinked ancestor but refuses a link below its anchor', async () => {
    const base = await tempDir();
    await mkdir(join(base, 'real/cache/edu'), { recursive: true });
    await writeFile(join(base, 'real/cache/edu/plugin.json'), '{}');
    await symlink(join(base, 'real'), join(base, 'alias'));
    await expect(tree(join(base, 'alias/cache/edu'), join(base, 'alias'))).resolves.toHaveProperty(['plugin.json']);
    await mkdir(join(base, 'other'));
    await symlink(join(base, 'real/cache'), join(base, 'other/cache'));
    expect(await resolvesInPlace(join(base, 'other/cache/edu'), join(base, 'other'))).toBe(false);
    await expect(tree(join(base, 'other/cache/edu'), join(base, 'other'))).rejects.toThrow(/symlink/);
    // tmpdir() itself sits under /var → /private/var on macOS: an ancestor link of the anchor is fine.
    expect(await resolvesInPlace(join(base, 'real/cache/edu'), base)).toBe(true);
  });
});

describe('Windows paths', () => {
  it('compares Windows paths case-insensitively and across extended forms', () => {
    expect(samePath('C:\\Users\\Me\\npm\\node_modules\\edu-agent', 'c:\\users\\me\\npm\\node_modules\\edu-agent', 'win32')).toBe(true);
    expect(samePath('\\\\?\\C:\\Users\\me\\pkg', 'C:/Users/me/pkg/', 'win32')).toBe(true);
    expect(samePath('\\\\?\\UNC\\server\\share\\pkg', '\\\\server\\share\\pkg', 'win32')).toBe(true);
    expect(samePath('/Users/Me/pkg', '/users/me/pkg', 'darwin')).toBe(false);
    expect(eduOwnedRoot('D:\\Tools\\Node_Modules\\Edu-Agent', undefined, 'win32')).toBe(true);
    expect(eduOwnedRoot('C:\\Old\\Root', 'c:\\old\\root', 'win32')).toBe(true);
  });
});
