import { readFile, readdir } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { packageVersion } from '../platform/package.js';

// package.json is the single source of the release version. Plugin manifests are generated from it
// (npm run build:plugins); a manifest left behind would ship one version under another's name.
const ROOT = join(import.meta.dirname, '..', '..');
const KNOWN = ['.claude-plugin/marketplace.json', 'plugins/agy/plugin.json', 'plugins/claude-code/.claude-plugin/plugin.json', 'plugins/codex/.codex-plugin/plugin.json'];

async function jsonFiles(dir: string): Promise<string[]> {
  const entries = await readdir(join(ROOT, dir), { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map(async entry => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : jsonFiles(path);
    return entry.name.endsWith('.json') ? [path] : [];
  }));
  return nested.flat();
}

/** Every `version` a manifest declares for Edu: its own, and each listed plugin's. */
async function manifestVersions(): Promise<Array<[string, string]>> {
  const files = (await Promise.all(['.claude-plugin', '.agents/plugins', 'plugins'].map(jsonFiles))).flat();
  const found: Array<[string, string]> = [];
  for (const file of files) {
    const json = JSON.parse(await readFile(join(ROOT, file), 'utf8')) as { version?: unknown; plugins?: Array<{ name?: string; version?: unknown }> };
    if (typeof json.version === 'string') found.push([file, json.version]);
    for (const plugin of json.plugins ?? []) if (typeof plugin.version === 'string') found.push([`${file} (${plugin.name ?? 'plugin'})`, plugin.version]);
  }
  return found;
}

describe('release version', () => {
  it('reads the CLI version from package.json', async () => {
    const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as { version: string };
    expect(packageVersion()).toBe(pkg.version);
  });

  it('gives every plugin manifest the package.json version', async () => {
    const versions = await manifestVersions();
    expect(versions.map(([file]) => file.split(' ')[0]!.split(sep).join('/'))).toEqual(expect.arrayContaining(KNOWN));
    expect(versions.filter(([, version]) => version !== packageVersion()), 'run npm run build:plugins').toEqual([]);
  });

  it('does not pin the release version in the upgrade smoke', async () => {
    const smoke = await readFile(join(ROOT, 'scripts', 'smoke-upgrade.mjs'), 'utf8');
    expect(smoke, 'scripts/smoke-upgrade.mjs must read the version from package.json').not.toContain(`'${packageVersion()}'`);
  });
});
