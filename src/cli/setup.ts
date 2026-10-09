/**
 * `edu init` core: creates a brain (project `.edu/` or global), renders the
 * EDU.md contract with the identity name, writes config.json and seeds the
 * brain with the bundled agent roles and skills (never overwriting).
 */
import { cp, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { openBrain } from '../brain/index.js';
import type { BrainLocation, CliId } from '../core/contracts.js';
import type { Lang } from './i18n.js';
import { exists } from './workspace.js';

export interface InitOptions {
  location: BrainLocation;
  templatesDir: string;
  name?: string;
  cli?: CliId;
  lang?: Lang;
  detected: CliId[];
}

export interface InitReport {
  root: string;
  defaultCli: CliId;
  configCreated: boolean;
  agents: string[];
  skills: string[];
}

export async function initBrain(opts: InitOptions): Promise<InitReport> {
  const { location, templatesDir } = opts;
  const name = opts.name?.trim() || 'Edu';
  await mkdir(location.root, { recursive: true });

  await openBrain([location]).init(location, { identityName: name });

  const { defaultConfig, saveConfig } = await import('../orchestrator/config.js');
  const configPath = join(location.root, 'config.json');
  const defaultCli = opts.cli ?? opts.detected[0] ?? 'claude';
  let configCreated = false;
  if (!(await exists(configPath))) {
    await saveConfig(configPath, { ...defaultConfig(defaultCli), lang: opts.lang ?? 'en' });
    configCreated = true;
  }

  const agents = await copyMissing(join(templatesDir, 'agents'), join(location.root, 'agents'));
  const skills = await copyMissing(join(templatesDir, 'skills'), join(location.root, 'skills'));
  return { root: location.root, defaultCli, configCreated, agents, skills };
}

/** Copies each top-level entry of `from` into `to` unless it already exists. */
async function copyMissing(from: string, to: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(from);
  } catch {
    return [];
  }
  await mkdir(to, { recursive: true });
  const copied: string[] = [];
  for (const entry of entries.sort()) {
    const target = join(to, entry);
    if (await exists(target)) continue;
    await cp(join(from, entry), target, { recursive: true, errorOnExist: false, force: false });
    copied.push(entry);
  }
  return copied;
}
