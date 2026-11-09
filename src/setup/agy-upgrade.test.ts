import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { planAgyRefresh } from './agy-upgrade.js';
import type { SetupCommand, SetupRunner } from './index.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

async function fixture(installedVersion: string | undefined, nextVersion = '5.0.0', installedName = 'edu') {
  const base = await mkdtemp(join(tmpdir(), 'edu-agy-')); dirs.push(base);
  const packageRoot = join(base, 'pkg');
  await mkdir(join(packageRoot, 'plugins/agy'), { recursive: true });
  await writeFile(join(packageRoot, 'plugins/agy/plugin.json'), JSON.stringify({ name: 'edu', version: nextVersion }));
  const installedPath = join(base, 'gemini/plugins/edu');
  const state = { version: installedVersion, failInstall: false, calls: [] as string[][] };
  if (installedVersion) {
    await mkdir(installedPath, { recursive: true });
    await writeFile(join(installedPath, 'plugin.json'), JSON.stringify({ name: installedName, version: installedVersion }));
  }
  const runner: SetupRunner = async (command: SetupCommand) => {
    state.calls.push(command.args);
    if (command.args[1] === 'list') return { exitCode: 0, stdout: JSON.stringify(state.version ? [{ name: 'edu', version: state.version, path: installedPath, enabled: true }] : []) };
    if (command.args[1] === 'install') {
      const from = command.args[2]!;
      const isNew = from === join(packageRoot, 'plugins', 'agy');
      if (state.failInstall && isNew) return { exitCode: 1, stderr: 'boom' };
      state.version = isNew ? nextVersion : installedVersion;
      return { exitCode: 0 };
    }
    return { exitCode: 1 };
  };
  return { base, packageRoot, brainRoot: join(base, 'edu'), runner, state };
}

describe('agy native refresh', () => {
  it('reinstalls an older Edu plugin through agy and backs up the installed copy', async () => {
    const f = await fixture('4.1.0');
    await (await planAgyRefresh({ packageRoot: f.packageRoot, brainRoot: f.brainRoot, runner: f.runner }))();
    expect(f.state.version).toBe('5.0.0');
    expect(f.state.calls).toContainEqual(['plugin', 'install', join(f.packageRoot, 'plugins/agy')]);
    expect((await readdir(join(f.brainRoot, 'backups'))).some(name => name.startsWith('agy-plugin-'))).toBe(true);
  });

  it('does nothing when the installed plugin is current', async () => {
    const f = await fixture('5.0.0');
    await (await planAgyRefresh({ packageRoot: f.packageRoot, brainRoot: f.brainRoot, runner: f.runner }))();
    expect(f.state.calls.filter(args => args[1] === 'install')).toEqual([]);
  });

  it('reinstalls the backup when the new plugin fails to install', async () => {
    const f = await fixture('4.1.0');
    f.state.failInstall = true;
    const refresh = await planAgyRefresh({ packageRoot: f.packageRoot, brainRoot: f.brainRoot, runner: f.runner });
    await expect(refresh()).rejects.toThrow(/previous plugin was reinstalled/);
    expect(f.state.version).toBe('4.1.0');
  });

  it('refuses a plugin named edu that is not Edu', async () => {
    const f = await fixture('4.1.0', '5.0.0', 'someone-else');
    await expect(planAgyRefresh({ packageRoot: f.packageRoot, brainRoot: f.brainRoot, runner: f.runner })).rejects.toThrow(/Manual conflict: agy native plugin/);
  });
});
