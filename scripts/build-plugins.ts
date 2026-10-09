import { access, readdir, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Generated = Map<string, string>;
export interface BuildOptions { check?: boolean }
export interface BuildResult { changed: boolean; files: string[] }

const AUTHOR = { name: 'Eduardo Moraga' };
const DESCRIPTION = 'Edu — an installable, LLM-agnostic agentic harness with a learning second brain and CLI-native workflows.';

export async function buildPlugins(root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), options: BuildOptions = {}): Promise<BuildResult> {
  const templates = join(root, 'templates');
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { version: string };
  const identity = await readFile(join(templates, 'EDU.md'), 'utf8');
  const core = extractCore(identity);
  const skills = await readSkills(join(templates, 'skills'));
  const agents = await readMarkdown(join(templates, 'agents'));
  const commands = await readMarkdown(join(templates, 'commands'));
  const generated = new Map<string, string>();
  const add = (path: string, content: string) => generated.set(path, `${content.replace(/\r\n/g, '\n').replace(/\s*$/, '')}\n`);
  const mcp = { command: 'edu', args: ['mcp'] };
  const hook = { hooks: { SessionStart: [{ matcher: 'startup|resume|clear|fork', hooks: [{ type: 'command', command: 'edu hook session-start', timeout: 10 }] }] } };

  add('.claude-plugin/marketplace.json', json({
    name: 'edu', description: DESCRIPTION, owner: AUTHOR,
    plugins: [{ name: 'edu', source: './plugins/claude-code', version: pkg.version, description: DESCRIPTION, author: AUTHOR, category: 'productivity' }],
  }));
  add('.agents/plugins/marketplace.json', json({
    name: 'edu', interface: { displayName: 'Edu Agent Harness' },
    plugins: [{ name: 'edu', source: { source: 'local', path: './plugins/codex' }, policy: { installation: 'AVAILABLE' }, category: 'Productivity' }],
  }));

  add('plugins/claude-code/.claude-plugin/plugin.json', json({ name: 'edu', version: pkg.version, description: DESCRIPTION, author: AUTHOR }));
  add('plugins/claude-code/.mcp.json', json({ edu: mcp }));
  add('plugins/claude-code/hooks/hooks.json', json(hook));
  add('plugins/claude-code/output-styles/edu.md', core);
  for (const skill of skills) add(`plugins/claude-code/skills/${skill.name.replace(/^edu-/, '')}/SKILL.md`, skill.content);
  for (const agent of agents) add(`plugins/claude-code/agents/${agent.name}.md`, claudeAgent(agent));

  add('plugins/codex/.codex-plugin/plugin.json', json({
    name: 'edu', displayName: 'Edu Agent Harness', version: pkg.version, description: DESCRIPTION,
    shortDescription: 'A second brain and native workflows for coding CLIs.', author: AUTHOR,
    skills: './skills/', mcpServers: './.mcp.json', hooks: './hooks/hooks.json',
    interface: { displayName: 'Edu', shortDescription: 'Memory and agent workflows', category: 'Productivity', capabilities: ['memory', 'orchestration'], defaultPrompt: 'Start with edu_brief and follow the Edu identity.' },
  }));
  // Codex rejects MCP tool calls in non-interactive runs unless the server opts in.
  add('plugins/codex/.mcp.json', json({ mcpServers: { edu: { ...mcp, default_tools_approval_mode: 'approve' } } }));
  add('plugins/codex/hooks/hooks.json', json(hook));
  for (const skill of skills) add(`plugins/codex/skills/${skill.name}/SKILL.md`, skill.content);
  for (const agent of agents) add(`plugins/codex/agents/${agent.name}.md`, agent.content);

  for (const skill of skills) add(`plugins/pi/skills/${skill.name}/SKILL.md`, skill.content);
  for (const command of commands) add(`plugins/pi/prompts/edu-${command.name}.md`, piPrompt(command));
  add('plugins/pi/extensions/edu.ts', piExtension());

  for (const command of commands) add(`plugins/opencode/commands/edu-${command.name}.md`, opencodeCommand(command));
  for (const agent of agents) add(`plugins/opencode/agents/${agent.name}.md`, agent.content);
  add('plugins/opencode/plugins/edu.ts', openCodePlugin());

  add('plugins/agy/plugin.json', json({ name: 'edu', version: pkg.version, description: DESCRIPTION }));
  add('plugins/agy/mcp_config.json', json({ mcpServers: { edu: mcp } }));
  add('plugins/agy/rules/edu.md', core);
  for (const skill of skills) add(`plugins/agy/skills/${skill.name}/SKILL.md`, skill.content);
  for (const agent of agents) add(`plugins/agy/agents/${agent.name}.md`, agent.content);

  const changed = await findDrift(root, generated);
  if (!options.check) {
    for (const path of generated.keys()) await assertWritableParent(join(root, path));
    for (const dir of ['plugins/claude-code', 'plugins/codex', 'plugins/pi', 'plugins/opencode', 'plugins/agy']) {
      await rm(join(root, dir), { recursive: true, force: true });
    }
    for (const [path, content] of generated) {
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }
  }
  return { changed: changed.length > 0, files: changed };
}

async function assertWritableParent(target: string): Promise<void> {
  let parent = dirname(target);
  while (true) {
    try {
      await access(parent, constants.W_OK);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && (error as NodeJS.ErrnoException).code !== 'EPERM' && (error as NodeJS.ErrnoException).code !== 'EACCES') throw error;
      const next = dirname(parent);
      if (next === parent) throw new Error(`No writable parent directory for generated file: ${target}`);
      try { await access(parent); } catch { parent = next; continue; }
      throw new Error(`Generated output is not writable: ${target}`);
    }
  }
}

async function findDrift(root: string, generated: Generated): Promise<string[]> {
  const actual = new Map<string, string>();
  const roots = ['.claude-plugin', '.agents/plugins', 'plugins/claude-code', 'plugins/codex', 'plugins/pi', 'plugins/opencode', 'plugins/agy'];
  for (const path of roots) await scan(join(root, path), path, actual);
  const paths = new Set([...actual.keys(), ...generated.keys()]);
  const changed: string[] = [];
  for (const path of paths) if (actual.get(path) !== generated.get(path)) changed.push(path);
  return changed.sort();
}

async function scan(directory: string, relative: string, files: Map<string, string>): Promise<void> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    const key = join(relative, entry.name).replaceAll('\\', '/');
    if (entry.isDirectory()) await scan(path, key, files);
    else if (entry.isFile()) files.set(key, await readFile(path, 'utf8'));
  }
}

async function readMarkdown(directory: string): Promise<Array<{ name: string; content: string; frontmatter: Record<string, string>; body: string }>> {
  let files: string[];
  try { files = await readdir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const result = [];
  for (const file of files.filter(file => file.endsWith('.md')).sort()) {
    const content = await readFile(join(directory, file), 'utf8');
    const { frontmatter, body } = splitFrontmatter(content);
    result.push({ name: file.slice(0, -3), content, frontmatter, body });
  }
  return result;
}

async function readSkills(directory: string): Promise<Array<{ name: string; content: string }>> {
  let names: string[];
  try { names = await readdir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const result = [];
  for (const name of names.sort()) {
    const path = join(directory, name, 'SKILL.md');
    try { result.push({ name, content: await readFile(path, 'utf8') }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return result;
}

function splitFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  const values: Record<string, string> = {};
  if (!match) return { frontmatter: values, body: content.trim() };
  for (const line of match[1]!.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon > 0) values[line.slice(0, colon).trim()] = line.slice(colon + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return { frontmatter: values, body: match[2]!.trim() };
}

function extractCore(identity: string): string {
  const match = /<!-- edu:core -->\s*([\s\S]*?)\s*<!-- \/edu:core -->/.exec(identity);
  return match?.[1]?.trim() ?? identity.trim();
}

function claudeAgent(agent: { name: string; content: string; frontmatter: Record<string, string>; body: string }): string {
  const description = agent.frontmatter.mission ?? agent.frontmatter.title ?? agent.name;
  const tools = agent.frontmatter.autonomy === 'readonly' ? 'Read, Grep, Glob' : 'Read, Write, Edit, Bash, Grep, Glob';
  return `---\nname: ${agent.name}\ndescription: ${description}\ntools: ${tools}\n---\n\n${agent.body}`;
}

function opencodeCommand(command: { frontmatter: Record<string, string>; body: string }): string {
  return `---\ndescription: ${command.frontmatter.description ?? command.name}\nagent: build\nsubtask: false\n---\n\n${command.body.replaceAll('$ARGUMENTS', '$ARGUMENTS')}`;
}

function piPrompt(command: { frontmatter: Record<string, string>; body: string }): string {
  const description = command.frontmatter.description ?? command.name;
  const hint = command.frontmatter['argument-hint'];
  return `---\ndescription: ${description}${hint ? `\nargument-hint: ${hint}` : ''}\n---\n\n${command.body}`;
}

function piExtension(): string {
  return `import { spawnSync } from 'node:child_process';

export default function (pi: any): void {
  pi.registerMcpServer('edu', { command: 'edu', args: ['mcp'] });
  pi.on('before_agent_start', async (event: any) => {
    try {
      const result = spawnSync('edu', ['hook', 'session-start'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
      if (result.error || result.status !== 0 || !result.stdout?.trim()) return;
      return { systemPrompt: \`${'$'}{event.systemPrompt ?? ''}\\n\\n${'$'}{result.stdout.trim()}\` };
    } catch { return; }
  });
}
`;
}

function openCodePlugin(): string {
  return `export const Edu = async () => ({
  'session.created': async () => {
    // The global AGENTS.md managed block supplies identity when this package is installed.
  },
});
`;
}

function json(value: unknown): string { return JSON.stringify(value, null, 2); }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  try {
    const result = await buildPlugins(undefined, { check });
    if (result.changed) {
      console.error(`Plugin output ${check ? 'is stale' : 'changed'}:\n${result.files.map(file => `  ${file}`).join('\n')}`);
      if (check) process.exitCode = 1;
    } else console.log(check ? 'Plugin output is up to date.' : 'Generated Edu plugins.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
