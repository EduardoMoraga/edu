/**
 * Fast reads of a workspace's settings: the effective config and the identity name. config.json is
 * validated lazily (./config.js loads zod), so paths such as `edu statusline` stay fast.
 */
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readWorkspaceSettings } from '../brain/location.js';
import type { CliId, EduConfig } from '../core/contracts.js';

/** Loads `<root>/config.json`; falls back to defaults with the first detected CLI. */
export async function effectiveConfig(root: string, detected: CliId[]): Promise<EduConfig> {
  const { defaultConfig, loadConfig } = await import('./config.js');
  const path = join(root, 'config.json');
  const present = await access(path).then(() => true, () => false);
  return present ? loadConfig(path) : defaultConfig(detected[0] ?? 'claude');
}

/** Identity name: `identity.name` in config.json, else the first heading of EDU.md (`# Name — the contract`). */
export async function identityName(root: string): Promise<string> {
  const configured = (await readWorkspaceSettings(root)).identity?.name;
  if (configured) return configured;
  try {
    const text = await readFile(join(root, 'EDU.md'), 'utf8');
    const heading = /^#\s+(.+?)(?:\s+[—-]\s+.*)?$/m.exec(text)?.[1]?.trim();
    return heading && heading !== '{{name}}' ? heading : 'Edu';
  } catch {
    return 'Edu';
  }
}
