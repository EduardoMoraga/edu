/**
 * GitHub release lookup for `edu update`: the latest (or a tagged) release of EduardoMoraga/edu,
 * the package asset to install, its SHA256SUMS, version comparison and a short "what's new".
 *
 * Release integrity contract: every release ships `edu-agent-<version>.tgz`, `edu-agent.tgz` and
 * `SHA256SUMS` (sha256sum format), and the updater accepts only URLs under
 * https://github.com/EduardoMoraga/edu/releases/download/<tag>/.
 */
import { createHash } from 'node:crypto';

export const RELEASES_API = 'https://api.github.com/repos/EduardoMoraga/edu/releases';
export const RELEASE_DOWNLOAD_PREFIX = 'https://github.com/EduardoMoraga/edu/releases/download/';
export const CHECKSUMS_ASSET = 'SHA256SUMS';
/** Releases from this major on always publish SHA256SUMS; older ones install only with --allow-unverified. */
export const FIRST_VERIFIED_MAJOR = 6;
export const RELEASE_TIMEOUT_MS = 10_000;

export interface Release { tag: string; version: string; name: string; body: string; url: string; assetUrl: string; assetName: string; checksumsUrl?: string }

export type UpdateErrorCode = 'offline' | 'not-found' | 'http' | 'no-asset' | 'untrusted' | 'unverified';
export class UpdateError extends Error {
  constructor(readonly code: UpdateErrorCode, message: string) { super(message); this.name = 'UpdateError'; }
}

interface GitHubRelease { tag_name?: string; name?: string; body?: string; html_url?: string; draft?: boolean; assets?: Array<{ name?: string; browser_download_url?: string }> }

/** `v0.8.0` / `0.8.0` → `0.8.0`. */
export const normalizeVersion = (tag: string): string => tag.trim().replace(/^v/i, '');
export const releaseTag = (version: string): string => `v${normalizeVersion(version)}`;

/** Semver-ish compare: numeric core, a pre-release sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core = '', pre] = normalizeVersion(v).split('-', 2);
    return { nums: core.split('.').map(n => Number.parseInt(n, 10) || 0), pre };
  };
  const x = parse(a); const y = parse(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length, 3); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === undefined) return 1;
  if (y.pre === undefined) return -1;
  return x.pre.localeCompare(y.pre, 'en', { numeric: true });
}

/** Prefers the versioned asset `edu-agent-<v>.tgz`, then the stable `edu-agent.tgz`. */
export function pickAsset(assets: GitHubRelease['assets'], version: string): { name: string; url: string } | undefined {
  const list = (assets ?? []).filter((a): a is { name: string; browser_download_url: string } => Boolean(a.name && a.browser_download_url));
  const hit = list.find(a => a.name === `edu-agent-${version}.tgz`) ?? list.find(a => a.name === 'edu-agent.tgz');
  return hit ? { name: hit.name, url: hit.browser_download_url } : undefined;
}

const TAG = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Whether `url` is exactly `<RELEASE_DOWNLOAD_PREFIX><tag>/<name>`: the pinned origin, nothing else. */
export function trustedAssetUrl(url: string, tag: string, name: string): boolean {
  return TAG.test(tag) && /^[\w.-]+$/.test(name) && url === `${RELEASE_DOWNLOAD_PREFIX}${tag}/${name}`;
}

/** `<64-hex>  <file>` lines (sha256sum format; ` *file` binary mode too) → file → lowercase digest. */
export function parseChecksums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64}) [ *](\S.*)$/.exec(line.trimEnd());
    if (match) sums.set(match[2]!, match[1]!.toLowerCase());
  }
  return sums;
}

export const sha256Hex = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

/** Whether a release predates SHA256SUMS (5.x and earlier), so --allow-unverified may install it. */
export const predatesChecksums = (version: string) => (Number.parseInt(normalizeVersion(version).split('.')[0] ?? '', 10) || 0) < FIRST_VERIFIED_MAJOR;

export interface FetchReleaseOptions {
  fetch: typeof fetch;
  /** A tag or version (`v0.7.0`, `0.7.0`); omitted = latest. */
  tag?: string;
  timeoutMs?: number;
  userAgent?: string;
  token?: string;
}

export async function fetchRelease(opts: FetchReleaseOptions): Promise<Release> {
  const url = opts.tag ? `${RELEASES_API}/tags/${encodeURIComponent(releaseTag(opts.tag))}` : `${RELEASES_API}/latest`;
  const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'user-agent': opts.userAgent ?? 'edu-agent' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let response: Response;
  try {
    response = await opts.fetch(url, { headers, signal: AbortSignal.timeout(opts.timeoutMs ?? RELEASE_TIMEOUT_MS) });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new UpdateError('offline', timedOut ? `GitHub did not answer in ${Math.round((opts.timeoutMs ?? RELEASE_TIMEOUT_MS) / 1000)} s` : `cannot reach GitHub (${error instanceof Error ? error.message : String(error)})`);
  }
  if (response.status === 404) throw new UpdateError('not-found', opts.tag ? `release ${releaseTag(opts.tag)} not found` : 'no published release found');
  if (!response.ok) {
    const limited = response.status === 403 || response.status === 429;
    throw new UpdateError('http', limited ? `GitHub API rate limit reached (HTTP ${response.status}); try again later or set GITHUB_TOKEN` : `GitHub API answered HTTP ${response.status}`);
  }
  const data = await response.json() as GitHubRelease;
  if (!data.tag_name) throw new UpdateError('http', 'GitHub answered without a release tag');
  const version = normalizeVersion(data.tag_name);
  const asset = pickAsset(data.assets, version);
  if (!asset) throw new UpdateError('no-asset', `release ${data.tag_name} has no edu-agent .tgz asset`);
  const sums = (data.assets ?? []).find(a => a.name === CHECKSUMS_ASSET && a.browser_download_url);
  for (const item of [asset, ...(sums ? [{ name: CHECKSUMS_ASSET, url: sums.browser_download_url! }] : [])]) {
    if (!trustedAssetUrl(item.url, data.tag_name, item.name)) {
      throw new UpdateError('untrusted', `release ${data.tag_name} serves ${item.name} from ${item.url}, not from ${RELEASE_DOWNLOAD_PREFIX}${data.tag_name}/; refusing it`);
    }
  }
  return {
    tag: data.tag_name, version, name: data.name ?? data.tag_name, body: data.body ?? '', url: data.html_url ?? `https://github.com/EduardoMoraga/edu/releases/tag/${data.tag_name}`,
    assetUrl: asset.url, assetName: asset.name, ...(sums ? { checksumsUrl: sums.browser_download_url! } : {}),
  };
}

/** The release notes, as a few plain lines: markdown marks stripped, empty lines dropped, long lines clipped. */
export function whatsNew(body: string, maxLines = 6, width = 160): string[] {
  const lines = body.replace(/\r/g, '').split('\n')
    .map(line => line.replace(/^#{1,6}\s+/, '').replace(/^\s*[-*+]\s+/, '• ').replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').trim())
    .filter(Boolean)
    .map(line => (line.length > width ? `${line.slice(0, width - 1)}…` : line));
  return lines.length > maxLines ? [...lines.slice(0, maxLines), '…'] : lines;
}
