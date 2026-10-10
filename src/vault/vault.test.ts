import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isUnsafeVaultPath, createVault, checkVault, registerObsidianVault } from './vault.js';
import { readProjects, registerProject } from './registry.js';

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'edu-vault-'));
  roots.push(root);
  const home = join(root, 'home');
  const eduHome = join(home, '.edu');
  await mkdir(eduHome, { recursive: true });
  return { root, home, eduHome };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('vault safety', () => {
  it.each([
    ['/Users/ada', '/Users/ada', 'darwin', true],
    ['/Users', '/Users/ada', 'darwin', true],
    ['/Users/ada/Library/Notes', '/Users/ada', 'darwin', true],
    ['/Users/ada/.config/vault', '/Users/ada', 'linux', true],
    ['/etc/obsidian', '/Users/ada', 'linux', true],
    ['/Users/ada/EduVault', '/Users/ada', 'darwin', false],
    ['C:\\Users\\Ada', 'C:\\Users\\Ada', 'win32', true],
    ['C:\\', 'C:\\Users\\Ada', 'win32', true],
    ['C:\\Users\\Ada\\AppData\\Roaming', 'C:\\Users\\Ada', 'win32', true],
    ['C:\\Program Files\\vault', 'C:\\Users\\Ada', 'win32', true],
    ['C:\\ProgramData\\vault', 'C:\\Users\\Ada', 'win32', true],
    ['C:\\Users\\Ada\\EduVault', 'C:\\Users\\Ada', 'win32', false],
  ] as const)('classifies %s', (path, home, platform, unsafe) => {
    expect(isUnsafeVaultPath(path, home, platform)).toBe(unsafe);
  });
});

describe('project registry and vault', () => {
  it('registers projects idempotently and keeps missing roots visible', async () => {
    const f = await fixture();
    const project = join(f.root, 'project');
    await mkdir(join(project, '.edu', 'brain'), { recursive: true });
    await registerProject(f.eduHome, project);
    await registerProject(f.eduHome, project);
    const projects = await readProjects(f.eduHome);
    expect(projects.projects).toHaveLength(1);
    const canonical = await realpath(project);
    expect(projects.projects[0]).toMatchObject({ name: 'project', root: canonical, brain: join(canonical, '.edu', 'brain') });
    await rm(project, { recursive: true });
    expect((await readProjects(f.eduHome)).projects).toHaveLength(1);
  });

  it('creates links, preserves user text on rerun, reports conflicts and missing projects', async () => {
    const f = await fixture();
    const project = join(f.root, 'project');
    await mkdir(join(project, '.edu', 'brain'), { recursive: true });
    await writeFile(join(project, '.edu', 'brain', 'note.md'), 'note');
    await mkdir(join(f.eduHome, 'brain'), { recursive: true });
    await registerProject(f.eduHome, project);
    const vault = join(f.home, 'EduVault');
    const first = await createVault({ path: vault, home: f.home, eduHome: f.eduHome, register: false });
    expect(first.conflicts).toEqual([]);
    expect(await readFile(join(vault, 'Home.md'), 'utf8')).toContain('[[Edu/project/0-index/INDEX]]');
    expect((await readdir(join(vault, 'Edu'))).sort()).toEqual(['_global', 'project']);
    await writeFile(join(vault, 'Home.md'), `Custom intro\n<!-- edu:projects -->\nold\n<!-- /edu:projects -->\nCustom ending\n`);
    const second = await createVault({ path: vault, home: f.home, eduHome: f.eduHome, register: false });
    expect(second.conflicts).toEqual([]);
    const home = await readFile(join(vault, 'Home.md'), 'utf8');
    expect(home).toMatch(/^Custom intro\n/);
    expect(home).toMatch(/Custom ending\n$/);
    expect(home).not.toContain('old');
    const check = await checkVault({ path: vault, home: f.home, eduHome: f.eduHome });
    expect(check.links.find(link => link.name === 'project')?.notes).toBe(1);
    await rm(join(vault, 'Edu', 'project'));
    await symlink(join(f.root, 'different'), join(vault, 'Edu', 'project'));
    const third = await createVault({ path: vault, home: f.home, eduHome: f.eduHome, register: false });
    expect(third.conflicts).toHaveLength(1);
    await rm(project, { recursive: true });
    expect((await checkVault({ path: vault, home: f.home, eduHome: f.eduHome })).missingProjects).toEqual(['project']);
  });

  it('refuses unrelated nonempty folders and project roots', async () => {
    const f = await fixture();
    const unrelated = join(f.home, 'Other');
    await mkdir(unrelated);
    await writeFile(join(unrelated, 'private.md'), 'private');
    await expect(createVault({ path: unrelated, home: f.home, eduHome: f.eduHome, register: false })).rejects.toThrow('not an Edu vault');
    const project = join(f.home, 'Project');
    await mkdir(join(project, '.edu'), { recursive: true });
    await expect(createVault({ path: project, home: f.home, eduHome: f.eduHome, register: false })).rejects.toThrow('project brain');
  });

  it('refuses a new vault beneath a symlink into a protected folder', async () => {
    const f = await fixture();
    const library = join(f.home, 'Library');
    await mkdir(library);
    await symlink(library, join(f.home, 'safe-looking'));
    await expect(createVault({ path: join(f.home, 'safe-looking', 'EduVault'), home: f.home, eduHome: f.eduHome, register: false }))
      .rejects.toThrow('Unsafe vault path');
  });

  it('registers an Obsidian vault with a backup and does not duplicate it', async () => {
    const f = await fixture();
    const config = join(f.home, '.config', 'obsidian');
    await mkdir(config, { recursive: true });
    await writeFile(join(config, 'obsidian.json'), JSON.stringify({ vaults: {} }));
    const vault = join(f.home, 'EduVault');
    await mkdir(vault);
    const result = await registerObsidianVault(vault, { home: f.home, platform: 'linux', env: {}, now: new Date('2026-10-09T12:00:00Z') });
    expect(result).toBe('registered');
    expect((await readdir(config)).some(name => name.startsWith('obsidian.json.2026-10-09T12-00-00'))).toBe(true);
    expect(Object.values(JSON.parse(await readFile(join(config, 'obsidian.json'), 'utf8')).vaults)).toEqual([expect.objectContaining({ path: vault })]);
    expect(await registerObsidianVault(vault, { home: f.home, platform: 'linux', env: {} })).toBe('already registered');
  });

  it('reports broken links and a large generated notes folder without deleting it', async () => {
    const f = await fixture();
    const project = join(f.root, 'project');
    await mkdir(join(project, '.edu', 'brain'), { recursive: true });
    await registerProject(f.eduHome, project);
    const vault = join(f.home, 'EduVault');
    await createVault({ path: vault, home: f.home, eduHome: f.eduHome, register: false });
    await rm(join(vault, 'Edu', 'project'));
    const generated = join(vault, 'Generated');
    await mkdir(generated);
    await Promise.all(Array.from({ length: 20 }, (_, i) => writeFile(join(generated, `${i}.md`), 'auto')));
    const report = await checkVault({ path: vault, home: f.home, eduHome: f.eduHome });
    expect(report.links.find(link => link.name === 'project')?.state).toBe('broken');
    expect(report.warnings[0]).toContain('another tool may be writing generated notes');
    expect((await readdir(generated))).toHaveLength(20);
  });
});
