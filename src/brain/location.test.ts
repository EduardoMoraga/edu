import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveBrainLocations } from '../mcp/locations.js';
import { openBrain } from './brain.js';
import { brainPath, readWorkspaceSettings, resolveBrainDir } from './location.js';

async function workspace(config?: Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), 'edu-loc-'));
  await mkdir(join(root, '.edu'), { recursive: true });
  if (config) await writeFile(join(root, '.edu', 'config.json'), JSON.stringify(config));
  return root;
}

describe('configurable brain directory', () => {
  it('defaults to <root>/brain when config has no brainDir', async () => {
    const root = await workspace({ version: 1 });
    const [project] = await resolveBrainLocations(root, { HOME: root, EDU_HOME: join(root, 'g') });
    expect(project).toEqual({ scope: 'project', root: join(root, '.edu') });
    expect(brainPath(project!)).toBe(join(root, '.edu', 'brain'));
  });

  it('resolves brainDir relative to the workspace root', async () => {
    const root = await workspace({ brainDir: '01-CONOCIMIENTO', identity: { name: 'Albert' } });
    const [project] = await resolveBrainLocations(join(root), { HOME: root, EDU_HOME: join(root, 'g') });
    expect(brainPath(project!)).toBe(join(root, '01-CONOCIMIENTO'));
    expect((await readWorkspaceSettings(join(root, '.edu'))).identity?.name).toBe('Albert');
  });

  it('rejects absolute or escaping brainDir values', () => {
    expect(() => resolveBrainDir('/w/.edu', '/etc')).toThrow(/brainDir/);
    expect(() => resolveBrainDir('/w/.edu', '../elsewhere')).toThrow(/brainDir/);
    expect(resolveBrainDir('/w/.edu', undefined)).toBe(join('/w/.edu', 'brain'));
  });

  it('writes notes and the index into the configured brain directory', async () => {
    const root = await workspace({ brainDir: 'KNOW' });
    const locations = await resolveBrainLocations(root, { HOME: root, EDU_HOME: join(root, 'g') });
    const brain = openBrain(locations);
    await brain.init(locations[0]!);
    const note = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Small PRs', body: 'x' });
    expect(note.path.startsWith(join(root, 'KNOW', '3-transitive'))).toBe(true);
    await brain.rebuildIndex();
    expect(await readFile(join(root, 'KNOW', '0-index', 'INDEX.md'), 'utf8')).toContain('Small PRs');
    expect(await readFile(join(root, 'KNOW', '0-index', 'Lessons.base'), 'utf8')).toContain('file.inFolder("KNOW/3-transitive")');
    expect((await brain.list()).map(n => n.meta.title)).toEqual(['Small PRs']);
  });
});

describe('Obsidian Bases', () => {
  it('filter by the folder relative to the enclosing vault and by note kind', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'edu-vault-'));
    await mkdir(join(vault, '.obsidian'), { recursive: true });
    const root = join(vault, '04-PROYECTOS', 'demo');
    await mkdir(join(root, '.edu'), { recursive: true });
    await writeFile(join(root, '.edu', 'config.json'), JSON.stringify({ brainDir: '01-CONOCIMIENTO' }));
    const locations = await resolveBrainLocations(root, { HOME: root, EDU_HOME: join(root, 'g') });
    const brain = openBrain(locations);
    await brain.init(locations[0]!);
    await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Small PRs', body: 'x' });
    await brain.rebuildIndex();
    const base = await readFile(join(root, '01-CONOCIMIENTO', '0-index', 'Lessons.base'), 'utf8');
    expect(base).not.toContain('formula.project');
    expect(base).toContain('file.inFolder("04-PROYECTOS/demo/01-CONOCIMIENTO/3-transitive")');
    expect(base).toContain('kind == "lesson"');
  });

  it('follow a symlinked global brain into the vault it really lives in', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'edu-vault-'));
    await mkdir(join(vault, '.obsidian'), { recursive: true });
    await mkdir(join(vault, '01-CONOCIMIENTO'), { recursive: true });
    const home = await mkdtemp(join(tmpdir(), 'edu-home-'));
    await mkdir(join(home, '.edu'), { recursive: true });
    const { symlink } = await import('node:fs/promises');
    await symlink(join(vault, '01-CONOCIMIENTO'), join(home, '.edu', 'brain'), process.platform === 'win32' ? 'junction' : 'dir');
    const brain = openBrain([{ scope: 'global', root: join(home, '.edu') }]);
    await brain.init({ scope: 'global', root: join(home, '.edu') });
    await brain.write({ tier: 'transitive', kind: 'hypothesis', title: 'H', body: 'x' });
    await brain.rebuildIndex();
    const base = await readFile(join(vault, '01-CONOCIMIENTO', '0-index', 'Hypotheses.base'), 'utf8');
    // A brain directly under the vault root is the orchestrator: it spans every workspace's tier folder.
    expect(base).toContain('file.path.contains("/3-transitive/")');
    expect(base).toContain('formula.project');
  });
});
