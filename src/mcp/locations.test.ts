import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveBrainLocations } from '../brain/locations.js';

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

it('rebinds to the brain a client root already holds after a transient roots/list failure, creating nothing', async () => {
  const { resolveReboundLocations } = await import('./stdio.js');
  const root = await mkdtemp(join(tmpdir(), 'edu-rebound-'));
  roots.push(root);
  let attempts = 0;
  // The ceiling keeps the search out of the real home: on Windows tmpdir() sits under it, next to a real ~/.edu.
  const env = { EDU_HOME: join(root, 'global'), EDU_CEILING_DIRECTORIES: tmpdir() };
  const listRoots = async () => {
    attempts++;
    if (attempts === 1) throw new Error('roots not ready');
    return [pathToFileURL(root).href];
  };
  // A root without a brain gets the global brain; MCP roots never create a project brain.
  expect(await resolveReboundLocations('/plugin/edu', env, listRoots)).toEqual([{ scope: 'global', root: join(root, 'global') }]);
  expect(attempts).toBe(2);
  await expect(readFile(join(root, '.edu/EDU.md'), 'utf8')).rejects.toThrow();
  await mkdir(join(root, '.edu'));
  expect((await resolveReboundLocations('/plugin/edu', env, listRoots))?.[0]).toEqual({ scope: 'project', root: join(root, '.edu') });
});

it('reports roots that are not ready yet so the server asks again later', async () => {
  const { resolveReboundLocations, RootsNotReady } = await import('./stdio.js');
  await expect(resolveReboundLocations('/plugin/edu', {}, async () => [])).rejects.toBeInstanceOf(RootsNotReady);
});

it('recognizes the global brain reached while walking ancestors instead of calling it a project', async () => {
  const home = await mkdtemp(join(tmpdir(), 'edu-global-ancestor-')); roots.push(home);
  await mkdir(join(home, '.edu')); await mkdir(join(home, 'Projects', 'uninitialized'), { recursive: true });
  const locations = await resolveBrainLocations(join(home, 'Projects', 'uninitialized'), { HOME: home });
  expect(locations).toEqual([{ scope: 'global', root: join(home, '.edu') }]);
});

it('does not duplicate the global brain when a client root is HOME itself', async () => {
  const { resolveReboundLocations } = await import('./stdio.js');
  const home = await mkdtemp(join(tmpdir(), 'edu-rebound-home-')); roots.push(home);
  await mkdir(join(home, '.edu'));
  const locations = await resolveReboundLocations(join(home, 'plugin'), { HOME: home }, async () => [pathToFileURL(home).href]);
  expect(locations).toEqual([{ scope: 'global', root: join(home, '.edu') }]);
});
