import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eduMcpLaunch } from '../platform/index.js';
import { codexMcpEntry, MCP_FORWARDED_ENV } from '../platform/child-env.js';
import { applyInstall, planInstall, resolveTemplatesDir } from './installer.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'edu-codex-'));
  dirs.push(base);
  const root = join(base, 'project');
  const home = join(base, 'home');
  await Promise.all([mkdir(root), mkdir(home)]);
  return { root, home, templatesDir: resolveTemplatesDir() };
}

/** The `[mcp_servers.edu]` table of a config.toml, one `key = value` per line. */
function eduTable(toml: string): Record<string, unknown> {
  const table = /^\[mcp_servers\.edu\]\n((?:[^[\n].*\n?)*)/m.exec(toml)?.[1] ?? '';
  return Object.fromEntries(table.split('\n').filter(line => line.includes(' = ')).map(line => {
    const [key, value] = line.split(/ = (.*)/s) as [string, string];
    return [key.trim(), JSON.parse(value)];
  }));
}

describe('Codex config.toml', () => {
  it.each(['linux', 'win32'] as const)('forwards EDU_CREW_JOB to the Edu MCP server like the Codex plugin does (%s)', async platform => {
    const opts = await fixture();
    await applyInstall(await planInstall({ ...opts, scope: 'global', clis: ['codex'], platform }));
    const table = eduTable(await readFile(join(opts.home, '.codex', 'config.toml'), 'utf8'));
    // One source for both install paths: the plugin's .mcp.json is built from codexMcpEntry too.
    expect(table).toEqual(codexMcpEntry(eduMcpLaunch(platform)));
    expect(table.env_vars).toEqual([...MCP_FORWARDED_ENV]);
    expect(table.env_vars).toContain('EDU_CREW_JOB');
  });
});
