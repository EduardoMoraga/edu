import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkTag, publishRelease, writeAssets, type Gh } from './release.ts';

const VERSION = '6.0.0';
const TAG = `v${VERSION}`;
const digest = (bytes: Buffer | string) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function packed(content = 'packed tarball bytes') {
  const dir = await mkdtemp(join(tmpdir(), 'edu-release-')); roots.push(dir);
  await writeFile(join(dir, `edu-agent-${VERSION}.tgz`), content);
  await writeAssets(dir, VERSION);
  return dir;
}

/** An in-memory GitHub release, driven through the same gh argv the workflow uses. */
function fakeGh(initial?: { isDraft: boolean; assets: Record<string, string> }) {
  let release = initial && { isDraft: initial.isDraft, assets: new Map(Object.entries(initial.assets)) };
  const calls: string[][] = [];
  const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
  const gh: Gh = args => {
    calls.push(args);
    const [, verb, , file] = args;
    if (verb === 'view') {
      if (!release) return { status: 1, stdout: '', stderr: 'release not found' };
      return ok(JSON.stringify({ isDraft: release.isDraft, assets: [...release.assets].map(([name, d]) => ({ name, digest: d })) }));
    }
    if (verb === 'create') { release = { isDraft: args.includes('--draft'), assets: new Map() }; return ok(); }
    if (!release) return { status: 1, stdout: '', stderr: 'release not found' };
    if (verb === 'upload') {
      const name = basename(file!);
      if (release.assets.has(name) && !args.includes('--clobber')) return { status: 1, stdout: '', stderr: 'asset under the same name already exists' };
      release.assets.set(name, digest(readFileSync(file!)));
      return ok();
    }
    if (verb === 'edit' && args.includes('--draft=false')) { release.isDraft = false; return ok(); }
    return { status: 2, stdout: '', stderr: `unexpected gh ${args.join(' ')}` };
  };
  return { gh, calls, release: () => release, uploads: () => calls.filter(call => call[1] === 'upload').map(call => basename(call[3]!)) };
}

describe('release assets', () => {
  it('copies the versioned tarball to edu-agent.tgz and checksums both in sha256sum format', async () => {
    const dir = await packed();
    const tarball = await readFile(join(dir, `edu-agent-${VERSION}.tgz`));
    expect(await readFile(join(dir, 'edu-agent.tgz'))).toEqual(tarball);
    const lines = (await readFile(join(dir, 'SHA256SUMS'), 'utf8')).split('\n');
    expect(lines.pop()).toBe('');
    const hex = digest(tarball).slice('sha256:'.length);
    expect(lines).toEqual([`${hex}  edu-agent-${VERSION}.tgz`, `${hex}  edu-agent.tgz`]);
    for (const line of lines) expect(line).toMatch(/^[0-9a-f]{64} {2}\S+$/);
  });

  it('requires the tag to be v<package.json version>', () => {
    expect(() => checkTag('v6.0.0', '6.0.0')).not.toThrow();
    expect(() => checkTag('v6.0.1', '6.0.0')).toThrow(/does not match/);
    expect(() => checkTag('6.0.0', '6.0.0')).toThrow(/expected v6.0.0/);
  });
});

describe('publishRelease', () => {
  it('creates a draft, uploads the tarballs, then SHA256SUMS, then publishes', async () => {
    const dir = await packed(); const fake = fakeGh();
    expect(await publishRelease({ tag: TAG, version: VERSION, dir, gh: fake.gh })).toEqual({ uploaded: [`edu-agent-${VERSION}.tgz`, 'edu-agent.tgz', 'SHA256SUMS'], published: true });
    expect(fake.calls.find(call => call[1] === 'create')).toEqual(['release', 'create', TAG, '--draft', '--verify-tag', '--title', TAG, '--generate-notes']);
    expect(fake.uploads()).toEqual([`edu-agent-${VERSION}.tgz`, 'edu-agent.tgz', 'SHA256SUMS']);
    expect(fake.calls.at(-1)).toEqual(['release', 'edit', TAG, '--draft=false']);
    expect(fake.release()?.isDraft).toBe(false);
  });

  it('is a no-op when re-run on the same published release', async () => {
    const dir = await packed(); const fake = fakeGh();
    await publishRelease({ tag: TAG, version: VERSION, dir, gh: fake.gh });
    fake.calls.length = 0;
    expect(await publishRelease({ tag: TAG, version: VERSION, dir, gh: fake.gh })).toEqual({ uploaded: [], published: false });
    expect(fake.calls).toEqual([['release', 'view', TAG, '--json', 'isDraft,assets']]);
  });

  it('completes a draft left by an interrupted run, replacing its partial asset', async () => {
    const dir = await packed();
    const fake = fakeGh({ isDraft: true, assets: { [`edu-agent-${VERSION}.tgz`]: digest('truncated upload') } });
    await publishRelease({ tag: TAG, version: VERSION, dir, gh: fake.gh });
    expect(fake.calls.filter(call => call[1] === 'upload')[0]).toContain('--clobber');
    expect(fake.uploads()).toEqual([`edu-agent-${VERSION}.tgz`, 'edu-agent.tgz', 'SHA256SUMS']);
    expect(fake.release()?.isDraft).toBe(false);
  });

  it('adds only the missing assets to a published release whose tarballs match', async () => {
    const dir = await packed();
    const bytes = await readFile(join(dir, 'edu-agent.tgz'));
    const fake = fakeGh({ isDraft: false, assets: { [`edu-agent-${VERSION}.tgz`]: digest(bytes), 'edu-agent.tgz': digest(bytes) } });
    expect(await publishRelease({ tag: TAG, version: VERSION, dir, gh: fake.gh })).toEqual({ uploaded: ['SHA256SUMS'], published: false });
  });

  it('refuses to replace a published asset with different bytes, and changes nothing', async () => {
    const dir = await packed('rebuilt tarball');
    const fake = fakeGh({ isDraft: false, assets: { 'edu-agent.tgz': digest('the tarball users already downloaded') } });
    await expect(publishRelease({ tag: TAG, version: VERSION, dir, gh: fake.gh })).rejects.toThrow(/refusing to replace a published asset/);
    expect(fake.calls.map(call => call[1])).toEqual(['view']);
  });

  it('marks a pre-release version as a prerelease', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-release-')); roots.push(dir);
    await writeFile(join(dir, 'edu-agent-6.0.0-rc.1.tgz'), 'rc');
    await writeAssets(dir, '6.0.0-rc.1');
    const fake = fakeGh();
    await publishRelease({ tag: 'v6.0.0-rc.1', version: '6.0.0-rc.1', dir, gh: fake.gh });
    expect(fake.calls.find(call => call[1] === 'create')).toContain('--prerelease');
  });

  it('stops on a gh failure other than a missing release, before creating anything', async () => {
    const dir = await packed();
    const gh: Gh = () => ({ status: 1, stdout: '', stderr: 'HTTP 401: Bad credentials' });
    await expect(publishRelease({ tag: TAG, version: VERSION, dir, gh })).rejects.toThrow(/Bad credentials/);
  });

  it('checks the tag before calling gh', async () => {
    const dir = await packed(); const fake = fakeGh();
    await expect(publishRelease({ tag: 'v9.9.9', version: VERSION, dir, gh: fake.gh })).rejects.toThrow(/does not match/);
    expect(fake.calls).toEqual([]);
  });
});
