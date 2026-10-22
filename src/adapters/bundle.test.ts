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
it.each(['global', 'project'] as const)('supports a trusted %s directory alias while rejecting symlink descendants', async scope => {
  const f = await fixture(); const original = scope === 'global' ? f.home : f.root;
  const alias = join(f.base, `${scope}-alias`); await fs.symlink(original, alias, 'junction');
  const home = scope === 'global' ? alias : f.home, root = scope === 'project' ? alias : f.root;
  const plan: InstallPlan = { scope, root, home, templatesDir: f.source, notes: [], actions: await skillActions('codex', scope, root, { home, templatesDir: join(f.base, 'templates') }) };
  await applyInstall(plan);
  const target = scope === 'global' ? join(home, '.agents/skills/fixture') : join(root, '.agents/skills/fixture');
  expect(await fs.readFile(join(target, 'scripts/helper.mjs'), 'utf8')).toContain('bundle-ok');
  const manifest = await fs.readFile(getManifestPath(scope, root, home));
  await fs.unlink(join(target, 'scripts/helper.mjs'));
  await fs.symlink(join(f.base, 'outside'), join(target, 'scripts/helper.mjs'));
  await expect(applyInstall(plan)).rejects.toThrow(/symlink/i);
  expect(await fs.readFile(getManifestPath(scope, root, home))).toEqual(manifest);
});
it('copies malformed and large raw legacy documents without applying bundle YAML or size rules', async () => {
  const f = await fixture();
  for (const content of ['---\nname: fixture\ndescription: use this: now\n---\nOld prose.', 'x'.repeat(300 * 1024)]) {
    await fs.writeFile(join(f.source, 'SKILL.md'), content);
    await applyInstall(await f.plan());
    expect(await fs.readFile(join(f.destination, 'SKILL.md'), 'utf8')).toBe(content);
  }
});
it('skips a symlinked custom override visibly without reading it or installing the builtin underneath', async () => {
  const f = await fixture(); const custom = join(f.home, '.edu/skills'); await fs.mkdir(custom, { recursive: true });
  const external = join(f.base, 'external'); await fs.mkdir(external); await fs.writeFile(join(external, 'SKILL.md'), 'PRIVATE');
  await fs.symlink(external, join(custom, 'fixture'), 'junction');
  await fs.mkdir(join(custom, 'good')); await fs.writeFile(join(custom, 'good/SKILL.md'), 'Good legacy skill');
  const { planInstall } = await import('./installer.js');
  const plan = await planInstall({ clis: ['codex'], scope: 'global', root: f.root, home: f.home, templatesDir: join(f.base, 'templates') });
  expect(plan.notes.join(' ')).toMatch(/skip.*fixture.*symlink/i);
  expect(plan.actions.some(action => action.path.startsWith(f.destination))).toBe(false);
  await applyInstall(plan);
  expect(await fs.readFile(join(f.home, '.agents/skills/good/SKILL.md'), 'utf8')).toBe('Good legacy skill');
  expect(await fs.lstat(join(custom, 'fixture')).then(s => s.isSymbolicLink())).toBe(true);
});
it('installs a host-restricted bundle only into compatible hosts of a multi-host plan with notes', async () => {
  const f = await fixture();
  await fs.mkdir(join(f.base, 'templates/agents')); await fs.writeFile(join(f.base, 'templates/EDU.md'), '# Fixture identity');
  await fs.writeFile(join(f.source, 'SKILL.md'), f.document(['scripts/helper.mjs']).replace('bundle:\n', 'bundle:\n  hosts: [codex]\n'));
  const { planInstall } = await import('./installer.js');
  const plan = await planInstall({ clis: ['claude', 'codex'], scope: 'global', root: f.root, home: f.home, templatesDir: join(f.base, 'templates') });
  expect(plan.notes.join(' ')).toMatch(/skip.*fixture.*claude/i);
  await applyInstall(plan);
  expect(await fs.readFile(join(f.destination, 'scripts/helper.mjs'), 'utf8')).toContain('bundle-ok');
  await expect(fs.readFile(join(f.home, '.claude/skills/fixture/SKILL.md'))).rejects.toThrow();
});
it('skips a dangling or directory custom document without falling back to its builtin', async () => {
  const f = await fixture(); const custom = join(f.home, '.edu/skills/fixture'); await fs.mkdir(custom, { recursive: true });
  const { planInstall } = await import('./installer.js');
  const options = { clis: ['codex'] as const, scope: 'global' as const, root: f.root, home: f.home, templatesDir: join(f.base, 'templates') };
  await fs.mkdir(join(custom, 'SKILL.md'));
  let plan = await planInstall({ ...options, clis: [...options.clis] });
  expect(plan.notes.join(' ')).toMatch(/skip.*fixture.*regular/i);
  expect(plan.actions.some(a => a.path.startsWith(f.destination))).toBe(false);
  await fs.rmdir(join(custom, 'SKILL.md')); await fs.symlink(join(f.base, 'absent'), join(custom, 'SKILL.md'));
  plan = await planInstall({ ...options, clis: [...options.clis] });
  expect(plan.notes.join(' ')).toMatch(/skip.*fixture.*symlink/i);
});
it('skips unsupported hosts even in a one-host install and still rejects missing compatible requirements', async () => {
  const f = await fixture(); await fs.mkdir(join(f.base, 'templates/agents')); await fs.writeFile(join(f.base, 'templates/EDU.md'), 'Identity');
  const { planInstall } = await import('./installer.js');
  await fs.writeFile(join(f.source, 'SKILL.md'), f.document([]).replace('bundle:\n', 'bundle:\n  hosts: [codex]\n'));
  const plan = await planInstall({ clis: ['claude'], scope: 'global', root: f.root, home: f.home, templatesDir: join(f.base, 'templates') });
  expect(plan.notes.join(' ')).toMatch(/skip.*fixture.*claude/i);
  await applyInstall(plan); await expect(fs.readFile(join(f.home, '.claude/skills/fixture/SKILL.md'))).rejects.toThrow();
  await fs.writeFile(join(f.source, 'SKILL.md'), f.document([]).replace('bundle:\n', 'bundle:\n  hosts: [codex]\n').replace('node', 'edu-command-does-not-exist'));
  await expect(planInstall({ clis: ['claude', 'codex'], scope: 'global', root: f.root, home: f.home, templatesDir: join(f.base, 'templates') })).rejects.toThrow(/requirement/i);
});
it('supports pre-existing .agents and .edu base aliases with repeat install, helper upgrades and custom preservation', async () => {
  const f = await fixture(); const agents = join(f.base, 'dotfiles/agents'), brain = join(f.base, 'dotfiles/brain');
  await fs.mkdir(agents, { recursive: true }); await fs.mkdir(join(brain, 'skills/local'), { recursive: true });
  await fs.writeFile(join(brain, 'skills/local/SKILL.md'), 'Local document');
  await fs.symlink(agents, join(f.home, '.agents'), 'junction'); await fs.symlink(brain, join(f.home, '.edu'), 'junction');
  const { planInstall } = await import('./installer.js');
  const plan = () => planInstall({ clis: ['codex'], scope: 'global', root: f.root, home: f.home, templatesDir: join(f.base, 'templates') });
  await applyInstall(await plan()); const manifest = await fs.readFile(join(brain, 'manifest.json'));
  await applyInstall(await plan()); expect(await fs.readFile(join(brain, 'manifest.json'))).toEqual(manifest);
  await fs.writeFile(join(agents, 'skills/fixture/custom'), 'CUSTOM');
  await fs.writeFile(join(f.source, 'SKILL.md'), f.document(['scripts/new.mjs'])); await fs.writeFile(join(f.source, 'scripts/new.mjs'), 'new');
  await applyInstall(await plan());
  expect(await fs.readFile(join(agents, 'skills/fixture/scripts/new.mjs'), 'utf8')).toBe('new');
  await expect(fs.readFile(join(agents, 'skills/fixture/scripts/helper.mjs'))).rejects.toThrow();
  expect(await fs.readFile(join(agents, 'skills/fixture/custom'), 'utf8')).toBe('CUSTOM');
  expect(await fs.readFile(join(agents, 'skills/local/SKILL.md'), 'utf8')).toBe('Local document');
});
it.each(['.agents', '.edu'])('rejects a newly inserted or retargeted configured %s alias after planning', async baseName => {
  const f = await fixture(); const first = join(f.base, 'first'), second = join(f.base, 'second');
  await fs.mkdir(first); await fs.mkdir(second);
  await fs.symlink(first, join(f.home, baseName), 'junction');
  const { planInstall } = await import('./installer.js');
  const options = { clis: ['codex'] as const, scope: 'global' as const, root: f.root, home: f.home, templatesDir: join(f.base, 'templates') };
  const plan = await planInstall({ ...options, clis: [...options.clis] });
  await fs.unlink(join(f.home, baseName)); await fs.symlink(second, join(f.home, baseName), 'junction');
  await expect(applyInstall(plan)).rejects.toThrow(/changed|identity|retarget/i);
  expect(await fs.readdir(second)).toEqual([]);
});
it.each([Buffer.from([0x23, 0x20, 0xe9]), Buffer.from('Legacy document', 'utf16le')])('skips unsupported legacy custom encoding visibly, preserving bytes and suppressing its builtin (%j)', async bytes => {
  const f = await fixture(); const custom = join(f.home, '.edu/skills'); await fs.mkdir(join(custom, 'fixture'), { recursive: true });
  await fs.writeFile(join(custom, 'fixture/SKILL.md'), bytes);
  await fs.mkdir(join(custom, 'valid')); await fs.writeFile(join(custom, 'valid/SKILL.md'), 'Valid');
  const { planInstall } = await import('./installer.js');
  const plan = await planInstall({ clis: ['codex'], scope: 'global', root: f.root, home: f.home, templatesDir: join(f.base, 'templates') });
  expect(plan.notes.join(' ')).toMatch(/skip.*fixture.*encoding/i);
  expect(plan.actions.some(a => a.path.startsWith(f.destination))).toBe(false);
  await applyInstall(plan); expect(await fs.readFile(join(custom, 'fixture/SKILL.md'))).toEqual(bytes);
  expect(await fs.readFile(join(f.home, '.agents/skills/valid/SKILL.md'), 'utf8')).toBe('Valid');
});
it('keeps declared custom helper encoding corruption fatal rather than skipping the bundle', async () => {
  const f = await fixture(); const custom = join(f.home, '.edu/skills/fixture'); await fs.mkdir(join(custom, 'scripts'), { recursive: true });
  await fs.writeFile(join(custom, 'SKILL.md'), f.document(['scripts/helper.mjs']));
  await fs.writeFile(join(custom, 'scripts/helper.mjs'), Buffer.from([0xe9]));
  await expect(f.plan()).rejects.toThrow(/UTF-8.*resource/i);
  await fs.writeFile(join(custom, 'SKILL.md'), Buffer.concat([Buffer.from(f.document([])), Buffer.from([0xe9])]));
  await expect(f.plan()).rejects.toThrow(/UTF-8.*declared/i);
  await fs.writeFile(join(custom, 'SKILL.md'), f.document([]) + '\0');
  await expect(f.plan()).rejects.toThrow(/Invalid UTF-8|encoding/i);
});
it.each(['.agents', '.edu'])('rejects a configured %s alias inserted after a standalone skill plan', async baseName => {
  const f = await fixture(), plan = await f.plan(), outside = join(f.base, 'outside'); await fs.mkdir(outside);
  await fs.symlink(outside, join(f.home, baseName), 'junction');
  await expect(applyInstall(plan)).rejects.toThrow(/identity changed/i);
  expect(await fs.readdir(outside)).toEqual([]);
});
it('removes empty retired owned directories and restores them and files if manifest persistence then fails', async () => {
  const f = await fixture(['old/deep/helper.mjs']); await applyInstall(await f.plan());
  const old = join(f.destination, 'old'), manifest = getManifestPath('global', f.root, f.home), prior = await fs.readFile(manifest);
  await fs.writeFile(join(f.source, 'SKILL.md'), f.document([]));
  const { FileTransaction } = await import('./operations.js');
  const transaction = new FileTransaction(); const move = transaction.move.bind(transaction); let sawRemoval = false;
  transaction.move = async (from, to) => {
    if (to === manifest) {
      sawRemoval = !(await fs.stat(old).catch(() => undefined));
      throw new Error('injected manifest move after retirement');
    }
    return move(from, to);
  };
  await expect(applyInstall(await f.plan(), { transaction })).rejects.toThrow('injected manifest move');
  expect(sawRemoval).toBe(true);
  expect(await fs.readFile(join(old, 'deep/helper.mjs'), 'utf8')).toContain('bundle-ok');
  expect(await fs.readFile(manifest)).toEqual(prior);
  await applyInstall(await f.plan()); await expect(fs.stat(old)).rejects.toThrow();
});
it('rolls back files and an already removed nested directory when later directory removal fails', async () => {
  const f = await fixture(['old/deep/helper.mjs']); await applyInstall(await f.plan());
  const manifest = getManifestPath('global', f.root, f.home), prior = await fs.readFile(manifest);
  await fs.writeFile(join(f.source, 'SKILL.md'), f.document([]));
  const { FileTransaction } = await import('./operations.js'); const transaction = new FileTransaction();
  const remove = transaction.removeEmptyDirectory.bind(transaction); let nestedRemoved = false;
  transaction.removeEmptyDirectory = async path => {
    if (path === join(f.destination, 'old')) { nestedRemoved = !(await fs.stat(join(path, 'deep')).catch(() => undefined)); throw new Error('injected directory removal'); }
    return remove(path);
  };
  await expect(applyInstall(await f.plan(), { transaction })).rejects.toThrow('injected directory removal');
  expect(nestedRemoved).toBe(true);
  expect(await fs.readFile(join(f.destination, 'old/deep/helper.mjs'), 'utf8')).toContain('bundle-ok');
  expect(await fs.readFile(manifest)).toEqual(prior);
});

it('skips unavailable requirements of an unsupported host after structural validation', async () => {
  const f = await fixture();
  await fs.writeFile(join(f.source, 'SKILL.md'), f.document([]).replace('bundle:\n', 'bundle:\n  hosts: [codex]\n').replace('node', 'codex'));
  const notes: string[] = [];
  const actions = await skillActions('claude', 'global', f.root, { home: f.home, templatesDir: join(f.base, 'templates'), detectBinary: async () => false, notes });
  expect(actions).toEqual([]); expect(notes.join(' ')).toMatch(/skip.*fixture.*claude/i);
  await expect(skillActions('codex', 'global', f.root, { home: f.home, templatesDir: join(f.base, 'templates'), detectBinary: async () => false })).rejects.toThrow(/requirement/i);
});
