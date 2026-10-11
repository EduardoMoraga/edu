import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readProjects, refreshProjects, registerProject } from './registry.js';

const dirs: string[] = [];
async function temp() { const path = await realpath(await mkdtemp(join(tmpdir(), 'edu-registry-'))); dirs.push(path); return path; }
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

const setBrainDir = async (workspace: string, brainDir: string) => {
  await mkdir(join(workspace, '.edu'), { recursive: true });
  await writeFile(join(workspace, '.edu', 'config.json'), JSON.stringify({ brainDir }));
};
const stored = async (home: string) => JSON.parse(await readFile(join(home, 'projects.json'), 'utf8')) as { projects: { brain: string }[] };

describe('project registry brain path', () => {
  it('registers the default brain, then follows a brainDir set afterwards', async () => {
    const home = await temp(), workspace = await temp();
    await mkdir(join(workspace, '.edu'), { recursive: true });
    expect((await registerProject(home, workspace)).brain).toBe(join(workspace, '.edu', 'brain'));
    await setBrainDir(workspace, '01-CONOCIMIENTO');
    expect((await readProjects(home)).projects[0]?.brain).toBe(join(workspace, '01-CONOCIMIENTO'));
  });

  it('updates the stored brain when an existing workspace is registered again', async () => {
    const home = await temp(), workspace = await temp();
    await mkdir(join(workspace, '.edu'), { recursive: true });
    await registerProject(home, workspace);
    await setBrainDir(workspace, '01-KNOWLEDGE');
    expect((await registerProject(home, workspace)).brain).toBe(join(workspace, '01-KNOWLEDGE'));
    expect((await stored(home)).projects[0]?.brain).toBe(join(workspace, '01-KNOWLEDGE'));
  });

  it('refreshes stale stored paths and keeps entries whose workspace is gone', async () => {
    const home = await temp(), workspace = await temp();
    await mkdir(join(workspace, '.edu'), { recursive: true });
    await registerProject(home, workspace);
    await setBrainDir(workspace, '01-KNOWLEDGE');
    const missing = { name: 'gone', root: join(workspace, 'nope'), brain: join(workspace, 'nope', '.edu', 'brain'), addedAt: new Date().toISOString() };
    const registry = await stored(home);
    await writeFile(join(home, 'projects.json'), JSON.stringify({ projects: [...registry.projects, missing] }));
    expect(await refreshProjects(home)).toEqual([expect.objectContaining({ brain: join(workspace, '01-KNOWLEDGE') })]);
    const after = await stored(home);
    expect(after.projects.map(entry => entry.brain)).toEqual([join(workspace, '01-KNOWLEDGE'), missing.brain]);
  });

  it('keeps the stored path when the workspace config has an invalid brainDir', async () => {
    const home = await temp(), workspace = await temp();
    await mkdir(join(workspace, '.edu'), { recursive: true });
    await registerProject(home, workspace);
    await setBrainDir(workspace, '../outside');
    expect((await readProjects(home)).projects[0]?.brain).toBe(join(workspace, '.edu', 'brain'));
  });
});
