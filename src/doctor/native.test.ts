import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { diagnose } from '../adapters/doctor.js';
import { nativeIntegrations } from './native.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function home(files: Record<string, string> = {}, dirs: string[] = []): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'edu-native-')); roots.push(root);
  for (const [relative, content] of Object.entries(files)) { await mkdir(dirname(join(root, relative)), { recursive: true }); await writeFile(join(root, relative), content); }
  for (const dir of dirs) await mkdir(join(root, dir), { recursive: true });
  return root;
}

describe('native plugin integrations', () => {
  it('recognizes the Claude plugin enabled in settings.json', async () => {
    const h = await home({ '.claude/settings.json': JSON.stringify({ enabledPlugins: { 'edu@edu': true } }) });
    expect((await nativeIntegrations(h)).claude).toEqual({ found: ['Claude plugin edu@edu'], notes: [] });
  });

  it('recognizes a Claude plugin installed but not disabled, and ignores a disabled one', async () => {
    const installed = await home({ '.claude/plugins/installed_plugins.json': JSON.stringify({ version: 2, plugins: { 'edu@edu': [{ scope: 'user' }] } }) });
    expect((await nativeIntegrations(installed)).claude.found).toEqual(['Claude plugin edu@edu']);
    const disabled = await home({
      '.claude/settings.json': JSON.stringify({ enabledPlugins: { 'edu@edu': false } }),
      '.claude/plugins/installed_plugins.json': JSON.stringify({ plugins: { 'edu@edu': [] } }),
    });
    expect((await nativeIntegrations(disabled)).claude.found).toEqual([]);
  });

  it('recognizes the Codex plugin table unless it is disabled', async () => {
    const h = await home({ '.codex/config.toml': '[marketplaces.edu]\nsource = "/x"\n\n[plugins."edu@edu"]\nenabled = true\n' });
    expect((await nativeIntegrations(h)).codex.found).toEqual(['Codex plugin edu@edu']);
    const off = await home({ '.codex/config.toml': '[plugins."edu@edu"]\nenabled = false\n' });
    expect((await nativeIntegrations(off)).codex.found).toEqual([]);
  });

  it('recognizes the Pi package entry (relative path, npm) and flags a path that no longer exists', async () => {
    const h = await home({ '.pi/agent/settings.json': JSON.stringify({ packages: ['npm:pi-web-access', '../../tools/node_modules/edu-agent'] }) }, ['tools/node_modules/edu-agent']);
    expect((await nativeIntegrations(h)).pi.found).toEqual(['Pi package ../../tools/node_modules/edu-agent']);
    const npm = await home({ '.pi/agent/settings.json': JSON.stringify({ packages: [{ source: 'npm:edu-agent' }] }) });
    expect((await nativeIntegrations(npm)).pi.found).toEqual(['Pi package npm:edu-agent']);
    const gone = await home({ '.pi/agent/settings.json': JSON.stringify({ packages: ['../../gone/node_modules/edu-agent'] }) });
    const report = (await nativeIntegrations(gone)).pi;
    expect(report.found).toEqual([]);
    expect(report.notes[0]).toMatch(/edu-agent.*missing/);
  });

  it('recognizes OpenCode plugin files and the Antigravity plugin folders', async () => {
    const h = await home({ '.config/opencode/plugins/edu.ts': 'export {}', '.config/opencode/commands/edu-brief.md': '# brief' }, ['.gemini/config/plugins/edu']);
    const found = await nativeIntegrations(h);
    expect(found.opencode.found).toEqual(['OpenCode files ~/.config/opencode (plugins/edu.ts, commands/edu-*.md)']);
    expect(found.agy.found).toEqual(['Antigravity plugin ~/.gemini/config/plugins/edu']);
    const mcp = await home({}, ['.gemini/antigravity-cli/mcp/edu_edu']);
    expect((await nativeIntegrations(mcp)).agy.found).toEqual(['Antigravity plugin ~/.gemini/antigravity-cli/mcp/edu_edu']);
  });

  it('makes edu doctor report native installs as integrated, keeping manifest scopes for managed files', async () => {
    const h = await home({
      '.claude/settings.json': JSON.stringify({ enabledPlugins: { 'edu@edu': true } }),
      '.pi/agent/settings.json': JSON.stringify({ packages: ['npm:edu-agent'] }),
    });
    const project = await home();
    const result = await diagnose({ root: project, home: h, detectBinary: async () => true });
    const claude = result.find(d => d.cli === 'claude')!, pi = result.find(d => d.cli === 'pi')!, codex = result.find(d => d.cli === 'codex')!;
    expect([claude.integrated, claude.native, claude.scopes]).toEqual([true, ['Claude plugin edu@edu'], []]);
    expect([pi.integrated, pi.native]).toEqual([true, ['Pi package npm:edu-agent']]);
    expect([codex.integrated, codex.native]).toEqual([false, []]);
  });
});
