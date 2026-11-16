import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Runs scripts/install.sh end to end against a fake GitHub: a preloaded module replaces `fetch` in the
 * script's Node verifier, and stub `npm` / `edu` commands record what they were asked to do. No network.
 */
const scripts = { sh: resolve('scripts/install.sh'), ps1: resolve('scripts/install.ps1') };
const pwsh = process.platform === 'win32' ? '' : spawnSync('sh', ['-c', 'command -v pwsh'], { encoding: 'utf8' }).stdout.trim();
const hasPwsh = Boolean(pwsh);
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

const PACKAGE = 'edu-agent package bytes';
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

interface Fake { tag: string; files: Record<string, string> }

async function install(fake: Fake, args: string[] = [], env: Record<string, string> = {}, shell: 'sh' | 'ps1' = 'sh') {
  const base = await mkdtemp(join(tmpdir(), 'edu-install-sh-'));
  dirs.push(base);
  const bin = join(base, 'bin');
  await mkdir(bin);
  const log = join(base, 'npm.log');
  // npm records its arguments and the bytes of the package it was given.
  await writeFile(join(bin, 'npm'), `#!/bin/sh\n[ "$1" = prefix ] && { echo "${base}/prefix"; exit 0; }\nprintf '%s\\n' "$*" >> "${log}"\nfor a in "$@"; do case "$a" in *.tgz) cat "$a" > "${base}/installed.tgz";; esac; done\nexit 0\n`);
  await writeFile(join(bin, 'edu'), '#!/bin/sh\n[ "$1" = --version ] && echo 6.0.0\nexit 0\n');
  await chmod(join(bin, 'npm'), 0o755);
  await chmod(join(bin, 'edu'), 0o755);
  const stub = join(base, 'fetch-stub.cjs');
  await writeFile(stub, `
const fake = ${JSON.stringify(fake)};
const prefix = 'https://github.com/EduardoMoraga/edu/releases/';
globalThis.fetch = async (url) => {
  url = String(url);
  if (url === prefix + 'latest') { const r = new Response(null, { status: 200 }); Object.defineProperty(r, 'url', { value: prefix + 'tag/' + fake.tag }); return r; }
  if (!url.startsWith(prefix + 'download/')) throw new Error('unexpected network access: ' + url);
  const [tag, name] = url.slice((prefix + 'download/').length).split('/');
  const body = tag === fake.tag ? fake.files[name] : undefined;
  return body === undefined ? new Response('missing', { status: 404 }) : new Response(body);
};
`);
  const command = shell === 'sh' ? ['sh', [scripts.sh, '--yes', ...args]] as const : [pwsh, ['-NoProfile', '-NonInteractive', '-File', scripts.ps1]] as const;
  const result = spawnSync(command[0], [...command[1]], {
    encoding: 'utf8', input: '',
    env: { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: base, EDU_LANG: 'en', NODE_OPTIONS: `--require ${stub}`, ...env },
  });
  const npm = await readFile(log, 'utf8').catch(() => '');
  const installed = await readFile(join(base, 'installed.tgz'), 'utf8').catch(() => undefined);
  return { status: result.status, output: `${result.stdout}${result.stderr}`, npm, installed };
}

describe.skipIf(process.platform === 'win32')('scripts/install.sh release verification', () => {
  it('installs the latest release only after its checksum matches SHA256SUMS', async () => {
    const result = await install({ tag: 'v6.0.0', files: { 'edu-agent.tgz': PACKAGE, SHA256SUMS: `${digest(PACKAGE)}  edu-agent.tgz\n` } });
    expect(result.status).toBe(0);
    expect(result.installed).toBe(PACKAGE);
    expect(result.npm).toMatch(/^install -g \/.+\/edu-agent\.tgz --no-fund --no-audit$/m);
    expect(result.npm).not.toContain('https://');
  });

  it('refuses a package whose checksum does not match, before npm runs', async () => {
    const result = await install({ tag: 'v6.0.0', files: { 'edu-agent.tgz': 'tampered', SHA256SUMS: `${digest(PACKAGE)}  edu-agent.tgz\n` } });
    expect(result.status).toBe(1);
    expect(result.output).toContain('Checksum mismatch for edu-agent.tgz');
    expect(result.npm).toBe('');
  });

  it('refuses an asset URL outside the release download origin', async () => {
    const result = await install({ tag: 'v6.0.0', files: {} }, [], { EDU_ASSET: 'https://example.invalid/evil.tgz' });
    expect(result.status).toBe(1);
    expect(result.output).toContain('Refusing https://example.invalid/evil.tgz');
    expect(result.npm).toBe('');
  });

  it('installs a pre-6.0 release without SHA256SUMS only with --allow-unverified', async () => {
    const legacy = { tag: 'v5.0.1', files: { 'edu-agent.tgz': PACKAGE } };
    const refused = await install(legacy);
    expect(refused.status).toBe(1);
    expect(refused.output).toContain('--allow-unverified');
    expect(refused.npm).toBe('');
    const allowed = await install(legacy, ['--allow-unverified']);
    expect(allowed.status).toBe(0);
    expect(allowed.output).toContain('WITHOUT a checksum check');
    expect(allowed.installed).toBe(PACKAGE);
    const modern = await install({ tag: 'v6.1.0', files: { 'edu-agent.tgz': PACKAGE } }, ['--allow-unverified']);
    expect(modern.status).toBe(1);
    expect(modern.output).toContain('publishes no SHA256SUMS');
  });

  it('plans the verified install in a dry run without any download', async () => {
    const result = await install({ tag: 'v6.0.0', files: {} }, ['--dry-run']);
    expect(result.status).toBe(0);
    expect(result.output).toContain('[dry-run] download edu-agent.tgz and SHA256SUMS');
    expect(result.output).toContain('[dry-run] npm install -g');
  });
});

describe.skipIf(!hasPwsh)('scripts/install.ps1 release verification', () => {
  it('installs the verified package and refuses a mismatched or foreign one', async () => {
    const good = await install({ tag: 'v6.0.0', files: { 'edu-agent.tgz': PACKAGE, SHA256SUMS: `${digest(PACKAGE)}  edu-agent.tgz\n` } }, [], {}, 'ps1');
    expect(good.output).not.toMatch(/Exception|error/i);
    expect(good.status).toBe(0);
    expect(good.installed).toBe(PACKAGE);
    const bad = await install({ tag: 'v6.0.0', files: { 'edu-agent.tgz': 'tampered', SHA256SUMS: `${digest(PACKAGE)}  edu-agent.tgz\n` } }, [], {}, 'ps1');
    expect(bad.status).toBe(1);
    expect(bad.output).toContain('Checksum mismatch');
    expect(bad.npm).toBe('');
    const foreign = await install({ tag: 'v6.0.0', files: {} }, [], { EDU_ASSET: 'https://example.invalid/evil.tgz' }, 'ps1');
    expect(foreign.status).toBe(1);
    expect(foreign.npm).toBe('');
    const legacy = await install({ tag: 'v5.0.1', files: { 'edu-agent.tgz': PACKAGE } }, [], { EDU_ALLOW_UNVERIFIED: '1' }, 'ps1');
    expect(legacy.status).toBe(0);
    expect(legacy.output).toContain('WITHOUT a checksum check');
  }, 90_000); // Each PowerShell start takes a few seconds.
});
