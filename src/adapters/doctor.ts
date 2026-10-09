import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { CliId, InstallManifest, InstallScope } from '../core/contracts.js';
import { binaryOnPath } from './common.js';
import { getManifestPath } from './installer.js';
import { readTarget, sha256 } from './operations.js';
import { CLI_IDS } from './types.js';

export interface CliDiagnosis {
  cli: CliId;
  installed: boolean;
  integrated: boolean;
  drift: boolean;
  scopes: InstallScope[];
  notes: string[];
}

export interface DiagnoseOptions {
  root: string;
  home?: string;
  detectBinary?: (binary: string) => Promise<boolean>;
}

async function readManifest(path: string): Promise<InstallManifest | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!value || typeof value !== 'object' || !Array.isArray((value as InstallManifest).actions)) throw new Error('Invalid manifest');
    return value as InstallManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Reports CLI binary availability separately from Edu integration health. */
export async function diagnose(options: DiagnoseOptions): Promise<CliDiagnosis[]> {
  const root = resolve(options.root);
  const home = resolve(options.home ?? homedir());
  const manifests = await Promise.all((['project', 'global'] as const).map(async scope => ({
    scope, manifest: await readManifest(getManifestPath(scope, root, home)),
  })));
  const detect = options.detectBinary ?? binaryOnPath;
  return Promise.all(CLI_IDS.map(async cli => {
    const notes: string[] = cli === 'agy' ? ['agy MCP: manual step'] : [];
    const scopes: InstallScope[] = [];
    let drift = false;
    for (const { scope, manifest } of manifests) {
      const actions = manifest?.actions.filter(action => ((action as typeof action & { clis?: CliId[] }).clis ?? [action.cli]).includes(cli)) ?? [];
      if (!actions.length) continue;
      scopes.push(scope);
      for (const action of actions) {
        const content = await readTarget(action.path);
        if (!content || !action.sha256 || sha256(content) !== action.sha256) drift = true;
      }
    }
    if (drift) notes.push('Edu-managed files differ from the manifest');
    return { cli, installed: await detect(cli), integrated: scopes.length > 0, drift, scopes, notes };
  }));
}
