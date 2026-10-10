import { eduMcpLaunch } from '../platform/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planInstall, applyInstall, uninstall, resolveTemplatesDir, getManifestPath } from './installer.js';
import { diagnose } from './doctor.js';
import { pathsFor } from './paths.js';
import { createClaudeIntegration } from './claude.js';

const dirs: string[] = [];
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'edu-adapters-'));
  dirs.push(base);
  const root = join(base, 'project');
  const home = join(base, 'home');
  await Promise.all([mkdir(root), mkdir(home)]);
  return { root, home, templatesDir: resolveTemplatesDir() };
}
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('installer', () => {
  it('plans each CLI without writing and deduplicates shared targets', async () => {
    const opts = await fixture();
    const plan = await planInstall({ ...opts, scope: 'project', clis: ['claude', 'codex', 'pi', 'opencode', 'agy'] });
    expect(plan.actions.filter(a => a.path === join(opts.root, 'AGENTS.md') && a.kind === 'managed-block')).toHaveLength(1);
    expect(plan.actions.filter(a => a.path.endsWith(join('edu-brain', 'SKILL.md')))).toHaveLength(2);
    expect(plan.notes).toContain('agy MCP: manual step');
    expect(plan.actions.some(a => a.cli === 'agy' && a.kind === 'json-merge')).toBe(false);
    expect(plan.actions.some(a => a.cli === 'opencode' && a.path === join(opts.root, 'opencode.json'))).toBe(true);
    expect(plan.actions.some(a => a.cli === 'claude' && a.path === join(opts.root, '.mcp.json'))).toBe(true);
    expect(plan.actions.some(a => a.cli === 'codex' && a.path === join(opts.home, '.codex/config.toml'))).toBe(true);
    expect(plan.actions.some(a => a.cli === 'pi' && a.path === join(opts.home, '.pi/agent/mcp.json'))).toBe(true);
    await expect(readFile(join(opts.root, 'AGENTS.md'))).rejects.toThrow();
  });

  it('round-trips user files and stays idempotent across installs', async () => {
    const opts = await fixture();
    const original = {
      claude: '# User instructions\n\nNever change this.\n',
      settings: '{\n  "hooks": {"SessionStart": [{"matcher":"user"}]}\n}\n',
      toml: '[mcp_servers.other]\ncommand = "other"\n',
    };
    await mkdir(join(opts.root, '.claude'), { recursive: true });
    await mkdir(join(opts.home, '.codex'), { recursive: true });
    await writeFile(join(opts.root, 'CLAUDE.md'), original.claude);
    await writeFile(join(opts.root, '.claude/settings.json'), original.settings);
    await writeFile(join(opts.home, '.codex/config.toml'), original.toml);
    const plan = await planInstall({ ...opts, scope: 'project', clis: ['claude', 'codex'] });
    const manifest = await applyInstall(plan);
    const first = await readFile(join(opts.root, 'CLAUDE.md'), 'utf8');
    await applyInstall(await planInstall({ ...opts, scope: 'project', clis: ['claude', 'codex'] }));
    expect(await readFile(join(opts.root, 'CLAUDE.md'), 'utf8')).toBe(first);
    await uninstall({ manifestPath: join(opts.root, '.edu/manifest.json') });
    expect(await readFile(join(opts.root, 'CLAUDE.md'), 'utf8')).toBe(original.claude);
    expect(await readFile(join(opts.root, '.claude/settings.json'), 'utf8')).toBe(original.settings);
    expect(await readFile(join(opts.home, '.codex/config.toml'), 'utf8')).toBe(original.toml);
    expect(manifest.actions.length).toBeGreaterThan(0);
  });

  it('refuses drift without force', async () => {
    const opts = await fixture();
    await applyInstall(await planInstall({ ...opts, scope: 'project', clis: ['claude'] }));
    await writeFile(join(opts.root, 'CLAUDE.md'), 'changed');
    await expect(uninstall({ manifestPath: join(opts.root, '.edu/manifest.json') })).rejects.toThrow(/drift/i);
    expect(await readFile(join(opts.root, 'CLAUDE.md'), 'utf8')).toBe('changed');
    await uninstall({ manifestPath: join(opts.root, '.edu/manifest.json'), force: true });
    expect(await readFile(join(opts.root, 'CLAUDE.md'), 'utf8')).toBe('changed');
  });

  it('force-uninstalls only Edu-managed regions and preserves later user edits', async () => {
    const opts = await fixture();
    const target = join(opts.root, 'CLAUDE.md');
    await writeFile(target, '# User start\n');
    const manifestPath = join(opts.root, '.edu/manifest.json');
    await applyInstall(await planInstall({ ...opts, scope: 'project', clis: ['claude'] }));
    await writeFile(target, `${await readFile(target, 'utf8')}\n# Added later by user\n`);
    await uninstall({ manifestPath, force: true });
    const finalText = await readFile(target, 'utf8');
    expect(finalText).toContain('# User start');
    expect(finalText).toContain('# Added later by user');
    expect(finalText).not.toContain('<!-- edu:core:start -->');
  });

  it('force-uninstalls Edu JSON entries without restoring a stale whole-file backup', async () => {
    const opts = await fixture();
    const settings = join(opts.root, '.claude/settings.json');
    await mkdir(join(opts.root, '.claude'), { recursive: true });
    await writeFile(settings, '{"hooks":{"SessionStart":[{"matcher":"user"}]}}\n');
    const manifestPath = join(opts.root, '.edu/manifest.json');
    await applyInstall(await planInstall({ ...opts, scope: 'project', clis: ['claude'] }));
    const current = JSON.parse(await readFile(settings, 'utf8')) as Record<string, unknown>;
    current.custom = { preserved: true };
    await writeFile(settings, `${JSON.stringify(current)}\n`);
    await uninstall({ manifestPath, force: true });
    const final = JSON.parse(await readFile(settings, 'utf8')) as { hooks: { SessionStart: unknown[] }; custom: { preserved: boolean } };
    expect(final.custom).toEqual({ preserved: true });
    expect(final.hooks.SessionStart).toEqual([{ matcher: 'user' }]);
  });

  it('keeps an empty JSON inverse when force removal finds deleted preinstall keys', async () => {
    const opts = await fixture();
    const settings = join(opts.root, '.claude/settings.json');
    await mkdir(join(opts.root, '.claude'), { recursive: true });
    await writeFile(settings, '{"hooks":{"SessionStart":[{"matcher":"user"}]}}\n');
    const manifestPath = join(opts.root, '.edu/manifest.json');
    const manifest = await applyInstall(await planInstall({ ...opts, scope: 'project', clis: ['claude'] }));
    const action = manifest.actions.find(item => item.path === settings)! as typeof manifest.actions[number] & { jsonPatch?: Record<string, unknown> };
    expect(action.jsonPatch).toBeDefined();
    await writeFile(settings, `${JSON.stringify(action.jsonPatch)}\n`);
    await uninstall({ manifestPath, force: true });
    expect(JSON.parse(await readFile(settings, 'utf8'))).toEqual({});
  });

  it('keeps an empty shared JSON inverse after the final owner is force-uninstalled', async () => {
    const opts = await fixture();
    const target = join(opts.home, '.pi/agent/mcp.json');
    await mkdir(join(opts.home, '.pi/agent'), { recursive: true });
    await writeFile(target, '{"mcpServers":{"user":{"command":"user"}}}\n');
    const projectManifest = join(opts.root, '.edu/manifest.json');
    const globalManifest = join(opts.home, '.edu/manifest.json');
    await applyInstall(await planInstall({ ...opts, scope: 'project', clis: ['pi'] }));
    const global = await applyInstall(await planInstall({ ...opts, scope: 'global', clis: ['pi'] }));
    const action = global.actions.find(item => item.path === target)! as typeof global.actions[number] & { jsonPatch?: Record<string, unknown> };
    expect(action.jsonPatch).toBeDefined();
    await writeFile(target, `${JSON.stringify(action.jsonPatch)}\n`);
    await uninstall({ manifestPath: projectManifest, force: true });
    await uninstall({ manifestPath: globalManifest, force: true });
    expect(JSON.parse(await readFile(target, 'utf8'))).toEqual({});
  });

  it('keeps an empty shared TOML inverse after the final owner is force-uninstalled', async () => {
    const opts = await fixture();
    const target = join(opts.home, '.codex/config.toml');
    await mkdir(join(opts.home, '.codex'), { recursive: true });
    await writeFile(target, '[mcp_servers.user]\ncommand = "user"\n');
    const projectManifest = join(opts.root, '.edu/manifest.json');
    const globalManifest = join(opts.home, '.edu/manifest.json');
    await applyInstall(await planInstall({ ...opts, scope: 'project', clis: ['codex'] }));
    await applyInstall(await planInstall({ ...opts, scope: 'global', clis: ['codex'] }));
    const installed = await readFile(target, 'utf8');
    const edu = installed.match(/# edu:top:start[\s\S]*?# edu:top:end\n?|# edu:start[\s\S]*?# edu:end\n?/)?.[0];
    expect(edu).toBeDefined();
    await writeFile(target, edu!);
    await uninstall({ manifestPath: projectManifest, force: true });
    await uninstall({ manifestPath: globalManifest, force: true });
    expect(await readFile(target, 'utf8')).toBe('');
  });

  it('preserves an empty managed-block inverse for a preexisting whitespace-only file', async () => {
    const opts = await fixture();
    const target = join(opts.root, 'CLAUDE.md');
    await writeFile(target, '  \n');
    const manifestPath = join(opts.root, '.edu/manifest.json');
    await applyInstall(await planInstall({ ...opts, scope: 'project', clis: ['claude'] }));
    const installed = await readFile(target, 'utf8');
    const block = installed.match(/<!-- edu:core:start -->[\s\S]*?<!-- edu:core:end -->/)?.[0];
    expect(block).toBeDefined();
    await writeFile(target, `${block}\n`);
    await uninstall({ manifestPath, force: true });
    await expect(readFile(target, 'utf8')).resolves.toBe('');
  });

  it('refuses destructive force-uninstall for a legacy JSON action without ownership metadata', async () => {
    const opts = await fixture();
    const target = join(opts.root, 'settings.json');
    const manifestPath = join(opts.root, '.edu/manifest.json');
    const backupPath = join(opts.root, '.edu/backups/settings.json');
    const current = '{"mcpServers":{"edu":{"command":"edu"}},"addedByUser":true}\n';
    await mkdir(join(opts.root, '.edu/backups'), { recursive: true });
    await writeFile(target, current);
    await writeFile(backupPath, '{"beforeInstall":true}\n');
    await writeFile(manifestPath, JSON.stringify({ version: 1, eduVersion: '0.1.0', installedAt: new Date().toISOString(), scope: 'project', actions: [{ cli: 'claude', kind: 'json-merge', path: target, description: 'legacy action', sha256: 'old-hash', backup: backupPath }] }));
    await expect(uninstall({ manifestPath, force: true })).rejects.toThrow(/legacy.*json|ownership/i);
    expect(await readFile(target, 'utf8')).toBe(current);
    await expect(readFile(manifestPath, 'utf8')).resolves.toBeTruthy();
  });

  it('uses injectable HOME for global paths and reports integration health', async () => {
    const opts = await fixture();
    expect(pathsFor('claude', 'global', opts.root, opts.home).instructions).toEqual([join(opts.home, '.claude/CLAUDE.md')]);
    const plan = await planInstall({ ...opts, scope: 'global', clis: ['claude'] });
    await applyInstall(plan);
    expect(await readFile(join(opts.home, '.claude/CLAUDE.md'), 'utf8')).toContain(`@${join(opts.home, '.edu/EDU.md')}`);
    const healthy = await diagnose({ ...opts, detectBinary: async bin => bin === 'claude' });
    expect(healthy.find(entry => entry.cli === 'claude')).toMatchObject({ installed: true, integrated: true, drift: false, scopes: ['global'] });
    await writeFile(join(opts.home, '.claude/CLAUDE.md'), 'changed');
    const changed = await diagnose({ ...opts, detectBinary: async () => false });
    expect(changed.find(entry => entry.cli === 'claude')).toMatchObject({ integrated: true, drift: true });
  });

  it('tracks shared AGENTS.md ownership and restores all five integrations', async () => {
    const opts = await fixture();
    await writeFile(join(opts.root, 'AGENTS.md'), '# Existing rules\n');
    const plan = await planInstall({ ...opts, scope: 'project', clis: 'all' });
    const manifest = await applyInstall(plan);
    const shared = manifest.actions.find(action => action.path === join(opts.root, 'AGENTS.md')) as typeof manifest.actions[number] & { clis: string[] };
    expect(shared.clis).toEqual(['codex', 'pi', 'opencode', 'agy']);
    expect((await readFile(join(opts.root, 'AGENTS.md'), 'utf8')).match(/<!-- edu:core:start -->/g)).toHaveLength(1);
    expect(JSON.parse(await readFile(join(opts.root, 'opencode.json'), 'utf8')).agent.builder.mode).toBe('subagent');
    const diagnoses = await diagnose({ ...opts, detectBinary: async () => false });
    expect(diagnoses.find(entry => entry.cli === 'agy')).toMatchObject({ integrated: true, drift: false });
    await uninstall({ manifestPath: join(opts.root, '.edu/manifest.json') });
    expect(await readFile(join(opts.root, 'AGENTS.md'), 'utf8')).toBe('# Existing rules\n');
    await expect(readFile(join(opts.root, 'GEMINI.md'))).rejects.toThrow();
  });

  it('preflights malformed user configuration before writing any target', async () => {
    const opts = await fixture();
    await mkdir(join(opts.root, '.claude'));
    await writeFile(join(opts.root, '.claude/settings.json'), '{ malformed');
    await expect(applyInstall(await planInstall({ ...opts, scope: 'project', clis: ['claude'] }))).rejects.toThrow();
    await expect(readFile(join(opts.root, 'CLAUDE.md'))).rejects.toThrow();
    expect(await readFile(join(opts.root, '.claude/settings.json'), 'utf8')).toBe('{ malformed');
  });

  it('retains original backups when adding another CLI in a later install', async () => {
    const opts = await fixture();
    await writeFile(join(opts.root, 'AGENTS.md'), 'Original rules\n');
    await applyInstall(await planInstall({ ...opts, scope: 'project', clis: ['codex'] }));
    const second = await applyInstall(await planInstall({ ...opts, scope: 'project', clis: ['pi'] }));
    const shared = second.actions.find(action => action.path === join(opts.root, 'AGENTS.md')) as typeof second.actions[number] & { clis: string[] };
    expect(shared.clis).toEqual(['codex', 'pi']);
    await uninstall({ manifestPath: join(opts.root, '.edu/manifest.json') });
    expect(await readFile(join(opts.root, 'AGENTS.md'), 'utf8')).toBe('Original rules\n');
  });

  it('shares one HOME configuration file across project and global scopes', async () => {
    const opts = await fixture();
    await applyInstall(await planInstall({ ...opts, scope: 'project', clis: ['codex'] }));
    const global = await planInstall({ ...opts, scope: 'global', clis: ['codex'] });
    await applyInstall(global);
    const target = join(opts.home, '.codex/config.toml');
    await uninstall({ manifestPath: join(opts.root, '.edu/manifest.json') });
    expect(await readFile(target, 'utf8')).toContain('[mcp_servers.edu]');
    await uninstall({ manifestPath: join(opts.home, '.edu/manifest.json') });
    await expect(readFile(target)).rejects.toThrow();
  });

  it('adds Codex notify at TOML top level and restores it on uninstall', async () => {
    const opts = await fixture();
    await mkdir(join(opts.home, '.codex'), { recursive: true });
    const path = join(opts.home, '.codex/config.toml');
    const original = '[mcp_servers.other]\ncommand = "other"\n';
    await writeFile(path, original);
    await applyInstall(await planInstall({ ...opts, scope: 'project', clis: ['codex'] }));
    const installed = await readFile(path, 'utf8');
    const top = /# edu:top:start\n([\s\S]*?)\n# edu:top:end/.exec(installed)?.[1] ?? '';
    expect(top).toBe('notify = ["edu", "hook", "codex-notify"]');
    expect(installed.indexOf('notify =')).toBeLessThan(installed.indexOf('[mcp_servers.other]'));
    expect(installed).toContain('[mcp_servers.edu]');
    await uninstall({ manifestPath: join(opts.root, '.edu/manifest.json') });
    expect(await readFile(path, 'utf8')).toBe(original);
  });

  it('preserves a user-owned Codex notify and reports the conflict in doctor', async () => {
    const opts = await fixture();
    await mkdir(join(opts.home, '.codex'), { recursive: true });
    const path = join(opts.home, '.codex/config.toml');
    const original = 'notify = ["my-hook"]\n\n[mcp_servers.other]\ncommand = "other"\n';
    await writeFile(path, original);
    await applyInstall(await planInstall({ ...opts, scope: 'project', clis: ['codex'] }));
    const installed = await readFile(path, 'utf8');
    expect(installed).toContain('notify = ["my-hook"]');
    expect(installed).not.toContain('notify = ["edu", "hook", "codex-notify"]');
    expect((await diagnose({ ...opts, detectBinary: async () => false })).find(item => item.cli === 'codex')?.notes)
      .toContain('A user-owned top-level Codex notify command is preserved; Edu did not add its notify hook.');
  });

  it('uses injected binary detection for a CliIntegration', async () => {
    const opts = await fixture();
    const seen: string[] = [];
    const integration = createClaudeIntegration({ ...opts, detectBinary: async binary => { seen.push(binary); return true; } });
    expect(await integration.detect()).toBe(true);
    expect(seen).toEqual(['claude']);
    expect((await integration.plan('project', opts.root)).some(action => action.path === join(opts.root, 'CLAUDE.md'))).toBe(true);
  });

  it.each(['first', 'second'] as const)('keeps shared HOME MCP targets until the %s project uninstalls last', async last => {
    const opts = await fixture();
    const secondRoot = join(opts.home, '..', 'project-b');
    await mkdir(secondRoot);
    await mkdir(join(opts.home, '.codex'));
    await mkdir(join(opts.home, '.pi/agent'), { recursive: true });
    const toml = '[mcp_servers.other]\ncommand = "other"\n';
    const json = '{"mcpServers":{"other":{"command":"other"}}}\n';
    const codexPath = join(opts.home, '.codex/config.toml');
    const piPath = join(opts.home, '.pi/agent/mcp.json');
    await writeFile(codexPath, toml);
    await writeFile(piPath, json);
    const clis = ['codex', 'pi'] as const;
    const firstManifest = await applyInstall(await planInstall({ ...opts, scope: 'project', clis: [...clis] }));
    const secondManifest = await applyInstall(await planInstall({ ...opts, root: secondRoot, scope: 'project', clis: [...clis] }));
    expect(firstManifest.actions.find(action => action.path === codexPath)?.backup).toBeTruthy();
    expect(secondManifest.actions.find(action => action.path === codexPath)?.backup).toBe(firstManifest.actions.find(action => action.path === codexPath)?.backup);
    const paths = [join(opts.root, '.edu/manifest.json'), join(secondRoot, '.edu/manifest.json')];
    const firstToRemove = last === 'first' ? paths[1]! : paths[0]!;
    const lastToRemove = last === 'first' ? paths[0]! : paths[1]!;
    await uninstall({ manifestPath: firstToRemove });
    expect(await readFile(codexPath, 'utf8')).toContain('[mcp_servers.edu]');
    expect(JSON.parse(await readFile(piPath, 'utf8')).mcpServers.edu.command).toBe(eduMcpLaunch().command);
    const remainingRoot = last === 'first' ? opts.root : secondRoot;
    const diagnoses = await diagnose({ root: remainingRoot, home: opts.home, detectBinary: async () => false });
    expect(diagnoses.find(entry => entry.cli === 'codex')).toMatchObject({ integrated: true, drift: false });
    expect(diagnoses.find(entry => entry.cli === 'pi')).toMatchObject({ integrated: true, drift: false });
    await uninstall({ manifestPath: lastToRemove });
    expect(await readFile(codexPath, 'utf8')).toBe(toml);
    expect(await readFile(piPath, 'utf8')).toBe(json);
  });
});

describe('host-rewritten JSON files', () => {
  it('does not report drift when the host CLI rewrites keys Edu does not own', async () => {
    const { mkdtemp, readFile: read, writeFile: write } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const root = await mkdtemp(join(tmpdir(), 'edu-drift-root-'));
    const home = await mkdtemp(join(tmpdir(), 'edu-drift-home-'));
    const templatesDir = resolveTemplatesDir();
    const plan = await planInstall({ clis: ['claude'], scope: 'global', root, home, templatesDir });
    await applyInstall(plan);
    const claudeJson = join(home, '.claude.json');
    const state = JSON.parse(await read(claudeJson, 'utf8'));
    state.numStartups = 42; // Claude Code rewrites its state file all the time
    await write(claudeJson, JSON.stringify(state));
    await expect(applyInstall(await planInstall({ clis: ['claude'], scope: 'global', root, home, templatesDir }))).resolves.toBeDefined();
    await expect(uninstall({ manifestPath: getManifestPath('global', root, home) })).resolves.toBeUndefined();
    expect(JSON.parse(await read(claudeJson, 'utf8')).mcpServers?.edu).toBeUndefined();
    expect(JSON.parse(await read(claudeJson, 'utf8')).numStartups).toBe(42);
  });
});
