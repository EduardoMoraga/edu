import { assertContained, readSkillBundle, UnsupportedSkillPathError } from '../skills/bundle.js';
import { access, readdir, readFile, stat, lstat } from 'node:fs/promises';
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

function protocol(scope: InstallScope, home: string, brainRoot?: string): string {
  const pointer = scope === 'project' ? '@.edu/EDU.md' : `@${join(brainRoot ?? join(home, '.edu'), 'EDU.md')}`;
  return `${pointer}\n1. Reuse an injected Edu brief; call \`edu_brief\` only if absent or explicitly refreshing.\n2. Retain an injected Edu session id; only if absent, \`edu_session_open\` (title, source) and keep its exact returned id per workspace.\n3. Recall on demand with \`edu_recall\`, then \`edu_read\`; cite ids, scope, claim bands and evidence.\n4. Record decisions and lessons with \`edu_remember\`. Memory is stored notes, not model training. \`edu_feedback\` is advisory, never proof that a lesson is proven. Check \`edu_capabilities\` for the installed version; unavailable means unknown.\n5. Close with \`edu_session_close\` using that exact id and a summary. Optionally include up to 3 durable \`lessons\` ({title, body, evidence:[existing ids]}); they are candidate/inferred observations, never verified facts. Do not invent a lesson or run another model to extract it. Report what remains open; never invent an id or claim closure after failure.\nTool names are logical names: in Pi discover \`mcp__edu__edu_*\` through codemode/tool_search as needed. Pi requests a host-owned workspace lock: change the host cwd and restart MCP rather than switching only with \`edu_project_use\`. Other clients may allow that tool: verify scope and retain separate session ids. Use crew only for independent work, substantial review or an explicit request; do not spawn extra agents for every trivial task.`;
}

export function instructionActions(cli: CliId, scope: InstallScope, root: string, options: IntegrationOptions & { brainRoot?: string }): PlannedAction[] {
  return pathsFor(cli, scope, root, options.home).instructions.map(path => ({
    cli, kind: 'managed-block', path, description: 'Install Edu protocol block', content: protocol(scope, options.home, options.brainRoot),
  }));
}

export async function skillActions(cli: CliId, scope: InstallScope, root: string, options: IntegrationOptions): Promise<PlannedAction[]> {
  const destination = pathsFor(cli, scope, root, options.home).skills;
  const brain = join(scope === 'project' ? root : options.home, '.edu/skills');
  const sources = [{ root: join(options.templatesDir, 'skills'), anchor: options.templatesDir }, { root: brain, custom: true, anchor: scope === 'project' ? root : options.home }];
  const skills = new Map<string, PlannedAction[]>();
  for (const source of sources) {
    try { await lstat(source.root); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    try { await assertContained(source.anchor, source.root); if (!(await lstat(source.root)).isDirectory()) throw new UnsupportedSkillPathError(`Non-directory skill source: ${source.root}`); }
    catch (error) {
      if (!source.custom || !(error instanceof UnsupportedSkillPathError)) throw error;
      skills.clear(); options.notes?.push(`Skipped custom skill source ${source.root}: ${error.message}; builtin skills also skipped because overrides cannot be inspected.`); continue;
    }
    for (const name of (await readdir(source.root)).sort()) {
      if (!/^[a-zA-Z0-9][\w-]*$/.test(name)) continue;
      const directory = join(source.root, name), file = join(directory, 'SKILL.md');
      if (source.custom) {
        try { await assertContained(source.anchor, directory); await assertContained(source.anchor, file);
          try { if (!(await lstat(file)).isFile()) throw new UnsupportedSkillPathError(`Non-regular skill document: ${file}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
        catch (error) {
          if (!(error instanceof UnsupportedSkillPathError)) throw error;
          skills.delete(name); options.notes?.push(`Skipped custom skill ${name}: ${error.message}; builtin override remains suppressed.`); continue;
        }
      }
      try { await lstat(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
      const bundle = await readSkillBundle(directory, name, { anchor: source.anchor, hasCommand: options.detectBinary });
      if (bundle.metadata.hosts && !bundle.metadata.hosts.includes(cli)) {
        if ((options.selectedHosts?.length ?? 1) < 2) throw new Error(`Skill ${name} does not support host ${cli}`);
        skills.delete(name); options.notes?.push(`Skipped skill ${name} for unsupported host ${cli}.`); continue;
      }
      skills.set(name, bundle.files.map(file => ({
        cli, kind: 'file', path: join(destination, name, file.path), description: `Install ${name} skill bundle ${file.path}`, content: file.content,
        bundle: { name, root: join(destination, name), anchor: scope === 'project' ? root : options.home, scope, relative: file.path,
          source: { path: join(directory, file.path), anchor: source.anchor, sha256: file.sha256 } },
      })));
    }
  }
  return [...skills.values()].flat();
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
