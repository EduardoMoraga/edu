import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPlugins } from './build-plugins.js';

const roots: string[] = [];

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'edu-plugins-'));
  roots.push(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'edu-agent', version: '2.3.4' }));
  await mkdir(join(root, 'templates/commands'), { recursive: true });
  await mkdir(join(root, 'templates/skills/edu-brief'), { recursive: true });
  await mkdir(join(root, 'templates/agents'), { recursive: true });
  await writeFile(join(root, 'templates/EDU.md'), '# EDU\n<!-- edu:core -->\nCore identity\n<!-- /edu:core -->\n');
  await writeFile(join(root, 'templates/commands/brief.md'), '---\ndescription: "Brief command"\nargument-hint: "[goal]"\n---\n\nRun brief for $ARGUMENTS.\n');
  await writeFile(join(root, 'templates/skills/edu-brief/SKILL.md'), '---\nname: edu-brief\ndescription: Brief\n---\n\nBrief skill.\n');
  await writeFile(join(root, 'templates/agents/lead.md'), '---\nid: lead\ntitle: Lead\nmission: Lead mission\nautonomy: ask\n---\n\nLead prompt.\n');
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('buildPlugins', () => {
  it('generates versioned manifests and CLI-specific MCP, hook, command, and prompt formats', async () => {
    const root = await fixture();
    await buildPlugins(root);

    const claude = JSON.parse(await readFile(join(root, 'plugins/claude-code/.claude-plugin/plugin.json'), 'utf8'));
    const codex = JSON.parse(await readFile(join(root, 'plugins/codex/.codex-plugin/plugin.json'), 'utf8'));
    const claudeMcp = JSON.parse(await readFile(join(root, 'plugins/claude-code/.mcp.json'), 'utf8'));
    const codexMcp = JSON.parse(await readFile(join(root, 'plugins/codex/.mcp.json'), 'utf8'));
    const claudeHooks = JSON.parse(await readFile(join(root, 'plugins/claude-code/hooks/hooks.json'), 'utf8'));
    const codexHooks = JSON.parse(await readFile(join(root, 'plugins/codex/hooks/hooks.json'), 'utf8'));

    expect(claude.version).toBe('2.3.4');
    expect(codex.version).toBe('2.3.4');
    expect(claudeMcp.edu).toEqual({ command: 'edu', args: ['mcp'] });
    expect(codexMcp.mcpServers.edu).toEqual({ command: 'edu', args: ['mcp'] });
    expect(claudeHooks.hooks.SessionStart[0].hooks[0].command).toBe('edu hook session-start');
    expect(codexHooks.hooks.SessionStart[0].hooks[0].command).toBe('edu hook session-start');
    expect(await readFile(join(root, 'plugins/claude-code/skills/brief/SKILL.md'), 'utf8')).toContain('Brief skill.');
    expect(await readFile(join(root, 'plugins/opencode/commands/edu-brief.md'), 'utf8')).toContain('$ARGUMENTS');
    expect(await readFile(join(root, 'plugins/pi/prompts/edu-brief.md'), 'utf8')).toContain('$ARGUMENTS');
    expect(await readFile(join(root, '.claude-plugin/marketplace.json'), 'utf8')).toContain('"version": "2.3.4"');
  });

  it('ships the Pi and OpenCode Edu Deck sources and themes from templates when present', async () => {
    const root = await fixture();
    await mkdir(join(root, 'templates/pi'), { recursive: true });
    await mkdir(join(root, 'templates/opencode'), { recursive: true });
    await writeFile(join(root, 'templates/pi/edu.ts'), 'export default function () {}\n');
    await writeFile(join(root, 'templates/pi/edu-theme.json'), '{ "name": "edu", "colors": {} }\n');
    await writeFile(join(root, 'templates/opencode/edu-tui.tsx'), '/** @jsxImportSource @opentui/solid */\nexport default { id: "edu" }\n');
    await writeFile(join(root, 'templates/opencode/edu-theme.json'), '{ "theme": {} }\n');
    await buildPlugins(root);

    expect(await readFile(join(root, 'plugins/pi/extensions/edu.ts'), 'utf8')).toBe('export default function () {}\n');
    expect(JSON.parse(await readFile(join(root, 'plugins/pi/themes/edu.json'), 'utf8')).name).toBe('edu');
    expect(await readFile(join(root, 'plugins/opencode/tui/edu.tsx'), 'utf8')).toContain('@jsxImportSource @opentui/solid');
    expect(JSON.parse(await readFile(join(root, 'plugins/opencode/themes/edu.json'), 'utf8'))).toEqual({ theme: {} });
  });

  it('falls back to the minimal Pi extension when no Pi template exists', async () => {
    const root = await fixture();
    await buildPlugins(root);
    expect(await readFile(join(root, 'plugins/pi/extensions/edu.ts'), 'utf8')).toContain("registerMcpServer('edu'");
    await expect(readFile(join(root, 'plugins/pi/themes/edu.json'), 'utf8')).rejects.toThrow();
  });

  it('supports check mode and detects generated-file drift without writing', async () => {
    const root = await fixture();
    await buildPlugins(root);
    await expect(buildPlugins(root, { check: true })).resolves.toEqual({ changed: false, files: [] });
    const target = join(root, 'plugins/pi/extensions/edu.ts');
    await writeFile(target, 'drift');
    await expect(buildPlugins(root, { check: true })).resolves.toMatchObject({ changed: true });
    expect(await readFile(target, 'utf8')).toBe('drift');
  });
});
