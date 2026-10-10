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
    expect(resolveBrainDir('/w/.edu', undefined)).toBe('/w/.edu/brain');
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
    expect(await readFile(join(root, 'KNOW', '0-index', 'Lessons.base'), 'utf8')).toContain('KNOW/3-transitive');
    expect((await brain.list()).map(n => n.meta.title)).toEqual(['Small PRs']);
  });
});
