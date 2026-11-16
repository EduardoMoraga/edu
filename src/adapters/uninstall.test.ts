import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyInstall, getManifestPath, planInstall, uninstall } from './installer.js';
import { packageTemplatesDir } from '../platform/package.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'edu-uninstall-edits-'));
  dirs.push(base);
  const root = join(base, 'project');
  const home = join(base, 'home');
  await Promise.all([mkdir(root), mkdir(home)]);
  return { root, home, templatesDir: packageTemplatesDir() };
}
async function put(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
const json = async (path: string) => JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;
const missing = (path: string) => access(path).then(() => false, () => true);

describe('default uninstall keeps edits made after install (C1)', () => {
  it('removes only Edu keys from every global JSON target and keeps later user and host edits', async () => {
    const opts = await fixture();
    const claudeJson = join(opts.home, '.claude.json');
    const settings = join(opts.home, '.claude/settings.json');
    const opencode = join(opts.home, '.config/opencode/opencode.json');
    const pi = join(opts.home, '.pi/agent/mcp.json');
    await put(claudeJson, '{"numStartups":1}');
    await put(settings, '{\n  "permissions": { "allow": ["Bash(ls)"] }\n}\n');
    await put(opencode, '{\n  // mine\n  "theme": "tokyo"\n}\n');
    await put(pi, '{"mcpServers":{"other":{"command":"other"}}}\n');
    await applyInstall(await planInstall({ ...opts, scope: 'global', clis: ['claude', 'opencode', 'pi'] }));

    // After install the user signs in, allows a tool and adds MCP servers.
    const state = await json(claudeJson);
    await writeFile(claudeJson, JSON.stringify({ ...state, oauthAccount: { emailAddress: 'me@example.com' } }));
    const allowed = await json(settings);
    allowed.permissions.allow.push('Bash(git status)');
    await writeFile(settings, `${JSON.stringify(allowed, null, 2)}\n`);
    await writeFile(opencode, (await readFile(opencode, 'utf8')).replace('"theme": "tokyo"', '"theme": "tokyo",\n  "mcp_later": { "added": true }'));
    const piState = await json(pi);
    piState.mcpServers.later = { command: 'later' };
    await writeFile(pi, JSON.stringify(piState));

    await uninstall({ manifestPath: getManifestPath('global', opts.root, opts.home) });

    expect(await json(claudeJson)).toEqual({ numStartups: 1, oauthAccount: { emailAddress: 'me@example.com' } });
    expect(await json(settings)).toEqual({ permissions: { allow: ['Bash(ls)', 'Bash(git status)'] } });
    const opencodeText = await readFile(opencode, 'utf8');
    expect(opencodeText).toContain('// mine');
    expect(opencodeText).toContain('"mcp_later"');
    expect(opencodeText).not.toMatch(/"edu"|"agent"/);
    expect(await json(pi)).toEqual({ mcpServers: { other: { command: 'other' }, later: { command: 'later' } } });
  });

  it('removes only Edu keys from project JSON targets edited after install', async () => {
    const opts = await fixture();
    const settings = join(opts.root, '.claude/settings.json');
    const mcp = join(opts.root, '.mcp.json');
    const opencode = join(opts.root, 'opencode.json');
    await put(settings, '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"say done"}]}]}}\n');
    await put(opencode, '{ "theme": "tokyo" }\n');
    const manifest = await applyInstall(await planInstall({ ...opts, scope: 'project', clis: ['claude', 'opencode'] }));
    expect(manifest.actions.find(action => action.path === mcp)?.backup).toBeUndefined();
    await writeFile(settings, JSON.stringify({ ...await json(settings), permissions: { deny: ['Read(.env)'] } }));
    await writeFile(mcp, JSON.stringify({ mcpServers: { ...(await json(mcp)).mcpServers, mine: { command: 'mine' } } }));
    await writeFile(opencode, JSON.stringify({ ...await json(opencode), mcp: { ...(await json(opencode)).mcp, later: { type: 'local', command: ['later'] } } }));
    await uninstall({ manifestPath: getManifestPath('project', opts.root, opts.home) });
    expect(await json(settings)).toEqual({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] }, permissions: { deny: ['Read(.env)'] } });
    expect(await json(mcp)).toEqual({ mcpServers: { mine: { command: 'mine' } } });
    expect(await json(opencode)).toEqual({ theme: 'tokyo', mcp: { later: { type: 'local', command: ['later'] } } });
  });

  it('still restores the exact install-time snapshot when nothing changed since install', async () => {
    const opts = await fixture();
    const settings = join(opts.home, '.claude/settings.json');
    const original = '{\n    "theme":   "dark"\n}';
    await put(settings, original);
    await applyInstall(await planInstall({ ...opts, scope: 'global', clis: ['claude'] }));
    await uninstall({ manifestPath: getManifestPath('global', opts.root, opts.home) });
    expect(await readFile(settings, 'utf8')).toBe(original);
  });
});

describe('drift covers only Edu\'s own part (M2)', () => {
  it('reinstalls and uninstalls cleanly after the user adds lines outside the Edu block', async () => {
    const opts = await fixture();
    const target = join(opts.root, 'CLAUDE.md');
    await put(target, '# Mine\n');
    await applyInstall(await planInstall({ ...opts, scope: 'project', clis: ['claude'] }));
    await writeFile(target, `${await readFile(target, 'utf8')}\nAdded below Edu.\n`);
    await expect(applyInstall(await planInstall({ ...opts, scope: 'project', clis: ['claude'] }))).resolves.toBeDefined();
    await uninstall({ manifestPath: getManifestPath('project', opts.root, opts.home) });
    const text = await readFile(target, 'utf8');
    expect(text).toContain('# Mine');
    expect(text).toContain('Added below Edu.');
    expect(text).not.toContain('edu:core');
  });

  it('accepts an Edu 5.x record (whole-file hash only) with a user line outside the block', async () => {
    const opts = await fixture();
    const target = join(opts.root, 'CLAUDE.md');
    await put(target, '# Mine\n');
    const manifestPath = getManifestPath('project', opts.root, opts.home);
    await applyInstall(await planInstall({ ...opts, scope: 'project', clis: ['claude'] }));
    const stored = await json(manifestPath);
    for (const action of stored.actions) delete action.blockSha256;
    await writeFile(manifestPath, JSON.stringify(stored));
    await writeFile(target, `Above Edu.\n${await readFile(target, 'utf8')}`);
    const upgraded = await applyInstall(await planInstall({ ...opts, scope: 'project', clis: ['claude'] }));
    expect((upgraded.actions.find(action => action.path === target) as { blockSha256?: string }).blockSha256).toMatch(/^[0-9a-f]{64}$/);
    await writeFile(target, (await readFile(target, 'utf8')).replace('Reuse an injected Edu brief', 'Reuse an EDITED brief'));
    await expect(uninstall({ manifestPath })).rejects.toThrow(/drift.*CLAUDE\.md/);
  });

  it('ignores Codex rewriting config.toml (trust entries) and keeps them on uninstall', async () => {
    const opts = await fixture();
    const config = join(opts.home, '.codex/config.toml');
    await put(config, 'model = "gpt-x"\n');
    await applyInstall(await planInstall({ ...opts, scope: 'global', clis: ['codex'] }));
    await writeFile(config, `${await readFile(config, 'utf8')}\n[projects."/work/app"]\ntrust_level = "trusted"\n`);
    await expect(applyInstall(await planInstall({ ...opts, scope: 'project', clis: ['codex'] }))).resolves.toBeDefined();
    await uninstall({ manifestPath: getManifestPath('project', opts.root, opts.home) });
    await uninstall({ manifestPath: getManifestPath('global', opts.root, opts.home) });
    const text = await readFile(config, 'utf8');
    expect(text).toContain('model = "gpt-x"');
    expect(text).toContain('[projects."/work/app"]');
    expect(text).not.toContain('edu');
  });
});

describe('uninstall is one transaction (M1)', () => {
  it('rolls every file back when a step fails, so the retry is not reported as drift', async () => {
    const opts = await fixture();
    const agents = join(opts.root, 'AGENTS.md');
    const claude = join(opts.root, 'CLAUDE.md');
    await put(agents, 'Agents rules\n');
    await put(claude, 'Claude rules\n');
    const manifestPath = getManifestPath('project', opts.root, opts.home);
    const manifest = await applyInstall(await planInstall({ ...opts, scope: 'project', clis: ['claude', 'codex'] }));
    const installed = { agents: await readFile(agents, 'utf8'), claude: await readFile(claude, 'utf8'), manifest: await readFile(manifestPath, 'utf8') };
    // Uninstall reverts in reverse order; the CLAUDE.md backup is restored after other files changed.
    const backup = manifest.actions.find(action => action.path === claude)!.backup!;
    await rm(backup);
    await mkdir(backup);
    await expect(uninstall({ manifestPath })).rejects.toThrow();
    expect(await readFile(agents, 'utf8')).toBe(installed.agents);
    expect(await readFile(claude, 'utf8')).toBe(installed.claude);
    expect(await readFile(manifestPath, 'utf8')).toBe(installed.manifest);
    await rm(backup, { recursive: true });
    await writeFile(backup, 'Claude rules\n');
    await uninstall({ manifestPath });
    expect(await readFile(agents, 'utf8')).toBe('Agents rules\n');
    expect(await readFile(claude, 'utf8')).toBe('Claude rules\n');
    expect(await missing(manifestPath)).toBe(true);
  });
});

describe('uninstall cleans up what install created', () => {
  it('leaves no empty ~/.edu after a global install and uninstall', async () => {
    const opts = await fixture();
    await put(join(opts.home, '.codex/config.toml'), 'model = "gpt-x"\n');
    await put(join(opts.home, '.claude/settings.json'), '{"theme":"dark"}\n');
    await applyInstall(await planInstall({ ...opts, scope: 'global', clis: ['claude', 'codex'] }));
    expect(await readFile(join(opts.home, '.edu/shared-backups/.gitignore'), 'utf8')).toBe('*\n');
    await uninstall({ manifestPath: getManifestPath('global', opts.root, opts.home) });
    expect(await missing(join(opts.home, '.edu'))).toBe(true);
    expect(await readFile(join(opts.home, '.codex/config.toml'), 'utf8')).toBe('model = "gpt-x"\n');
  });

  it('git-ignores project backups and removes them with the install', async () => {
    const opts = await fixture();
    await put(join(opts.root, 'CLAUDE.md'), 'Mine\n');
    await applyInstall(await planInstall({ ...opts, scope: 'project', clis: ['claude'] }));
    expect(await readFile(join(opts.root, '.edu/backups/.gitignore'), 'utf8')).toBe('*\n');
    await uninstall({ manifestPath: getManifestPath('project', opts.root, opts.home) });
    expect(await missing(join(opts.root, '.edu'))).toBe(true);
  });
});
