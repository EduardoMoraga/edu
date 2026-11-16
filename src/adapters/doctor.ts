import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { CliId, InstallManifest, InstallScope } from '../core/contracts.js';
import { binaryOnPath } from './common.js';
import { getManifestPath, isActionIntact } from './installer.js';
import { hasTopLevelTomlKey } from './merge.js';
import { readTarget } from './operations.js';
import { hostConfigDirs, samePath } from './paths.js';
import { CLI_IDS } from './types.js';
import { nativeIntegrations } from '../doctor/native.js';

export interface CliDiagnosis {
  cli: CliId;
  installed: boolean;
  integrated: boolean;
  drift: boolean;
  scopes: InstallScope[];
  /** Native installs found in the CLI's own config (plugin, package, plugin files), e.g. "Claude plugin edu@edu". */
  native: string[];
  notes: string[];
}

export interface DiagnoseOptions {
  root: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  detectBinary?: (binary: string) => Promise<boolean>;
  /** Root of the running edu-agent package, to spot a setup record that points somewhere else. */
  packageRoot?: string;
}

/** Problems with Edu's own install records, not tied to one CLI: corrupt files, a stale package root. */
export interface InstallProblem { level: 'fail' | 'warn'; text: string }

type Readable<T> = { value?: T; error?: string };

async function readJson<T>(path: string, valid: (value: unknown) => boolean): Promise<Readable<T>> {
  let text: string;
  try { text = await readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; return { error: `${path} cannot be read (${(error as Error).message})` }; }
  try {
    const value: unknown = JSON.parse(text);
    return valid(value) ? { value: value as T } : { error: `${path} is not a valid Edu record` };
  } catch (error) { return { error: `${path} is not valid JSON (${(error as Error).message})` }; }
}

const manifestShape = (value: unknown) => !!value && typeof value === 'object' && Array.isArray((value as InstallManifest).actions);
interface SetupRecord { packageRoot?: string; native?: CliId[] }
const setupShape = (value: unknown) => !!value && typeof value === 'object' && Array.isArray((value as SetupRecord).native);

/** Hosts that `edu setup` registers natively, through the host's own plugin command. */
const NATIVE_HOSTS: CliId[] = ['claude', 'codex', 'pi', 'agy'];

/**
 * Reports CLI binary availability separately from Edu integration health. A CLI is integrated when Edu
 * manages files for it (install manifest) or when Edu is installed natively (plugin / package; see doctor/native).
 * Drift uses the installer's own check (only Edu's keys, block or sections) and names each changed file.
 */
export async function diagnose(options: DiagnoseOptions): Promise<CliDiagnosis[]> {
  const root = resolve(options.root);
  const home = resolve(options.home ?? homedir());
  const env = options.env ?? {};
  const manifests = await Promise.all((['project', 'global'] as const).map(async scope => ({
    scope, manifest: (await readJson<InstallManifest>(getManifestPath(scope, root, home), manifestShape)).value,
  })));
  const setup = (await readJson<SetupRecord>(join(home, '.edu/plugin-setup.json'), setupShape)).value;
  const codexConfig = await readTarget(join(hostConfigDirs(home, env).codex, 'config.toml')).catch(() => undefined);
  let userOwnsCodexNotify = false;
  try { userOwnsCodexNotify = codexConfig !== undefined && hasTopLevelTomlKey(codexConfig.toString('utf8'), 'notify'); } catch { /* Reported as drift below. */ }
  const detect = options.detectBinary ?? binaryOnPath;
  const native = await nativeIntegrations(home, env);
  return Promise.all(CLI_IDS.map(async cli => {
    const notes: string[] = cli === 'agy' ? ['agy MCP: manual step'] : [];
    if (cli === 'codex' && userOwnsCodexNotify) notes.push('A user-owned top-level Codex notify command is preserved; Edu did not add its notify hook.');
    const scopes: InstallScope[] = [];
    const drifted: string[] = [];
    for (const { scope, manifest } of manifests) {
      const actions = manifest?.actions.filter(action => ((action as typeof action & { clis?: CliId[] }).clis ?? [action.cli]).includes(cli)) ?? [];
      if (!actions.length) continue;
      scopes.push(scope);
      for (const action of actions) {
        const content = await readTarget(action.path).catch(() => undefined);
        if (!await isActionIntact(action, content)) drifted.push(action.path);
      }
    }
    for (const path of drifted) notes.push(`Edu-managed part changed or missing: ${path} (edu install refuses until it is restored; edu uninstall --force removes Edu's part anyway)`);
    if (NATIVE_HOSTS.includes(cli) && native[cli].found.length && !setup?.native?.includes(cli)) {
      notes.push(`${native[cli].found.join(', ')} is registered but no Edu setup record tracks it, so edu uninstall will not remove it. Run edu setup --yes --cli ${cli} to track it.`);
    }
    notes.push(...native[cli].notes);
    return { cli, installed: await detect(cli), integrated: scopes.length > 0 || native[cli].found.length > 0, drift: drifted.length > 0, scopes, native: native[cli].found, notes };
  }));
}

/** Corrupt Edu records and a setup that points at a package root that moved or no longer exists. */
export async function installProblems(options: DiagnoseOptions): Promise<InstallProblem[]> {
  const root = resolve(options.root);
  const home = resolve(options.home ?? homedir());
  const problems: InstallProblem[] = [];
  const paths = [...new Set([getManifestPath('project', root, home), getManifestPath('global', root, home)])];
  for (const path of paths) {
    const read = await readJson<InstallManifest>(path, manifestShape);
    if (read.error) problems.push({ level: 'fail', text: `Edu install manifest ${read.error.slice(path.length + 1)}: ${path}. Restore it from a backup or remove it, then run edu install again.` });
  }
  const setupPath = join(home, '.edu/plugin-setup.json');
  const setup = await readJson<SetupRecord>(setupPath, setupShape);
  if (setup.error) problems.push({ level: 'fail', text: `Edu setup record ${setup.error.slice(setupPath.length + 1)}: ${setupPath}. Remove it and run edu setup --yes.` });
  const recorded = setup.value?.packageRoot;
  if (recorded && setup.value?.native?.length) {
    const exists = await stat(recorded).then(() => true, () => false);
    if (!exists) problems.push({ level: 'fail', text: `Edu setup points the host plugins at ${recorded}, which no longer exists. Run edu setup --yes to re-point them.` });
    else if (options.packageRoot && !samePath(recorded, resolve(options.packageRoot))) {
      problems.push({ level: 'warn', text: `Edu setup points the host plugins at ${recorded}, but this edu runs from ${resolve(options.packageRoot)}. Run edu setup --yes to re-point them.` });
    }
  }
  return problems;
}
