import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findPackageRoot, packageRoot, packageTemplatesDir, packageVersion } from './package.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe('package root', () => {
  it('walks up to the nearest edu-agent package.json, skipping other packages and unreadable manifests', async () => {
    const base = await mkdtemp(join(tmpdir(), 'edu-pkg-'));
    dirs.push(base);
    await writeFile(join(base, 'package.json'), JSON.stringify({ name: 'edu-agent', version: '9.1.0' }));
    await mkdir(join(base, 'node_modules', 'dep', 'dist'), { recursive: true });
    await writeFile(join(base, 'node_modules', 'dep', 'package.json'), JSON.stringify({ name: 'dep', version: '1.0.0' }));
    await writeFile(join(base, 'node_modules', 'package.json'), '{ not json');
    expect(findPackageRoot(join(base, 'node_modules', 'dep', 'dist'))).toEqual({ root: base, version: '9.1.0' });
  });

  it('fails clearly outside any edu-agent package', async () => {
    const base = await mkdtemp(join(tmpdir(), 'edu-pkg-'));
    dirs.push(base);
    expect(() => findPackageRoot(base)).toThrow('Could not locate the edu-agent package root');
  });

  it('reports the running package: its root, version and templates', async () => {
    const pkg = JSON.parse(await readFile(join(packageRoot(), 'package.json'), 'utf8')) as { name: string; version: string };
    expect(pkg.name).toBe('edu-agent');
    expect(packageVersion()).toBe(pkg.version);
    expect(packageTemplatesDir()).toBe(join(packageRoot(), 'templates'));
  });
});
