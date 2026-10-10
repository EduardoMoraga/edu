import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyDetach, createDetachPlan, listDetachBackups, undoDetach } from './engine.js';

const homes: string[] = [];
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'edu-detach-'));
  homes.push(home);
  await mkdir(join(home, '.claude'), { recursive: true });
  await writeFile(join(home, '.claude/CLAUDE.md'), 'user before\n<!-- gentle-ai:persona -->noise<!-- /gentle-ai:persona -->\nuser after\n');
  await writeFile(join(home, '.claude/settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'gentle-ai hook' }, { command: 'my-script' }] }] }, enabledPlugins: { 'engram@engram': true, mine: true } }, null, 2));
  await writeFile(join(home, '.claude.json'), JSON.stringify({ mcpServers: { engram: {}, context7: {} } }, null, 2));
  return home;
}
afterEach(async () => { for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true }); });

describe('detach transaction', () => {
  it('dry-runs without writes, then restores byte-identical source files', async () => {
    const home = await fixture();
    const path = join(home, '.claude/CLAUDE.md');
    const before = await readFile(path);
    const plan = await createDetachPlan({ home, env: {}, hosts: ['claude'], tools: ['gentle-ai', 'engram'] });
    expect(plan.files.length).toBe(3);
    expect(await readFile(path)).toEqual(before);
    expect(await listDetachBackups(home)).toEqual([]);
    const applied = await applyDetach(plan);
    expect((await readFile(path, 'utf8'))).toBe('user before\n\nuser after\n');
    expect(await listDetachBackups(home)).toContain(applied.id);
    await undoDetach({ home, id: applied.id });
    expect(await readFile(path)).toEqual(before);
  });

  it('refuses drift on undo unless force is explicit', async () => {
    const home = await fixture();
    const plan = await createDetachPlan({ home, env: {}, hosts: ['claude'], tools: ['gentle-ai'] });
    const { id } = await applyDetach(plan);
    const path = join(home, '.claude/CLAUDE.md');
    await writeFile(path, 'new user content');
    await expect(undoDetach({ home, id })).rejects.toThrow(/drift/i);
    expect(await readFile(path, 'utf8')).toBe('new user content');
    await undoDetach({ home, id, force: true });
    expect(await readFile(path, 'utf8')).toContain('gentle-ai:persona');
  });

  it('edits audited Codex, OpenCode, Pi and Gemini shapes and undoes all bytes', async () => {
    const home = await mkdtemp(join(tmpdir(), 'edu-detach-multi-')); homes.push(home);
    const fixtures: Record<string, string> = {
      '.codex/config.toml': `model_instructions_file = "${join(home, '.codex/engram-instructions.md')}"\n[plugins."engram@engram"]\nenabled = true\n[mcp_servers.engram]\ncommand = "engram"\n[mcp_servers.context7]\ncommand = "ctx"\n`,
      '.codex/engram-instructions.md': 'Injected instructions from Engram that should remain on disk.\n',
      '.codex/hooks.json': JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ command: 'orca hook' }, { command: 'my hook' }] }] } }, null, 2),
      '.config/opencode/opencode.jsonc': '{\n // comment\n "mcp": { "engram": {}, "context7": {} },\n "default_agent": "gentle-orchestrator"\n}\n',
      '.pi/agent/settings.json': JSON.stringify({ packages: ['gentle-pi', 'gentle-engram@0.2', 'pi-web-access'] }, null, 2),
      '.gemini/settings.json': JSON.stringify({ mcpServers: { engram: {}, context7: {} } }, null, 2),
    };
    for (const [relative, content] of Object.entries(fixtures)) { const path = join(home, relative); await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, content); }
    const plan = await createDetachPlan({ home, env: {}, hosts: ['codex', 'opencode', 'pi', 'gemini'], tools: ['engram', 'gentle-ai', 'orca'] });
    expect(plan.files).toHaveLength(5);
    expect(plan.tokensSaved).toBeGreaterThan(0);
    const { id } = await applyDetach(plan);
    expect(await readFile(join(home, '.config/opencode/opencode.jsonc'), 'utf8')).toContain('// comment');
    expect(await readFile(join(home, '.pi/agent/settings.json'), 'utf8')).toContain('pi-web-access');
    expect(await readFile(join(home, '.codex/hooks.json'), 'utf8')).toContain('my hook');
    await undoDetach({ home, id });
    for (const [relative, content] of Object.entries(fixtures)) expect(await readFile(join(home, relative), 'utf8')).toBe(content);
  });
});
