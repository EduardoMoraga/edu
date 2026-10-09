import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
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
