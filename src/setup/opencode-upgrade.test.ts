import { mkdir, mkdtemp, readFile, realpath, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { applyInstall } from '../adapters/installer.js';
import { applySetup, planSetup, type SetupRunner } from './index.js';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const home = await realpath(await mkdtemp(join(tmpdir(), '09-opencode-assets-'))); roots.push(home);
  const brainRoot = join(home, '.edu'); const packageRoot = join(home, 'package'); const templatesDir = join(packageRoot, 'templates');
  const relative = ['commands/edu.md', 'agents/edu.md', 'plugins/edu.ts'];
  const destination = join(home, '.config/opencode');
  for (const path of relative) { const source = join(packageRoot, 'plugins/opencode', path); await mkdir(dirname(source), { recursive: true }); await writeFile(source, `NEW ${path}`); }
  await writeFile(join(packageRoot, 'plugins/opencode/commands/new.md'), 'NEW UNTRACKED');
  await applyInstall({ home, scope: 'global', root: packageRoot, templatesDir, notes: [], actions: relative.map(path => ({ cli: 'opencode', kind: 'file', path: join(destination, path), content: `OLD ${path}`, description: 'OpenCode asset' })) });
  await writeFile(join(brainRoot, 'EDU.md'), '# CUSTOM IDENTITY');
  await writeFile(join(brainRoot, 'plugin-setup.json'), JSON.stringify({ version: 1, packageRoot, native: [], fallback: ['opencode'] }));
  await writeFile(join(destination, 'commands/my-command.md'), 'MY CUSTOM');
  const runner: SetupRunner = async () => { throw new Error('No native command allowed for fallback'); };
  const run = async () => applySetup(await planSetup({ home, packageRoot, clis: ['opencode'], runner }), { runner, brainRoot, templatesDir });
  return { home, brainRoot, packageRoot, destination, relative, run };
}
it('refreshes only manifest-owned commands, agents and plugins with backups, without adding integration/files', async () => {
  const f = await fixture(); await f.run();
  for (const path of f.relative) expect(await readFile(join(f.destination, path), 'utf8')).toBe(`NEW ${path}`);
  expect(await readFile(join(f.destination, 'commands/my-command.md'), 'utf8')).toBe('MY CUSTOM');
  await expect(readFile(join(f.destination, 'commands/new.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  const backups = await readdir(join(f.brainRoot, 'backups')); let found = false;
  for (const backup of backups) {
    let record; try { record = JSON.parse(await readFile(join(f.brainRoot, 'backups', backup, 'manifest.json'), 'utf8')); } catch { continue; }
    for (const file of record.files) if (file.path === join(f.destination, 'commands/edu.md')) { expect(await readFile(join(f.brainRoot, 'backups', backup, file.file), 'utf8')).toBe('OLD commands/edu.md'); found = true; }
  }
  expect(found).toBe(true);
  const before = await stat(join(f.destination, 'commands/edu.md')); await f.run();
  expect((await stat(join(f.destination, 'commands/edu.md'))).mtimeMs).toBe(before.mtimeMs);
});
it.each(['custom', 'missing', 'retired'])('preserves assets and rejects unresolved %s ownership conflict', async mode => {
  const f = await fixture(); const target = join(f.destination, 'commands/edu.md');
  if (mode === 'custom') await writeFile(target, 'MY EDIT');
  if (mode === 'missing') await rm(target);
  if (mode === 'retired') await rm(join(f.packageRoot, 'plugins/opencode/commands/edu.md'));
  await expect(f.run()).rejects.toThrow(/manual conflict/i);
  if (mode === 'custom') expect(await readFile(target, 'utf8')).toBe('MY EDIT');
  expect(await readFile(join(f.destination, 'agents/edu.md'), 'utf8')).toBe('OLD agents/edu.md');
});
