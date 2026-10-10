import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { resolveTemplatesDir } from '../adapters/index.js';
import { truncateToTokens } from '../context/index.js';
import type { EduConfig, RoleSpec } from '../core/contracts.js';

const RoleOverrideSchema = z.object({
  title: z.string().optional(), icon: z.string().optional(), mission: z.string().optional(),
  autonomy: z.enum(['readonly', 'ask', 'auto', 'full']).optional(),
  cli: z.enum(['claude', 'codex', 'pi', 'opencode', 'agy']).optional(), model: z.string().optional(),
}).strict();
const FrontmatterSchema = z.object({
  name: z.string().min(1), description: z.string().min(1),
  roles: z.record(z.string(), RoleOverrideSchema).optional(),
  harness: z.enum(['H0', 'H1', 'H2', 'H3']).default('H3'),
  requireSpecApproval: z.boolean().default(true), maxFixRounds: z.number().int().min(0).max(5).default(1),
}).strict();

export interface Playbook extends z.infer<typeof FrontmatterSchema> { body: string; path: string }
export interface PlaybookLocations { globalRoot?: string; templatesDir?: string }

/** Loads the project method before the personal method and bundled default. */
export async function loadPlaybook(name: string, projectRoot: string, locations: PlaybookLocations = {}): Promise<Playbook> {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) throw new Error(`Invalid playbook name '${name}'.`);
  const paths = [
    join(projectRoot, 'playbooks', `${name}.md`),
    join(locations.globalRoot ?? join(homedir(), '.edu'), 'playbooks', `${name}.md`),
    join(locations.templatesDir ?? resolveTemplatesDir(), 'playbooks', 'default.md'),
  ];
  for (const path of paths) {
    let markdown: string;
    try { markdown = await readFile(path, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdown);
    if (!match) throw new Error(`Playbook '${path}' must begin with YAML frontmatter.`);
    const meta = FrontmatterSchema.parse(parse(match[1]!));
    if (path !== paths[2] && meta.name !== name) throw new Error(`Playbook '${path}' declares name '${meta.name}', expected '${name}'.`);
    return { ...meta, body: match[2]!.trim(), path };
  }
  if (name !== 'default') throw new Error(`Playbook '${name}' not found in project, global, or bundled templates.`);
  // Keeps an unbundled development checkout usable until the default template is generated.
  return { name: 'default', description: 'Built-in orchestration method', harness: 'H3', requireSpecApproval: true, maxFixRounds: 1, body: 'Plan observable requirements and deterministic checks. Approve the spec, build, verify, then review.', path: 'builtin:default' };
}

export function applyPlaybookRoles(config: EduConfig, playbook: Playbook): EduConfig {
  if (!playbook.roles) return config;
  const known = new Set(config.roles.map(role => role.id));
  for (const id of Object.keys(playbook.roles)) if (!known.has(id)) throw new Error(`Playbook role override '${id}' is not configured.`);
  return { ...config, roles: config.roles.map((role): RoleSpec => ({ ...role, ...playbook.roles?.[role.id] })) };
}

export function workerMethod(playbook: Playbook): string {
  return truncateToTokens(`Playbook: ${playbook.name}\n${playbook.description}\n\n${playbook.body}`, 400);
}
