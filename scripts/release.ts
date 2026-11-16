/**
 * Release assets and an idempotent GitHub release, for .github/workflows/release.yml (tag pushes only).
 *
 *   node --experimental-strip-types scripts/release.ts check-tag <tag>       tag must be v<package.json version>
 *   node --experimental-strip-types scripts/release.ts assets <dir>          <dir>/edu-agent-<version>.tgz -> + edu-agent.tgz, SHA256SUMS
 *   node --experimental-strip-types scripts/release.ts publish <tag> <dir>   create or complete the release with those three assets
 *
 * Every release ships edu-agent-<version>.tgz, edu-agent.tgz and SHA256SUMS (`<sha256>  <file>`, as sha256sum
 * writes it). Publishing is safe to re-run: assets already published with the same digest are left alone, a
 * draft left by an interrupted run is completed, and a published asset is never replaced with different bytes.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LATEST_ASSET = 'edu-agent.tgz';
export const CHECKSUMS = 'SHA256SUMS';

export interface GhResult { status: number | null; stdout: string; stderr: string }
export type Gh = (args: string[]) => GhResult;

interface Release { isDraft: boolean; assets: Array<{ name: string; digest?: string | null }> }

/** Upload order: the tarballs first, SHA256SUMS last, so its presence means the set is complete. */
export const assetNames = (version: string): string[] => [`edu-agent-${version}.tgz`, LATEST_ASSET, CHECKSUMS];

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export function checkTag(tag: string, version: string): void {
  if (tag !== `v${version}`) throw new Error(`Tag ${tag} does not match package.json version ${version} (expected v${version})`);
}

/** Copies the packed tarball to edu-agent.tgz and writes SHA256SUMS for both. Returns the SHA256SUMS text. */
export async function writeAssets(dir: string, version: string): Promise<string> {
  const [versioned, latest] = assetNames(version) as [string, string];
  await copyFile(join(dir, versioned), join(dir, latest));
  const lines = await Promise.all([versioned, latest].map(async name => `${sha256(await readFile(join(dir, name)))}  ${name}`));
  const text = `${lines.join('\n')}\n`;
  await writeFile(join(dir, CHECKSUMS), text);
  return text;
}

function run(gh: Gh, args: string[]): string {
  const result = gh(args);
  if (result.status !== 0) throw new Error(`gh ${args.join(' ')} failed (${result.status}): ${result.stderr.trim()}`);
  return result.stdout;
}

function view(gh: Gh, tag: string): Release | undefined {
  const result = gh(['release', 'view', tag, '--json', 'isDraft,assets']);
  if (result.status === 0) return JSON.parse(result.stdout) as Release;
  if (/release not found/i.test(result.stderr)) return undefined;
  throw new Error(`gh release view ${tag} failed (${result.status}): ${result.stderr.trim()}`);
}

/** Creates the release (as a draft) or completes it, uploads what is missing, then publishes it. */
export async function publishRelease(options: { tag: string; version: string; dir: string; gh: Gh }): Promise<{ uploaded: string[]; published: boolean }> {
  const { tag, version, dir, gh } = options;
  checkTag(tag, version);
  const names = assetNames(version);
  const digests = new Map(await Promise.all(names.map(async name => [name, `sha256:${sha256(await readFile(join(dir, name)))}`] as const)));
  let release = view(gh, tag);
  if (!release) {
    run(gh, ['release', 'create', tag, '--draft', '--verify-tag', '--title', tag, '--generate-notes', ...(version.includes('-') ? ['--prerelease'] : [])]);
    release = { isDraft: true, assets: [] };
  }
  // Check every published asset before changing anything.
  for (const name of names) {
    const remote = release.assets.find(asset => asset.name === name);
    if (remote && remote.digest !== digests.get(name) && !release.isDraft) {
      throw new Error(`Release ${tag} already publishes ${name} as ${remote.digest ?? 'an unknown digest'}, not ${digests.get(name)}; refusing to replace a published asset`);
    }
  }
  const uploaded: string[] = [];
  for (const name of names) {
    const remote = release.assets.find(asset => asset.name === name);
    if (remote?.digest === digests.get(name)) continue;
    run(gh, ['release', 'upload', tag, join(dir, name), ...(remote ? ['--clobber'] : [])]);
    uploaded.push(name);
  }
  if (release.isDraft) run(gh, ['release', 'edit', tag, '--draft=false']);
  return { uploaded, published: release.isDraft };
}

const realGh: Gh = args => {
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { version: string };
  const [command, ...args] = process.argv.slice(2);
  if (command === 'check-tag' && args[0]) checkTag(args[0], version);
  else if (command === 'assets' && args[0]) process.stdout.write(await writeAssets(resolve(args[0]), version));
  else if (command === 'publish' && args[0] && args[1]) console.log(JSON.stringify(await publishRelease({ tag: args[0], version, dir: resolve(args[1]), gh: realGh })));
  else {
    console.error('Usage: scripts/release.ts check-tag <tag> | assets <dir> | publish <tag> <dir>');
    process.exitCode = 2;
  }
}
