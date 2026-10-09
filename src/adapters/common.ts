import { access, readdir, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { CliId, InstallScope } from '../core/contracts.js';
import type { IntegrationOptions, PlannedAction } from './types.js';
import { pathsFor } from './paths.js';

export async function binaryOnPath(binary: string): Promise<boolean> {
  const extensions = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';') : [''];
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    for (const extension of extensions) {
      const target = join(dir, `${binary}${extension}`);
      try {
        if (!(await stat(target)).isFile()) continue;
        await access(target, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
        return true;
      } catch { /* Try next PATH entry. */ }
    }
  }
  return false;
}

function protocol(scope: InstallScope, home: string): string {
  const pointer = scope === 'project' ? '@.edu/EDU.md' : `@${join(home, '.edu/EDU.md')}`;
  return `${pointer}\n1. Start with \`edu_brief\` for identity and open commitments.\n2. Recall on demand with \`edu_recall\`, then \`edu_read\`.\n3. Record decisions and lessons with \`edu_remember\`.\n4. Treat hypotheses as unproven until evidence confirms them.\n5. Close with \`edu_session_close\` and report what remains open.`;
}

export function instructionActions(cli: CliId, scope: InstallScope, root: string, options: IntegrationOptions): PlannedAction[] {
  return pathsFor(cli, scope, root, options.home).instructions.map(path => ({
    cli, kind: 'managed-block', path, description: 'Install Edu protocol block', content: protocol(scope, options.home),
  }));
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

export async function skillActions(cli: CliId, scope: InstallScope, root: string, options: IntegrationOptions): Promise<PlannedAction[]> {
  const destination = pathsFor(cli, scope, root, options.home).skills;
  const brain = join(scope === 'project' ? root : options.home, '.edu/skills');
  const sources = [join(options.templatesDir, 'skills'), brain];
  const skills = new Map<string, string>();
  for (const source of sources) {
    if (!await exists(source)) continue;
    for (const name of await readdir(source)) {
      if (!/^[a-zA-Z0-9][\w-]*$/.test(name)) continue;
      const file = join(source, name, 'SKILL.md');
      if (await exists(file)) skills.set(name, await readFile(file, 'utf8'));
    }
  }
  return [...skills].map(([name, content]) => ({
    cli, kind: 'file' as const, path: join(destination, name, 'SKILL.md'), description: `Install ${name} skill`, content,
  }));
}

export interface AgentTemplate { name: string; description: string; tools: string; prompt: string }

export async function agentTemplates(templatesDir: string): Promise<AgentTemplate[]> {
  const dir = join(templatesDir, 'agents');
  const result: AgentTemplate[] = [];
  for (const filename of (await readdir(dir)).filter(name => name.endsWith('.md')).sort()) {
    const text = await readFile(join(dir, filename), 'utf8');
    const parts = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
    if (!parts) throw new Error(`Malformed agent template: ${filename}`);
    const fields = Object.fromEntries(parts[1]!.split('\n').map(line => {
      const index = line.indexOf(':');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }));
    const name = fields.id;
    if (!name || !/^[\w-]+$/.test(name)) throw new Error(`Invalid agent template: ${filename}`);
    result.push({ name, description: fields.mission ?? fields.title ?? name, tools: fields.autonomy === 'readonly' ? 'Read, Grep, Glob' : 'Read, Write, Edit, Bash, Grep, Glob', prompt: parts[2]!.trim() });
  }
  return result;
}
