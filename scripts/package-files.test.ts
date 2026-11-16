import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import spawn from 'cross-spawn';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// What `npm pack` would publish, from the committed dist/ (no build, no network, no real HOME).
let files: string[] = [];
let home: string;
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'edu-pack-'));
  const result = spawn.sync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, npm_config_cache: join(home, 'npm-cache'), npm_config_update_notifier: 'false' },
  });
  expect(result.status, result.stderr).toBe(0);
  files = (JSON.parse(result.stdout) as Array<{ files: Array<{ path: string }> }>)[0]!.files.map(file => file.path);
}, 60_000);
afterAll(async () => { await rm(home, { recursive: true, force: true }); });

describe('published package', () => {
  it('ships the CLI, the library entry and its types', () => {
    expect(files).toEqual(expect.arrayContaining(['dist/cli.js', 'dist/index.js', 'dist/index.d.ts', 'package.json', 'README.md', 'LICENSE']));
  });

  it('leaves out source maps and tests', () => {
    expect(files.filter(path => path.endsWith('.map'))).toEqual([]);
    expect(files.filter(path => /\.test\.tsx?$/.test(path))).toEqual([]);
  });
});
