import { chmod, mkdtemp, mkdir, readFile, realpath, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { openBrain } from '../brain/brain.js';
import { registerProject } from '../vault/registry.js';
import { migrateWorkspaces } from './migrate.js';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), '09-upgrade-'))); roots.push(dir);
  const home = join(dir, 'global'); const project = join(dir, 'private-work');
  for (const root of [home, join(project, '.edu')]) {
    const brain = openBrain([{ scope: 'project', root }]); await brain.init({ scope: 'project', root });
    await writeFile(join(root, 'EDU.md'), '# Custom identity\nPRIVATE CUSTOM TEXT\n');
    await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Keep me', body: 'Private lesson', status: 'proven', created: '2020-01-01T00:00:00Z' });
    await mkdir(join(root, 'skills/custom'), { recursive: true }); await writeFile(join(root, 'skills/custom/SKILL.md'), 'custom skill');
  }
  await registerProject(home, project); return { dir, home, project };
}
it('includes global, preserves old proven memory and custom content, backs up before changing managed contract', async () => {
  const { home, project } = await fixture();
  const result = await migrateWorkspaces(home);
  expect(result.some(r => r.root === home && r.status === 'migrated')).toBe(true);
  for (const root of [home, join(project, '.edu')]) {
    const brain = openBrain([{ scope: 'project', root }]);
    expect((await brain.list({ kind: 'lesson' }))[0]?.meta.status).toBe('proven');
    expect(await readFile(join(root, 'skills/custom/SKILL.md'), 'utf8')).toBe('custom skill');
    expect(await readFile(join(root, 'EDU.md'), 'utf8')).toContain('PRIVATE CUSTOM TEXT');
    expect(await readFile(join(root, 'EDU.md'), 'utf8')).toContain('edu:capabilities:start');
    expect((await readdir(join(root, 'backups'))).length).toBeGreaterThan(0);
  }
});
it('does not rewrite a completed migration on rerun', async () => {
  const { home } = await fixture(); await migrateWorkspaces(home);
  const before = await readFile(join(home, 'state/upgrade.json'), 'utf8');
  const backups = await readdir(join(home, 'backups'));
  await migrateWorkspaces(home, new Date('2030-01-01'));
  expect(await readFile(join(home, 'state/upgrade.json'), 'utf8')).toBe(before);
  expect(await readdir(join(home, 'backups'))).toEqual(backups);
});
it('isolates malformed project config without hiding failure or modifying it', async () => {
  const { home, project } = await fixture(); const config = join(project, '.edu/config.json');
  await writeFile(config, '{broken');
  const result = await migrateWorkspaces(home);
  expect(result.find(r => r.root === project)?.status).toBe('failed');
  expect(result.find(r => r.root === home)?.status).toBe('migrated');
  expect(await readFile(config, 'utf8')).toBe('{broken');
});
it('upgrades the 0.10.2 contract twice to a supplied 2.0 version without altering custom identity, brainDir, skills or note bytes', async () => {
  const { home, project } = await fixture();
  const oldContract = await readFile(new URL('./fixtures/EDU-0.10.2.md', import.meta.url), 'utf8');
  const custom = oldContract.replaceAll('{{name}}', 'PRIVATE Albert') + '\nCUSTOM POLICY: never export my notes.\n';
  const eduRoot = join(project, '.edu');
  const config = '{"brainDir":"01-CONOCIMIENTO","identity":{"name":"PRIVATE Albert"},"custom":{"keep":true}}\n';
  await writeFile(join(eduRoot, 'config.json'), config);
  const brainDir = join(project, '01-CONOCIMIENTO'); await mkdir(brainDir);
  const memory = '---\nid: legacy\ntier: transitive\ncustom_metadata: preserve-me\nusage:\n  wins: 10\n---\nPrivate memory bytes.\n';
  await writeFile(join(brainDir, 'custom-memory.md'), memory);
  for (const root of [home, eduRoot]) await writeFile(join(root, 'EDU.md'), custom);
  const first = await migrateWorkspaces(home, new Date('2026-10-20'), { version: '2.0.0' });
  expect(first.every(r => r.status === 'migrated')).toBe(true);
  const contract = await readFile(join(eduRoot, 'EDU.md'), 'utf8');
  expect(contract).not.toContain('**Protocol.** Start with');
  expect(contract).toContain('`edu_session_open(title, source)`');
  expect(contract).toContain('PRIVATE Albert');
  expect(contract).toContain('CUSTOM POLICY: never export my notes.');
  const withoutProtocol = (value: string) => value.replace(/\*\*Protocol\.\*\*[^]*?(?=\n\n)/, '');
  expect(withoutProtocol(contract.replace(/<!-- edu:capabilities:start -->[\s\S]*?<!-- edu:capabilities:end -->\n/, ''))).toBe(withoutProtocol(custom));
  expect(contract.indexOf('Installed Edu: 2.0.0')).toBeLessThan(contract.indexOf('<!-- /edu:core -->'));
  const state = await readFile(join(eduRoot, 'state/upgrade.json'), 'utf8');
  const backups = await readdir(join(eduRoot, 'backups'));
  const backup = join(eduRoot, 'backups', backups[0]!);
  expect(await readFile(join(backup, '0.bak'), 'utf8')).toBe(custom);
  expect(JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8')).version).toBe('2.0.0');
  const second = await migrateWorkspaces(home, new Date('2026-10-21'), { version: '2.0.0' });
  expect(second.every(r => r.status === 'migrated')).toBe(true);
  expect(await readFile(join(eduRoot, 'state/upgrade.json'), 'utf8')).toBe(state);
  expect(await readdir(join(eduRoot, 'backups'))).toEqual(backups);
  expect(await readFile(join(eduRoot, 'config.json'), 'utf8')).toBe(config);
  expect(await readFile(join(brainDir, 'custom-memory.md'), 'utf8')).toBe(memory);
  expect(await readFile(join(eduRoot, 'skills/custom/SKILL.md'), 'utf8')).toBe('custom skill');
  const registry = JSON.parse(await readFile(join(home, 'projects.json'), 'utf8'));
  expect(registry.projects[0].brain).toBe(brainDir);
});
it('fails closed before changing the contract when backups cannot be created', async () => {
  const { home } = await fixture(); const before = await readFile(join(home, 'EDU.md'), 'utf8');
  await writeFile(join(home, 'backups'), 'obstruction');
  const result = await migrateWorkspaces(home);
  expect(result.find(r => r.root === home)?.status).toBe('failed');
  expect(await readFile(join(home, 'EDU.md'), 'utf8')).toBe(before);
  await expect(readFile(join(home, 'state/upgrade.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it('refuses an older binary overwriting a newer migrated contract', async () => {
  const { home } = await fixture(); await migrateWorkspaces(home, new Date(), { version: '2.0.0' });
  const before = await readFile(join(home, 'EDU.md'), 'utf8');
  const report = await migrateWorkspaces(home, new Date(), { version: '0.10.2' });
  expect(report.find(r => r.root === home)).toMatchObject({ status: 'failed', detail: expect.stringContaining('Refusing to downgrade') });
  expect(await readFile(join(home, 'EDU.md'), 'utf8')).toBe(before);
});

it.skipIf(process.platform === 'win32')('preserves private contract permissions and restricts local backups', async () => {
  const { home } = await fixture(); await chmod(join(home, 'EDU.md'), 0o600);
  await migrateWorkspaces(home);
  expect((await stat(join(home, 'EDU.md'))).mode & 0o777).toBe(0o600);
  const directories = await readdir(join(home, 'backups'));
  const backup = join(home, 'backups', directories[0]!);
  expect((await stat(backup)).mode & 0o777).toBe(0o700);
  expect((await stat(join(backup, '0.bak'))).mode & 0o777).toBe(0o600);
});

it('rejects a custom legacy protocol without changing it or declaring refresh', async () => {
  const { home } = await fixture();
  const custom = '<!-- edu:core -->\n**Protocol.** Start with `edu_brief` and MY CUSTOM FLOW.\n<!-- /edu:core -->';
  await writeFile(join(home, 'EDU.md'), custom);
  const result = await migrateWorkspaces(home);
  expect(result.find(r => r.root === home)).toMatchObject({ status: 'failed', detail: expect.stringMatching(/manual conflict/i) });
  expect(await readFile(join(home, 'EDU.md'), 'utf8')).toBe(custom);
});

it('keeps the imported capabilities block bounded and full capabilities only in local JSON', async () => {
  const { home } = await fixture();
  await migrateWorkspaces(home);
  const text = await readFile(join(home, 'EDU.md'), 'utf8');
  const block = text.match(/<!-- edu:capabilities:start -->([^]*?)<!-- edu:capabilities:end -->/)![1]!;
  // Conservative character budget (~100 tokens); no tokenizer dependency.
  expect(block.length).toBeLessThanOrEqual(420);
  expect(block).toContain('state/capabilities.json');
  expect(block).toContain('edu capabilities --json');
  const caps = JSON.parse(await readFile(join(home, 'state/capabilities.json'), 'utf8'));
  expect(caps.features.length).toBeGreaterThan(0);
  expect(caps.commands.length).toBeGreaterThan(0);
  expect(text.startsWith('# Custom identity\nPRIVATE CUSTOM TEXT\n')).toBe(true);
});
