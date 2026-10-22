import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { stringify } from 'yaml';
import { skillActions } from './common.js';
import { applyInstall, getManifestPath } from './installer.js';
import type { InstallPlan } from './types.js';
const fault = vi.hoisted(() => ({ path: '', remaining: 0 }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, writeFile: async (path: Parameters<typeof actual.writeFile>[0], ...args: [Parameters<typeof actual.writeFile>[1], Parameters<typeof actual.writeFile>[2]?]) => {
    if (String(path) === fault.path && fault.remaining > 0) { fault.remaining--; throw new Error('injected late write'); }
    return actual.writeFile(path, ...args);
  } };
});
const roots: string[] = [];
afterEach(async () => { fault.path = ''; fault.remaining = 0; vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture(paths = ['scripts/helper.mjs']) {
  const base = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'edu-bundle-'))); roots.push(base);
  const home = join(base, 'home'), root = join(base, 'project'), templatesDir = join(base, 'templates');
  const source = join(templatesDir, 'skills/fixture');
  for (const path of [home, root, source]) await fs.mkdir(path, { recursive: true });
  const document = (files: string[]) => `---\n${stringify({ name: 'fixture', description: 'Fixture helper', bundle: { files: files.map(path => ({ path })), requires: ['node'] } })}---\nUse the declared helper.\n`;
  await fs.writeFile(join(source, 'SKILL.md'), document(paths));
  for (const path of paths.filter(path => !path.includes('..'))) { await fs.mkdir(dirname(join(source, path)), { recursive: true }); await fs.writeFile(join(source, path), 'console.log("bundle-ok")\n'); }
  const destination = join(home, '.agents/skills/fixture');
  const plan = async (): Promise<InstallPlan> => ({ scope: 'global', root, home, templatesDir, notes: [], actions: await skillActions('codex', 'global', root, { home, templatesDir }) });
  return { base, home, root, source, destination, plan, document };
}
it('installs declared helpers and executes the installed copy; unchanged reinstall is a no-op', async () => {
  const f = await fixture(); await fs.writeFile(join(f.source, 'private.txt'), 'not declared');
  await applyInstall(await f.plan());
  expect(execFileSync(process.execPath, [join(f.destination, 'scripts/helper.mjs')], { encoding: 'utf8' }).trim()).toBe('bundle-ok');
  await expect(fs.readFile(join(f.destination, 'private.txt'))).rejects.toThrow();
  const path = join(f.destination, 'scripts/helper.mjs'), manifest = getManifestPath('global', f.root, f.home);
  const before = await fs.stat(path), beforeManifest = await fs.stat(manifest);
  await applyInstall(await f.plan());
  expect((await fs.stat(path)).mtimeMs).toBe(before.mtimeMs);
  expect((await fs.stat(manifest)).mtimeMs).toBe(beforeManifest.mtimeMs);
});
it('rejects a missing declared helper before writing', async () => {
  const f = await fixture(); await fs.unlink(join(f.source, 'scripts/helper.mjs'));
  await expect(f.plan().then(applyInstall)).rejects.toThrow();
  await expect(fs.readFile(join(f.destination, 'SKILL.md'))).rejects.toThrow();
});
it('refuses an unowned skill collision even when named like a bundle', async () => {
  const f = await fixture(); await fs.mkdir(f.destination, { recursive: true }); await fs.writeFile(join(f.destination, 'SKILL.md'), 'PRIVATE');
  await expect(f.plan().then(applyInstall)).rejects.toThrow(/unowned|ownership|collision/i);
  expect(await fs.readFile(join(f.destination, 'SKILL.md'), 'utf8')).toBe('PRIVATE');
});
it('rejects traversal and symlinked sources and destinations', async () => {
  const f = await fixture(['../outside.mjs']);
  await expect(f.plan().then(applyInstall)).rejects.toThrow(/path|traversal/i);
  await fs.writeFile(join(f.source, 'SKILL.md'), f.document(['scripts/helper.mjs']));
  await fs.mkdir(join(f.source, 'scripts')); await fs.writeFile(join(f.base, 'outside.mjs'), 'OUTSIDE');
  await fs.symlink(join(f.base, 'outside.mjs'), join(f.source, 'scripts/helper.mjs'));
  await expect(f.plan().then(applyInstall)).rejects.toThrow(/symlink|regular/i);
  await fs.unlink(join(f.source, 'scripts/helper.mjs')); await fs.writeFile(join(f.source, 'scripts/helper.mjs'), 'console.log("bundle-ok")');
  const plan = await f.plan(); await fs.mkdir(join(f.home, '.agents')); await fs.mkdir(join(f.base, 'outside'));
  await fs.symlink(join(f.base, 'outside'), join(f.home, '.agents/skills'), 'junction');
  await expect(applyInstall(plan)).rejects.toThrow(/symlink|contain/i);
  expect(await fs.readdir(join(f.base, 'outside'))).toEqual([]);
});
it('rolls back target files and the ownership manifest after a late write failure', async () => {
  const f = await fixture(); await applyInstall(await f.plan());
  const manifest = getManifestPath('global', f.root, f.home), skill = join(f.destination, 'SKILL.md'), helper = join(f.destination, 'scripts/helper.mjs');
  const oldManifest = await fs.readFile(manifest), oldSkill = await fs.readFile(skill), oldHelper = await fs.readFile(helper);
  await fs.writeFile(join(f.source, 'SKILL.md'), f.document(['scripts/helper.mjs']) + 'Updated document.\n');
  await fs.writeFile(join(f.source, 'scripts/helper.mjs'), 'console.log("updated")');
  fault.path = helper; fault.remaining = 1;
  await expect(f.plan().then(applyInstall)).rejects.toThrow('injected late write');
  expect(fault.remaining).toBe(0);
  expect(await fs.readFile(manifest)).toEqual(oldManifest);
  expect(await fs.readFile(skill)).toEqual(oldSkill);
  expect(await fs.readFile(helper)).toEqual(oldHelper);
});
it('adds and retires owned helpers while preserving edited and unrelated files', async () => {
  const f = await fixture(['scripts/old.mjs', 'scripts/edited.mjs']); await applyInstall(await f.plan());
  await fs.writeFile(join(f.destination, 'scripts/edited.mjs'), 'CUSTOM EDIT');
  await fs.writeFile(join(f.destination, 'custom.txt'), 'UNRELATED');
  await fs.writeFile(join(f.source, 'SKILL.md'), f.document(['scripts/new.mjs']));
  await fs.writeFile(join(f.source, 'scripts/new.mjs'), 'console.log("new")');
  await applyInstall(await f.plan());
  await expect(fs.readFile(join(f.destination, 'scripts/old.mjs'))).rejects.toThrow();
  expect(await fs.readFile(join(f.destination, 'scripts/new.mjs'), 'utf8')).toContain('new');
  expect(await fs.readFile(join(f.destination, 'scripts/edited.mjs'), 'utf8')).toBe('CUSTOM EDIT');
  expect(await fs.readFile(join(f.destination, 'custom.txt'), 'utf8')).toBe('UNRELATED');
});
it('rechecks changed sources and refuses symlinked manifest directories before writing', async () => {
  const f = await fixture(), plan = await f.plan();
  await fs.writeFile(join(f.source, 'scripts/helper.mjs'), 'changed after planning');
  await expect(applyInstall(plan)).rejects.toThrow(/source changed/i);
  await expect(fs.readFile(join(f.destination, 'SKILL.md'))).rejects.toThrow();
  const next = await f.plan(); await fs.mkdir(join(f.base, 'foreign-metadata')); await fs.symlink(join(f.base, 'foreign-metadata'), join(f.home, '.edu'), 'junction');
  await expect(applyInstall(next)).rejects.toThrow(/symlink/i);
  expect(await fs.readdir(join(f.base, 'foreign-metadata'))).toEqual([]);
});
it('preserves legacy document-only prose links without reading or copying their targets', async () => {
  const f = await fixture();
  const legacy = '---\nname: fixture\ndescription: Legacy document\n---\nRead [guide](../../README.md) or [project docs](docs/guide.md).\n';
  await fs.writeFile(join(f.source, 'SKILL.md'), legacy);
  await applyInstall(await f.plan());
  expect(await fs.readFile(join(f.destination, 'SKILL.md'), 'utf8')).toBe(legacy);
  expect(await fs.readdir(f.destination)).toEqual(['SKILL.md']);
});
