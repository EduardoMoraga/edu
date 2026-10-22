import { assertContained, readSkillBundle, type SkillBundle } from '../src/skills/bundle.ts';
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
  // Optional: the Edu Deck pane for Claude Code (absent in minimal template sets).
  const deckModule = await readFile(join(templates, 'claude-mod', 'deck.tsx'), 'utf8').catch(() => undefined);
  const deckState = await readFile(join(templates, 'claude-mod', 'deck-state.d.ts'), 'utf8').catch(() => undefined);
  const deck = deckModule && deckState ? { deckModule, deckState } : undefined;
  // Optional: the Edu Deck for Pi (extension + theme) and OpenCode (TUI plugin + theme).
  const optional = (path: string) => readFile(join(templates, path), 'utf8').catch(() => undefined);
  const [piSource, piTheme, openCodeTui, openCodeTheme] = await Promise.all([
    optional('pi/edu.ts'), optional('pi/edu-theme.json'), optional('opencode/edu-tui.tsx'), optional('opencode/edu-theme.json'),
  ]);
  const generated = new Map<string, string>();
  const add = (path: string, content: string) => generated.set(path, `${content.replace(/\r\n/g, '\n').replace(/\s*$/, '')}\n`);
  const mcp = { command: 'edu', args: ['mcp'] };
  const hook = { hooks: { SessionStart: [{ matcher: 'startup|resume|clear|fork', hooks: [{ type: 'command', command: 'edu hook session-start', timeout: 30 }] }] } };

  add('.claude-plugin/marketplace.json', json({
    name: 'edu', description: DESCRIPTION, owner: AUTHOR,
    plugins: [{ name: 'edu', source: './plugins/claude-code', version: pkg.version, description: DESCRIPTION, author: AUTHOR, category: 'productivity' }],
  }));
  add('.agents/plugins/marketplace.json', json({
    name: 'edu', interface: { displayName: 'Edu Agent Harness' },
    plugins: [{ name: 'edu', source: { source: 'local', path: './plugins/codex' }, policy: { installation: 'AVAILABLE' }, category: 'Productivity' }],
  }));

  add('plugins/claude-code/.claude-plugin/plugin.json', json({ name: 'edu', version: pkg.version, description: DESCRIPTION, author: AUTHOR, ...(deck ? { types: './types/index.d.ts' } : {}) }));
  add('plugins/claude-code/.mcp.json', json({ edu: mcp }));
  // Command hooks (identity at session start) plus the Edu Deck pane module, in one plugin.
  add('plugins/claude-code/hooks/hooks.json', json(deck ? { ...hook, modules: ['./deck.tsx'] } : hook));
  if (deck) {
    add('plugins/claude-code/hooks/deck.tsx', deck.deckModule);
    add('plugins/claude-code/types/index.d.ts', deck.deckState);
  }
  add('plugins/claude-code/output-styles/edu.md', core);
  for (const skill of skills) if (!skill.metadata.hosts || skill.metadata.hosts.includes('claude')) {
    for (const file of skill.files) generated.set(`plugins/claude-code/skills/${skill.name.replace(/^edu-/, '')}/${file.path}`, file.content);
  }
  for (const agent of agents) add(`plugins/claude-code/agents/${agent.name}.md`, claudeAgent(agent));

  add('plugins/codex/.codex-plugin/plugin.json', json({
    name: 'edu', displayName: 'Edu Agent Harness', version: pkg.version, description: DESCRIPTION,
    shortDescription: 'A second brain and native workflows for coding CLIs.', author: AUTHOR,
    skills: './skills/', mcpServers: './.mcp.json', hooks: './hooks/hooks.json',
    interface: { displayName: 'Edu', shortDescription: 'Memory and agent workflows', category: 'Productivity', capabilities: ['memory', 'orchestration'], defaultPrompt: 'Start with edu_brief and follow the Edu identity.' },
  }));
  // Approval is driven by per-tool MCP annotations (src/mcp/server.ts): reads and local brain writes run,
  // tools that start other agents still ask. Never opt the whole server into auto-approval.
  add('plugins/codex/.mcp.json', json({ mcpServers: { edu: mcp } }));
  add('plugins/codex/hooks/hooks.json', json(hook));
  for (const skill of skills) if (!skill.metadata.hosts || skill.metadata.hosts.includes('codex')) {
    for (const file of skill.files) generated.set(`plugins/codex/skills/${skill.name}/${file.path}`, file.content);
  }
  for (const agent of agents) add(`plugins/codex/agents/${agent.name}.md`, agent.content);

  for (const skill of skills) if (!skill.metadata.hosts || skill.metadata.hosts.includes('pi')) {
    for (const file of skill.files) generated.set(`plugins/pi/skills/${skill.name}/${file.path}`, file.content);
  }
  for (const command of commands) add(`plugins/pi/prompts/edu-${command.name}.md`, piPrompt(command));
  add('plugins/pi/extensions/edu.ts', piSource ?? piExtension());
  add('plugins/pi/extensions/edu-skills.ts', piSkillsExtension());
  if (piTheme) add('plugins/pi/themes/edu.json', piTheme);

  for (const command of commands) add(`plugins/opencode/commands/edu-${command.name}.md`, opencodeCommand(command));
  for (const agent of agents) add(`plugins/opencode/agents/${agent.name}.md`, agent.content);
  add('plugins/opencode/plugins/edu.ts', openCodePlugin());
  // The TUI plugin is a V2 module (default { id, setup }). `edu setup` installs it as
  // ~/.config/opencode/plugins/edu-deck/tui.tsx: OpenCode 2 discovers TUI plugins as directories with a
  // `tui` entrypoint and the server skips directories without a `server`/`index` entrypoint.
  if (openCodeTui) add('plugins/opencode/tui/edu.tsx', openCodeTui);
  if (openCodeTheme) add('plugins/opencode/themes/edu.json', openCodeTheme);

  add('plugins/agy/plugin.json', json({ name: 'edu', version: pkg.version, description: DESCRIPTION }));
  add('plugins/agy/mcp_config.json', json({ mcpServers: { edu: mcp } }));
  add('plugins/agy/rules/edu.md', core);
  for (const skill of skills) if (!skill.metadata.hosts || skill.metadata.hosts.includes('agy')) {
    for (const file of skill.files) generated.set(`plugins/agy/skills/${skill.name}/${file.path}`, file.content);
  }
  for (const agent of agents) add(`plugins/agy/agents/${agent.name}.md`, agent.content);

  for (const path of ['.claude-plugin', '.agents/plugins', 'plugins/claude-code', 'plugins/codex', 'plugins/pi', 'plugins/opencode', 'plugins/agy', ...generated.keys()]) await assertContained(root, join(root, path));
  const changed = await findDrift(root, generated);
  if (!options.check) {
    for (const path of generated.keys()) await assertWritableParent(join(root, path));
    for (const dir of ['plugins/claude-code', 'plugins/codex', 'plugins/pi', 'plugins/opencode', 'plugins/agy']) {
      await rm(join(root, dir), { recursive: true, force: true });
    }
    for (const [path, content] of generated) {
      const target = join(root, path);
      await assertContained(root, target);
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

async function readSkills(directory: string): Promise<SkillBundle[]> {
  let names: string[];
  try { names = await readdir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const result: SkillBundle[] = [];
  for (const name of names.sort()) {
    try { await access(join(directory, name, 'SKILL.md')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    result.push(await readSkillBundle(join(directory, name), name, { anchor: directory }));
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

/** Quotes a frontmatter value so `: ` and other YAML syntax inside it stay plain text. */
const yamlValue = (value: string): string => JSON.stringify(value);

function claudeAgent(agent: { name: string; content: string; frontmatter: Record<string, string>; body: string }): string {
  const description = agent.frontmatter.mission ?? agent.frontmatter.title ?? agent.name;
  const tools = agent.frontmatter.autonomy === 'readonly' ? 'Read, Grep, Glob' : 'Read, Write, Edit, Bash, Grep, Glob';
  return `---\nname: ${agent.name}\ndescription: ${yamlValue(description)}\ntools: ${tools}\n---\n\n${agent.body}`;
}

function opencodeCommand(command: { frontmatter: Record<string, string>; body: string }): string {
  return `---\ndescription: ${yamlValue(command.frontmatter.description ?? command.name)}\nagent: build\nsubtask: false\n---\n\n${command.body.replaceAll('$ARGUMENTS', '$ARGUMENTS')}`;
}

function piPrompt(command: { frontmatter: Record<string, string>; body: string }): string {
  const description = command.frontmatter.description ?? command.name;
  const hint = command.frontmatter['argument-hint'];
  return `---\ndescription: ${yamlValue(description)}${hint ? `\nargument-hint: ${yamlValue(hint)}` : ''}\n---\n\n${command.body}`;
}

function piExtension(): string {
  return `import { spawnSync } from 'node:child_process';

// On Windows, npm installs edu as a .cmd shim: start it through cmd (fixed arguments only).
const windows = process.platform === 'win32';

export default function (pi: any): void {
  pi.registerMcpServer('edu', windows ? { command: 'cmd', args: ['/c', 'edu', 'mcp'] } : { command: 'edu', args: ['mcp'] });
  let warned = false;
  const unavailable = (ctx: any, reason: string) => {
    if (warned) return;
    warned = true;
    try { ctx?.ui?.notify?.(\`Edu brief unavailable: ${'$'}{reason}\`, 'warning'); } catch { /* No UI. */ }
  };
  pi.on('before_agent_start', async (event: any, ctx: any) => {
    try {
      const result = spawnSync('edu', ['hook', 'session-start'], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'], shell: windows });
      if (result.error) return unavailable(ctx, result.error.message);
      if (result.status !== 0) return unavailable(ctx, \`edu hook session-start exited with ${'$'}{result.status ?? result.signal}\`);
      if (!result.stdout?.trim()) return;
      return { systemPrompt: \`${'$'}{event.systemPrompt ?? ''}\\n\\n${'$'}{result.stdout.trim()}\` };
    } catch (error) { return unavailable(ctx, error instanceof Error ? error.message : String(error)); }
  });
}
`;
}

/**
 * Pi skills without "Skill conflicts". package.json does not declare plugins/pi/skills because Pi also
 * discovers ~/.agents/skills, where `edu setup` for Codex, OpenCode or Antigravity installs the same
 * skills, and two copies of one name make Pi warn at every startup. This extension adds, on
 * resources_discover, only the package skills Pi has not already loaded from somewhere else, so Pi always
 * has every Edu skill exactly once. Plain JavaScript, so tests can import it as-is.
 */
function piSkillsExtension(): string {
  return `// Edu skills for Pi. Generated by scripts/build-plugins.ts.
// Adds only the Edu skills Pi has not already found elsewhere (for example ~/.agents/skills), so the
// same skill never loads twice and Pi never prints "Skill conflicts".
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const skillsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills');

function real(path) {
  try { return realpathSync(path); } catch { return path; }
}

/** Skill names Pi loaded from anywhere but this package (its own copies are still loaded on /reload). */
function foundElsewhere(pi) {
  const own = real(skillsDir) + sep;
  const names = new Set();
  let commands = [];
  try { commands = pi.getCommands(); } catch { /* No command list: add every package skill. */ }
  for (const command of commands) {
    if (command.source !== 'skill' || !String(command.name).startsWith('skill:')) continue;
    const path = command.sourceInfo && command.sourceInfo.path;
    if (path && real(path).startsWith(own)) continue;
    names.add(String(command.name).slice('skill:'.length));
  }
  return names;
}

export default function (pi) {
  pi.on('resources_discover', () => {
    if (!existsSync(skillsDir)) return {};
    const found = foundElsewhere(pi);
    const skillPaths = readdirSync(skillsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !found.has(entry.name) && existsSync(join(skillsDir, entry.name, 'SKILL.md')))
      .map(entry => join(skillsDir, entry.name))
      .sort();
    return { skillPaths };
  });
}
`;
}

/**
 * OpenCode server plugin. OpenCode 2 requires `export default { id, setup }` (or `effect`); OpenCode 1
 * reads `server` from the same default object and ignores the rest, so one module loads in both.
 * It stays a no-op: the global AGENTS.md managed block and the MCP server supply Edu.
 */
function openCodePlugin(): string {
  return `// Edu for OpenCode. Generated by scripts/build-plugins.ts; installed by \`edu setup\`.
// Identity comes from the global AGENTS.md managed block and the edu MCP server.
export default {
  id: 'edu',
  // OpenCode 2 entrypoint.
  async setup() {},
  // OpenCode 1 entrypoint.
  async server() {
    return {};
  },
};
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
