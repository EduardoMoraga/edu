import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveBrainLocations } from './locations.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it('finds the nearest project .edu and honors EDU_HOME for the global brain', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edu-locations-'));
  roots.push(root);
  await mkdir(join(root, '.edu'));
  await mkdir(join(root, 'nested', 'deep'), { recursive: true });
  const locations = await resolveBrainLocations(join(root, 'nested', 'deep'), { EDU_HOME: join(root, 'custom-global') });
  expect(locations).toEqual([
    { scope: 'project', root: join(root, '.edu') },
    { scope: 'global', root: join(root, 'custom-global') },
  ]);
});

describe('launchDirectory', () => {
  it('prefers the inherited PWD only when the process runs from a plugin folder', async () => {
    const { launchDirectory } = await import('./stdio.js');
    const { tmpdir } = await import('node:os');
    const home = tmpdir();
    expect(launchDirectory({ PWD: home }, '/x/.gemini/antigravity-cli/plugins/edu')).toBe(home);
    expect(launchDirectory({ PWD: home }, '/work/project')).toBe('/work/project');
    expect(launchDirectory({}, '/x/plugins/edu')).toBe('/x/plugins/edu');
  });
});

it('initializes a rebound workspace brain after a transient roots/list failure', async () => {
  const { resolveReboundLocations } = await import('./stdio.js');
  const root = await mkdtemp(join(tmpdir(), 'edu-rebound-'));
  roots.push(root);
  let attempts = 0;
  const locations = await resolveReboundLocations('/plugin/edu', { EDU_HOME: join(root, 'global') }, async () => {
    attempts++;
    if (attempts === 1) throw new Error('roots not ready');
    return [`file://${root}`];
  });
  expect(attempts).toBe(2);
  expect(locations?.[0]).toEqual({ scope: 'project', root: join(root, '.edu') });
  expect(await readFile(join(root, '.edu/EDU.md'), 'utf8')).toContain('Edu');
});
