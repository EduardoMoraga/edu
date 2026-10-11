import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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
    // Large imported brains on slow Windows disks need headroom: the hook timeout is in seconds.
    expect(claudeHooks.hooks.SessionStart[0].hooks[0].timeout).toBeGreaterThanOrEqual(30);
    expect(codexHooks.hooks.SessionStart[0].hooks[0].timeout).toBeGreaterThanOrEqual(30);
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

  it('generates an OpenCode server plugin that satisfies both the OpenCode 2 and OpenCode 1 module contracts', async () => {
    const root = await fixture();
    await buildPlugins(root);
    const source = await readFile(join(root, 'plugins/opencode/plugins/edu.ts'), 'utf8');
    // The generated module is plain JavaScript, so it can be imported as-is.
    const copy = join(root, 'edu-plugin.mjs');
    await writeFile(copy, source);
    const mod = await import(pathToFileURL(copy).href) as { default: { id: unknown; setup: unknown; server: unknown } };
    // OpenCode 2 (packages/core/src/plugin/module.ts): default { id: string, setup | effect: function }.
    expect(typeof mod.default.id).toBe('string');
    expect(typeof mod.default.setup).toBe('function');
    await expect((mod.default.setup as () => Promise<unknown>)()).resolves.toBeUndefined();
    // OpenCode 1 (readV1Plugin): default { id, server: function } returning hooks.
    await expect((mod.default.server as () => Promise<unknown>)()).resolves.toEqual({});
  });

  it('falls back to the minimal Pi extension when no Pi template exists', async () => {
    const root = await fixture();
    await buildPlugins(root);
    expect(await readFile(join(root, 'plugins/pi/extensions/edu.ts'), 'utf8')).toContain("registerMcpServer('edu'");
    const fallback = await readFile(join(root, 'plugins/pi/extensions/edu.ts'), 'utf8');
    expect(fallback).toContain('timeout: 15000');
    expect(fallback).toContain('Edu brief unavailable: ');
    await expect(readFile(join(root, 'plugins/pi/themes/edu.json'), 'utf8')).rejects.toThrow();
  });

  it('generates a Pi skills extension that adds only the package skills Pi has not already found elsewhere', async () => {
    const root = await fixture();
    await mkdir(join(root, 'templates/skills/edu-recall'), { recursive: true });
    await writeFile(join(root, 'templates/skills/edu-recall/SKILL.md'), '---\nname: edu-recall\ndescription: Recall\n---\n\nRecall skill.\n');
    await buildPlugins(root);
    const skills = join(root, 'plugins/pi/skills');
    // The generated module is plain JavaScript, so it can be imported as-is.
    const copy = join(root, 'plugins/pi/extensions/edu-skills.mjs');
    await writeFile(copy, await readFile(join(root, 'plugins/pi/extensions/edu-skills.ts'), 'utf8'));
    const mod = await import(pathToFileURL(copy).href) as { default: (pi: unknown) => void };
    type Command = { name: string; source: string; sourceInfo: { path: string } };
    const discover = (commands: Command[]) => {
      const handlers = new Map<string, (event: unknown) => unknown>();
      mod.default({ on: (event: string, handler: (event: unknown) => unknown) => { handlers.set(event, handler); }, getCommands: () => commands });
      return handlers.get('resources_discover')!({ type: 'resources_discover', cwd: root, reason: 'startup' });
    };
    // Nothing else provides them: Pi gets every package skill.
    expect(discover([])).toEqual({ skillPaths: [join(skills, 'edu-brief'), join(skills, 'edu-recall')] });
    // ~/.agents/skills (written by another CLI's setup) already has edu-brief: only edu-recall is added, so no collision.
    const shared: Command = { name: 'skill:edu-brief', source: 'skill', sourceInfo: { path: '/home/u/.agents/skills/edu-brief/SKILL.md' } };
    expect(discover([shared])).toEqual({ skillPaths: [join(skills, 'edu-recall')] });
    // On /reload the package's own copies are still loaded; they do not count as found elsewhere.
    const own: Command = { name: 'skill:edu-recall', source: 'skill', sourceInfo: { path: join(skills, 'edu-recall/SKILL.md') } };
    expect(discover([shared, own])).toEqual({ skillPaths: [join(skills, 'edu-recall')] });
    // A prompt template or extension command with a skill-like name is not a skill.
    expect(discover([{ ...shared, source: 'prompt' }])).toEqual({ skillPaths: [join(skills, 'edu-brief'), join(skills, 'edu-recall')] });
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

describe('Pi package manifest', () => {
  it('does not declare the skills directory, so Pi never loads a second copy of a skill in ~/.agents/skills', async () => {
    const pkg = JSON.parse(await readFile('package.json', 'utf8')) as { pi: Record<string, string[]> };
    expect(pkg.pi.skills).toBeUndefined();
    expect(pkg.pi.extensions).toEqual(['./plugins/pi/extensions']);
    // The skills still ship: the edu-skills extension adds them on resources_discover.
    expect(await readFile('plugins/pi/skills/edu-brief/SKILL.md', 'utf8')).toContain('name: edu-brief');
    expect(await readFile('plugins/pi/extensions/edu-skills.ts', 'utf8')).toContain("'resources_discover'");
  });
});

describe('generated frontmatter', () => {
  it('is valid YAML in every shipped prompt, command and agent', async () => {
    const { readdir } = await import('node:fs/promises');
    const { parse } = await import('yaml');
    const dirs = ['plugins/pi/prompts', 'plugins/opencode/commands', 'plugins/opencode/agents', 'plugins/claude-code/agents'];
    let checked = 0;
    for (const dir of dirs) {
      const files = await readdir(dir).catch(() => [] as string[]);
      for (const file of files.filter((name) => name.endsWith('.md'))) {
        const text = await readFile(join(dir, file), 'utf8');
        const block = /^---\n([\s\S]*?)\n---/.exec(text)?.[1];
        if (block === undefined) continue;
        expect(() => parse(block), `${dir}/${file}`).not.toThrow();
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
