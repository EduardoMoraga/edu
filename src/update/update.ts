/**
 * `edu update`: compare the running version with a GitHub release and, when asked, download its package
 * and SHA256SUMS from the pinned release origin, verify the checksum, install the verified local file
 * with the npm that belongs to the running Node, verify the version, then run the NEW binary's
 * `setup --yes` and its workspace migration hook. Network and processes are injected (`UpdateDeps`).
 * A failed download or checksum stops before npm runs; a failed install stops before setup.
 */
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join as hostJoin, posix, win32 } from 'node:path';
import { CHECKSUMS_ASSET, compareVersions, fetchRelease, parseChecksums, predatesChecksums, sha256Hex, trustedAssetUrl, type Release } from './release.js';
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

export type StepName = 'download' | 'install' | 'verify' | 'setup' | 'migrate';
export type StepStatus = 'ok' | 'failed' | 'skipped';
export interface StepResult { step: StepName; status: StepStatus; detail?: string }
/** `verified`: the package matched the release's SHA256SUMS (false only for a pre-6.0 release with --allow-unverified). */
export interface UpdateOutcome { ok: boolean; installed: boolean; verified?: boolean; steps: StepResult[]; migrations?: WorkspaceMigration[] }
export interface UpdateOptions { /** Install a release that predates SHA256SUMS (5.x and earlier). */ allowUnverified?: boolean }

async function download(deps: Pick<UpdateDeps, 'fetch' | 'currentVersion'>, url: string): Promise<Uint8Array> {
  let response: Response;
  try { response = await deps.fetch(url, { headers: { 'user-agent': `edu-agent/${deps.currentVersion}` }, signal: AbortSignal.timeout(10 * 60_000) }); }
  catch (error) { throw new Error(`cannot download ${url} (${error instanceof Error ? error.message : String(error)})`); }
  if (!response.ok) throw new Error(`GitHub answered HTTP ${response.status} for ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * The release package, downloaded only from the pinned origin and checked against SHA256SUMS. A release
 * with no SHA256SUMS is refused, except a pre-6.0 one with `allowUnverified`.
 */
export async function downloadVerified(deps: Pick<UpdateDeps, 'fetch' | 'currentVersion'>, release: Release, options: UpdateOptions = {}): Promise<{ data: Uint8Array; verified: boolean; sha256: string }> {
  if (!trustedAssetUrl(release.assetUrl, release.tag, release.assetName)) throw new Error(`refusing ${release.assetUrl}: Edu installs only from the release download URL of ${release.tag}`);
  if (release.checksumsUrl && !trustedAssetUrl(release.checksumsUrl, release.tag, CHECKSUMS_ASSET)) throw new Error(`refusing ${release.checksumsUrl}: not the SHA256SUMS of ${release.tag}`);
  if (!release.checksumsUrl) {
    if (!predatesChecksums(release.version)) throw new Error(`release ${release.tag} publishes no ${CHECKSUMS_ASSET}, so its package cannot be verified; nothing was installed`);
    if (!options.allowUnverified) throw new Error(`release ${release.tag} predates verified releases (no ${CHECKSUMS_ASSET}); rerun with --allow-unverified to install it anyway`);
  }
  const data = await download(deps, release.assetUrl);
  const actual = sha256Hex(data);
  if (!release.checksumsUrl) return { data, verified: false, sha256: actual };
  const expected = parseChecksums(new TextDecoder().decode(await download(deps, release.checksumsUrl))).get(release.assetName);
  if (!expected) throw new Error(`${CHECKSUMS_ASSET} of ${release.tag} lists no ${release.assetName}; nothing was installed`);
  if (expected !== actual) throw new Error(`checksum mismatch for ${release.assetName}: ${CHECKSUMS_ASSET} says ${expected}, the download is ${actual}; nothing was installed`);
  return { data, verified: true, sha256: actual };
}

export async function checkForUpdate(deps: Pick<UpdateDeps, 'fetch' | 'currentVersion' | 'env'>, tag?: string): Promise<UpdateCheck> {
  const release = await fetchRelease({
    fetch: deps.fetch, ...(tag ? { tag } : {}), userAgent: `edu-agent/${deps.currentVersion}`,
    ...(deps.env.GITHUB_TOKEN ? { token: deps.env.GITHUB_TOKEN } : {}),
  });
  const cmp = compareVersions(release.version, deps.currentVersion);
  return { current: deps.currentVersion, release, relation: cmp > 0 ? 'newer' : cmp < 0 ? 'older' : 'same' };
}

/** Path rules of the target platform (not the host), so paths match what that platform's npm and node report. */
const pathFor = (platform: NodeJS.Platform) => (platform === 'win32' ? win32 : posix);

/** The npm installed next to the running Node (so a non-default prefix like ~/.hermes/node is respected), else `npm` on PATH. */
export async function resolveNpm(deps: Pick<UpdateDeps, 'execPath' | 'platform' | 'exists'>): Promise<string> {
  const { dirname, join } = pathFor(deps.platform);
  const candidate = join(dirname(deps.execPath), deps.platform === 'win32' ? 'npm.cmd' : 'npm');
  return (await deps.exists(candidate)) ? candidate : 'npm';
}

/**
 * The npm global prefix the running edu was installed into, inferred from its path
 * (`<prefix>/lib/node_modules/edu-agent` on POSIX, `<prefix>\node_modules\edu-agent` on Windows);
 * undefined for a source checkout or `npm link`.
 */
export function installPrefix(packageRoot: string, platform: NodeJS.Platform): string | undefined {
  const { basename, dirname } = pathFor(platform);
  const modules = dirname(packageRoot);
  if (basename(modules) !== 'node_modules') return undefined;
  if (platform === 'win32') return dirname(modules);
  return basename(dirname(modules)) === 'lib' ? dirname(dirname(modules)) : undefined;
}

const tail = (text: string, lines = 8) => text.trim().split('\n').slice(-lines).join('\n');

export async function performUpdate(deps: UpdateDeps, release: Release, onStep: (step: StepName) => void = () => {}, options: UpdateOptions = {}): Promise<UpdateOutcome> {
  onStep('download');
  let fetched: Awaited<ReturnType<typeof downloadVerified>>;
  try { fetched = await downloadVerified(deps, release, options); }
  catch (error) {
    return { ok: false, installed: false, steps: [{ step: 'download', status: 'failed', detail: error instanceof Error ? error.message : String(error) }] };
  }
  // npm installs the verified bytes from a private temporary folder, never the URL itself.
  const folder = await mkdtemp(hostJoin(tmpdir(), 'edu-update-'));
  try {
    const tarball = hostJoin(folder, release.assetName);
    await writeFile(tarball, fetched.data);
    const outcome = await installVerified(deps, release, tarball, onStep, fetched.verified
      ? { step: 'download', status: 'ok', detail: `sha256 ${fetched.sha256} matches ${CHECKSUMS_ASSET}` }
      : { step: 'download', status: 'ok', detail: `UNVERIFIED: ${release.tag} has no ${CHECKSUMS_ASSET} (installed with --allow-unverified)` });
    return { ...outcome, verified: fetched.verified };
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

async function installVerified(deps: UpdateDeps, release: Release, tarball: string, onStep: (step: StepName) => void, downloaded: StepResult): Promise<UpdateOutcome> {
  const { join } = pathFor(deps.platform);
  const steps: StepResult[] = [downloaded];
  const done = (outcome: Omit<UpdateOutcome, 'steps'>): UpdateOutcome => ({ ...outcome, steps });
  const npm = await resolveNpm(deps);
  const prefix = installPrefix(deps.packageRoot, deps.platform);
  const prefixArgs = prefix ? ['--prefix', prefix] : [];

  onStep('install');
  const install = await deps.run(npm, ['install', '-g', tarball, '--no-fund', '--no-audit', ...prefixArgs], { env: deps.env, timeoutMs: 10 * 60_000 });
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

  // New releases migrate before setup so backup failures stop further workspace changes.
  // The 0.10.2 caller itself has the old order; its setup boundary needs the release gate too.
  let migrations: WorkspaceMigration[] | undefined;
  async function migrateWorkspaces(): Promise<boolean> {
    onStep('migrate');
    const result = await deps.run(deps.execPath, [cli, 'internal', 'migrate-workspaces', '--json'], { env: deps.env, timeoutMs: 10 * 60_000 });
    if (result.code !== 0 && /unknown command|too many arguments/i.test(result.stderr)) {
      steps.push({ step: 'migrate', status: 'skipped', detail: `edu ${release.version} has no workspace migration hook` });
      return false;
    }
    try {
      const parsed: unknown = JSON.parse(result.stdout);
      if (!Array.isArray(parsed) || !parsed.length || !parsed.every(m => m && typeof m === 'object' && typeof m.name === 'string' && typeof m.root === 'string' && ['migrated', 'missing', 'no-brain', 'failed'].includes(m.status))) throw new Error('invalid migration report');
      migrations = parsed;
      const failed = migrations.filter(m => m.status !== 'migrated');
      if (Number(release.version.split('.')[0]) >= 2 && !migrations.some(m => m.name === 'global' && m.status === 'migrated')) throw new Error('global migration absent or unsuccessful');
      const ok = result.code === 0 && !failed.length;
      steps.push({ step: 'migrate', status: ok ? 'ok' : 'failed', ...(!ok ? { detail: failed.map(m => `${m.name}: ${m.detail ?? m.status}`).join('; ') || tail(result.stderr) || `exit ${result.code}` } : {}) });
      return ok;
    } catch (error) {
      steps.push({ step: 'migrate', status: 'failed', detail: `invalid or incomplete migration report: ${error instanceof Error ? error.message : String(error)}${result.stderr ? `; ${tail(result.stderr)}` : ''}` });
      return false;
    }
  }
  const migrateFirst = Number(release.version.split('.')[0]) >= 2;
  if (migrateFirst && !await migrateWorkspaces()) return done({ ok: false, installed: true, ...(migrations ? { migrations } : {}) });
  onStep('setup');
  const setup = await deps.run(deps.execPath, [cli, 'setup', '--yes'], { env: deps.env, timeoutMs: 5 * 60_000 });
  steps.push(setup.code === 0
    ? { step: 'setup', status: 'ok', detail: tail(setup.stdout, 12) }
    : { step: 'setup', status: 'failed', detail: tail(setup.stderr || setup.stdout) || `exit ${setup.code}` });
  if (!migrateFirst) await migrateWorkspaces();

  return done({ ok: steps.every(s => s.status === 'ok'), installed: true, ...(migrations ? { migrations } : {}) });
}

export async function fileExists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}
