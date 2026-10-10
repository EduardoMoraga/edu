/**
 * `edu update`: compare the running version with a GitHub release and, when asked, install it with the
 * npm that belongs to the running Node, verify it, run the NEW binary's `setup --yes` and its workspace
 * migration hook. Network and processes are injected (`UpdateDeps`) so tests use fakes.
 * Never leaves the user broken: a failed install stops before setup and keeps the current version.
 */
import { access } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { compareVersions, fetchRelease, type Release } from './release.js';
import type { WorkspaceMigration } from './migrate.js';

export interface RunResult { code: number; stdout: string; stderr: string }
export type Runner = (command: string, args: string[], opts?: { env?: NodeJS.ProcessEnv; timeoutMs?: number }) => Promise<RunResult>;

export interface UpdateDeps {
  fetch: typeof fetch;
  run: Runner;
  exists(path: string): Promise<boolean>;
  /** `process.execPath`: the Node running this edu. */
  execPath: string;
  platform: NodeJS.Platform;
  /** Root of the running edu-agent package. */
  packageRoot: string;
  currentVersion: string;
  env: NodeJS.ProcessEnv;
}

export type Relation = 'older' | 'same' | 'newer';
export interface UpdateCheck { current: string; release: Release; relation: Relation }

export type StepName = 'install' | 'verify' | 'setup' | 'migrate';
export type StepStatus = 'ok' | 'failed' | 'skipped';
export interface StepResult { step: StepName; status: StepStatus; detail?: string }
export interface UpdateOutcome { ok: boolean; installed: boolean; steps: StepResult[]; migrations?: WorkspaceMigration[] }

export async function checkForUpdate(deps: Pick<UpdateDeps, 'fetch' | 'currentVersion' | 'env'>, tag?: string): Promise<UpdateCheck> {
  const release = await fetchRelease({
    fetch: deps.fetch, ...(tag ? { tag } : {}), userAgent: `edu-agent/${deps.currentVersion}`,
    ...(deps.env.GITHUB_TOKEN ? { token: deps.env.GITHUB_TOKEN } : {}),
  });
  const cmp = compareVersions(release.version, deps.currentVersion);
  return { current: deps.currentVersion, release, relation: cmp > 0 ? 'newer' : cmp < 0 ? 'older' : 'same' };
}

/** The npm installed next to the running Node (so a non-default prefix like ~/.hermes/node is respected), else `npm` on PATH. */
export async function resolveNpm(deps: Pick<UpdateDeps, 'execPath' | 'platform' | 'exists'>): Promise<string> {
  const candidate = join(dirname(deps.execPath), deps.platform === 'win32' ? 'npm.cmd' : 'npm');
  return (await deps.exists(candidate)) ? candidate : 'npm';
}

/**
 * The npm global prefix the running edu was installed into, inferred from its path
 * (`<prefix>/lib/node_modules/edu-agent` on POSIX, `<prefix>\node_modules\edu-agent` on Windows);
 * undefined for a source checkout or `npm link`.
 */
export function installPrefix(packageRoot: string, platform: NodeJS.Platform): string | undefined {
  const modules = dirname(packageRoot);
  if (basename(modules) !== 'node_modules') return undefined;
  if (platform === 'win32') return dirname(modules);
  return basename(dirname(modules)) === 'lib' ? dirname(dirname(modules)) : undefined;
}

const tail = (text: string, lines = 8) => text.trim().split('\n').slice(-lines).join('\n');

export async function performUpdate(deps: UpdateDeps, release: Release, onStep: (step: StepName) => void = () => {}): Promise<UpdateOutcome> {
  const steps: StepResult[] = [];
  const done = (outcome: Omit<UpdateOutcome, 'steps'>): UpdateOutcome => ({ ...outcome, steps });
  const npm = await resolveNpm(deps);
  const prefix = installPrefix(deps.packageRoot, deps.platform);
  const prefixArgs = prefix ? ['--prefix', prefix] : [];

  onStep('install');
  const install = await deps.run(npm, ['install', '-g', release.assetUrl, '--no-fund', '--no-audit', ...prefixArgs], { env: deps.env, timeoutMs: 10 * 60_000 });
  if (install.code !== 0) {
    steps.push({ step: 'install', status: 'failed', detail: tail(install.stderr || install.stdout) || `npm exited with ${install.code}` });
    return done({ ok: false, installed: false });
  }
  steps.push({ step: 'install', status: 'ok', detail: `${npm}${prefix ? ` (prefix ${prefix})` : ''}` });

  onStep('verify');
  const root = await deps.run(npm, ['root', '-g', ...prefixArgs], { env: deps.env });
  const modules = root.code === 0 && root.stdout.trim() ? root.stdout.trim().split('\n').at(-1)!.trim() : prefix ? (deps.platform === 'win32' ? join(prefix, 'node_modules') : join(prefix, 'lib', 'node_modules')) : '';
  const cli = modules ? join(modules, 'edu-agent', 'dist', 'cli.js') : '';
  if (!cli || !(await deps.exists(cli))) {
    steps.push({ step: 'verify', status: 'failed', detail: `installed, but the new edu was not found${cli ? ` at ${cli}` : ''}` });
    return done({ ok: false, installed: true });
  }
  const version = await deps.run(deps.execPath, [cli, '--version'], { env: deps.env });
  const reported = version.stdout.trim().split('\n').at(-1)?.trim() ?? '';
  if (version.code !== 0 || reported !== release.version) {
    steps.push({ step: 'verify', status: 'failed', detail: `${cli} reports "${reported || tail(version.stderr, 2)}", expected ${release.version}` });
    return done({ ok: false, installed: true });
  }
  steps.push({ step: 'verify', status: 'ok', detail: cli });

  // From here the new code runs: setup and migration are child processes of the NEW binary.
  onStep('setup');
  const setup = await deps.run(deps.execPath, [cli, 'setup', '--yes'], { env: deps.env, timeoutMs: 5 * 60_000 });
  steps.push(setup.code === 0
    ? { step: 'setup', status: 'ok', detail: tail(setup.stdout, 12) }
    : { step: 'setup', status: 'failed', detail: tail(setup.stderr || setup.stdout) || `exit ${setup.code}` });

  onStep('migrate');
  const migrate = await deps.run(deps.execPath, [cli, 'internal', 'migrate-workspaces', '--json'], { env: deps.env, timeoutMs: 10 * 60_000 });
  let migrations: WorkspaceMigration[] | undefined;
  if (migrate.code === 0) {
    try {
      migrations = JSON.parse(migrate.stdout) as WorkspaceMigration[];
      const failed = migrations.filter(m => m.status === 'failed');
      steps.push({ step: 'migrate', status: failed.length ? 'failed' : 'ok', ...(failed.length ? { detail: failed.map(m => `${m.name}: ${m.detail ?? 'failed'}`).join('; ') } : {}) });
    } catch {
      steps.push({ step: 'migrate', status: 'failed', detail: 'the migration hook did not return JSON' });
    }
  } else if (/unknown command|too many arguments/i.test(migrate.stderr)) {
    steps.push({ step: 'migrate', status: 'skipped', detail: `edu ${release.version} has no workspace migration hook` });
  } else {
    steps.push({ step: 'migrate', status: 'failed', detail: tail(migrate.stderr || migrate.stdout) || `exit ${migrate.code}` });
  }
  return done({ ok: steps.every(s => s.status !== 'failed'), installed: true, ...(migrations ? { migrations } : {}) });
}

export async function fileExists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}
