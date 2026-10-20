import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openBrain } from '../brain/brain.js';
import { registerProject } from '../vault/registry.js';
import { migrateWorkspaces } from './migrate.js';
import { compareVersions, fetchRelease, pickAsset, UpdateError, whatsNew, type Release } from './release.js';
import { checkForUpdate, installPrefix, performUpdate, resolveNpm, type RunResult, type UpdateDeps } from './update.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function temp() { const path = await realpath(await mkdtemp(join(tmpdir(), 'edu-update-'))); dirs.push(path); return path; }

const githubRelease = (tag = 'v0.8.0', body = '## Highlights\n- **Workspaces** from documents\n- `edu update`\n') => ({
  tag_name: tag, name: `${tag} — workspaces`, body, html_url: `https://github.com/EduardoMoraga/edu/releases/tag/${tag}`,
  assets: [
    { name: 'edu-agent.tgz', browser_download_url: `https://github.com/EduardoMoraga/edu/releases/download/${tag}/edu-agent.tgz` },
    { name: `edu-agent-${tag.slice(1)}.tgz`, browser_download_url: `https://github.com/EduardoMoraga/edu/releases/download/${tag}/edu-agent-${tag.slice(1)}.tgz` },
  ],
});

function fakeFetch(handler: (url: string) => Response | Promise<Response>): typeof fetch & { urls: string[] } {
  const urls: string[] = [];
  const fn = (async (input: string | URL | Request) => { const url = String(input); urls.push(url); return handler(url); }) as typeof fetch & { urls: string[] };
  fn.urls = urls;
  return fn;
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

const release: Release = { tag: 'v0.8.0', version: '0.8.0', name: 'v0.8.0', body: '', url: 'https://example.test/r', assetUrl: 'https://example.test/edu-agent-0.8.0.tgz', assetName: 'edu-agent-0.8.0.tgz' };

interface Call { command: string; args: string[] }
function fakeDeps(script: (call: Call) => Partial<RunResult> | undefined, extra: Partial<UpdateDeps> = {}): UpdateDeps & { calls: Call[] } {
  const calls: Call[] = [];
  const existing = new Set(['/opt/node/bin/npm', '/opt/node/lib/node_modules/edu-agent/dist/cli.js']);
  return {
    calls,
    fetch: fakeFetch(() => json(githubRelease())),
    run: async (command, args) => { const call = { command, args }; calls.push(call); return { code: 0, stdout: '', stderr: '', ...script(call) }; },
    exists: async (path) => existing.has(path),
    execPath: '/opt/node/bin/node',
    platform: 'darwin',
    packageRoot: '/opt/node/lib/node_modules/edu-agent',
    currentVersion: '0.7.0',
    env: {},
    ...extra,
  };
}
const happy = (call: Call): Partial<RunResult> | undefined => {
  if (call.args[0] === 'root') return { stdout: '/opt/node/lib/node_modules\n' };
  if (call.args[1] === '--version') return { stdout: '0.8.0\n' };
  if (call.args[1] === 'setup') return { stdout: 'claude: plugin installed\n' };
  if (call.args[1] === 'internal') return { stdout: JSON.stringify([{ name: 'albert', root: '/w/albert', status: 'migrated' }]) };
  return undefined;
};

describe('release lookup', () => {
  it('compares versions with pre-releases before their release', () => {
    expect(compareVersions('0.8.0', '0.7.0')).toBe(1);
    expect(compareVersions('v0.7.0', '0.7.0')).toBe(0);
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
    expect(compareVersions('0.8.0-rc.1', '0.8.0')).toBe(-1);
    expect(compareVersions('0.8.0-rc.10', '0.8.0-rc.2')).toBe(1);
  });

  it('prefers the versioned asset, then the stable one', () => {
    expect(pickAsset(githubRelease().assets, '0.8.0')?.name).toBe('edu-agent-0.8.0.tgz');
    expect(pickAsset([{ name: 'edu-agent.tgz', browser_download_url: 'u' }], '0.8.0')).toEqual({ name: 'edu-agent.tgz', url: 'u' });
    expect(pickAsset([{ name: 'other.zip', browser_download_url: 'u' }], '0.8.0')).toBeUndefined();
  });

  it('fetches latest or a tag, and classifies failures', async () => {
    const latest = fakeFetch(() => json(githubRelease()));
    expect(await fetchRelease({ fetch: latest })).toMatchObject({ version: '0.8.0', assetName: 'edu-agent-0.8.0.tgz' });
    expect(latest.urls[0]).toBe('https://api.github.com/repos/EduardoMoraga/edu/releases/latest');

    const tagged = fakeFetch(() => json(githubRelease('v0.6.0')));
    await fetchRelease({ fetch: tagged, tag: '0.6.0' });
    expect(tagged.urls[0]).toBe('https://api.github.com/repos/EduardoMoraga/edu/releases/tags/v0.6.0');

    const offline = fakeFetch(() => { throw new TypeError('fetch failed'); });
    await expect(fetchRelease({ fetch: offline })).rejects.toMatchObject({ code: 'offline' });
    const slow = fakeFetch(() => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); });
    await expect(fetchRelease({ fetch: slow, timeoutMs: 2000 })).rejects.toThrow('GitHub did not answer in 2 s');
    await expect(fetchRelease({ fetch: fakeFetch(() => json({}, 404)), tag: 'v9.9.9' })).rejects.toThrow('release v9.9.9 not found');
    await expect(fetchRelease({ fetch: fakeFetch(() => json({}, 403)) })).rejects.toThrow('rate limit');
    await expect(fetchRelease({ fetch: fakeFetch(() => json({ tag_name: 'v1.0.0', assets: [] })) })).rejects.toBeInstanceOf(UpdateError);
  });

  it('trims the release body to a few plain lines', () => {
    expect(whatsNew('## Highlights\n\n- **Bold** item\n- `code` item\n', 6)).toEqual(['Highlights', '• Bold item', '• code item']);
    expect(whatsNew('a\nb\nc\nd', 2)).toEqual(['a', 'b', '…']);
  });

  it('reports the relation to the running version', async () => {
    const deps = fakeDeps(() => undefined);
    expect((await checkForUpdate(deps)).relation).toBe('newer');
    expect((await checkForUpdate({ ...deps, currentVersion: '0.8.0' })).relation).toBe('same');
    expect((await checkForUpdate({ ...deps, currentVersion: '0.9.0-dev' })).relation).toBe('older');
  });
});

describe('install plan', () => {
  it('uses the npm next to the running node, else npm on PATH', async () => {
    expect(await resolveNpm({ execPath: '/home/u/.hermes/node/bin/node', platform: 'linux', exists: async (p) => p === '/home/u/.hermes/node/bin/npm' })).toBe('/home/u/.hermes/node/bin/npm');
    expect(await resolveNpm({ execPath: 'C:\\node\\node.exe', platform: 'win32', exists: async (p) => p.endsWith('npm.cmd') })).toMatch(/npm\.cmd$/);
    expect(await resolveNpm({ execPath: '/usr/bin/node', platform: 'linux', exists: async () => false })).toBe('npm');
  });

  it('infers the global prefix the running edu lives in', () => {
    expect(installPrefix('/home/u/.hermes/node/lib/node_modules/edu-agent', 'linux')).toBe('/home/u/.hermes/node');
    expect(installPrefix(join('C:', 'npm', 'node_modules', 'edu-agent'), 'win32')).toBe(join('C:', 'npm'));
    expect(installPrefix('/Users/u/src/edu', 'darwin')).toBeUndefined();
  });
});

describe('performUpdate', () => {
  it('installs with the same npm and prefix, verifies, then runs the NEW setup and migration hook', async () => {
    const deps = fakeDeps(happy);
    const steps: string[] = [];
    const outcome = await performUpdate(deps, release, (step) => steps.push(step));
    expect(outcome.ok).toBe(true);
    expect(steps).toEqual(['install', 'verify', 'setup', 'migrate']);
    const cli = '/opt/node/lib/node_modules/edu-agent/dist/cli.js';
    expect(deps.calls).toEqual([
      { command: '/opt/node/bin/npm', args: ['install', '-g', release.assetUrl, '--no-fund', '--no-audit', '--prefix', '/opt/node'] },
      { command: '/opt/node/bin/npm', args: ['root', '-g', '--prefix', '/opt/node'] },
      { command: '/opt/node/bin/node', args: [cli, '--version'] },
      { command: '/opt/node/bin/node', args: [cli, 'setup', '--yes'] },
      { command: '/opt/node/bin/node', args: [cli, 'internal', 'migrate-workspaces', '--json'] },
    ]);
    expect(outcome.migrations?.map(m => m.status)).toEqual(['migrated']);
  });

  it('stops after a failed install, before setup, keeping the current version', async () => {
    const deps = fakeDeps((call) => (call.args[0] === 'install' ? { code: 1, stderr: 'npm ERR! network ETIMEDOUT' } : happy(call)));
    const outcome = await performUpdate(deps, release);
    expect(outcome).toMatchObject({ ok: false, installed: false, steps: [{ step: 'install', status: 'failed', detail: 'npm ERR! network ETIMEDOUT' }] });
    expect(deps.calls).toHaveLength(1);
  });

  it('refuses to run setup when the installed version does not match', async () => {
    const deps = fakeDeps((call) => (call.args[1] === '--version' ? { stdout: '0.7.0\n' } : happy(call)));
    const outcome = await performUpdate(deps, release);
    expect(outcome.ok).toBe(false);
    expect(outcome.steps.at(-1)).toMatchObject({ step: 'verify', status: 'failed' });
    expect(deps.calls.some(c => c.args[1] === 'setup')).toBe(false);
  });

  it('skips migration when the new binary has no hook, and reports setup failures without failing the install', async () => {
    const deps = fakeDeps((call) => {
      if (call.args[1] === 'internal') return { code: 1, stderr: "edu: error: unknown command 'internal'" };
      if (call.args[1] === 'setup') return { code: 1, stderr: 'boom' };
      return happy(call);
    });
    const outcome = await performUpdate(deps, release);
    expect(outcome.installed).toBe(true);
    expect(outcome.ok).toBe(false);
    expect(outcome.steps.find(s => s.step === 'setup')).toMatchObject({ status: 'failed', detail: 'boom' });
    expect(outcome.steps.find(s => s.step === 'migrate')).toMatchObject({ status: 'skipped' });
  });
});

describe('migrateWorkspaces', () => {
  it('preserves notes and reports every registered workspace including unavailable brains', async () => {
    const base = await temp();
    const eduHome = join(base, 'edu-home');
    const ws = join(base, 'albert');
    const eduRoot = join(ws, '.edu');
    await mkdir(eduRoot, { recursive: true });
    const brain = openBrain([{ scope: 'project', root: eduRoot }]);
    await brain.init({ scope: 'project', root: eduRoot }, { identityName: 'Albert' });
    await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Visit stores on Monday', body: 'x' });
    await registerProject(eduHome, ws);
    const gone = join(base, 'gone');
    await mkdir(gone);
    await registerProject(eduHome, gone);
    await rm(gone, { recursive: true });
    const plain = join(base, 'plain');
    await mkdir(plain);
    await registerProject(eduHome, plain);

    const results = await migrateWorkspaces(eduHome);
    expect(results.map(r => [r.name, r.status])).toEqual([['global', 'no-brain'], ['albert', 'migrated'], ['gone', 'missing'], ['plain', 'no-brain']]);
    expect((await brain.list({ kind: 'lesson' }))[0]?.body.trim()).toBe('x');
    expect(await readFile(join(eduRoot, 'EDU.md'), 'utf8')).toContain('edu:capabilities:start');
    await expect(readFile(join(eduRoot, 'state', 'maintain.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('refreshes a stale registered brain path to the configured brainDir', async () => {
    const base = await realpath(await temp());
    const eduHome = join(base, 'edu-home');
    const ws = join(base, 'albert');
    const eduRoot = join(ws, '.edu');
    await mkdir(eduRoot, { recursive: true });
    await openBrain([{ scope: 'project', root: eduRoot }]).init({ scope: 'project', root: eduRoot }, { identityName: 'Albert' });
    await registerProject(eduHome, ws);
    await writeFile(join(eduRoot, 'config.json'), JSON.stringify({ brainDir: '01-CONOCIMIENTO' }));
    await migrateWorkspaces(eduHome);
    const stored = JSON.parse(await readFile(join(eduHome, 'projects.json'), 'utf8')) as { projects: { brain: string }[] };
    expect(stored.projects[0]?.brain).toBe(join(ws, '01-CONOCIMIENTO'));
  });
});

describe('upgrade safety gates', () => {
  it('does not call a missing essential migration successful', async () => {
    const deps = fakeDeps(call => call.args[1] === 'internal' ? { code: 1, stderr: "unknown command 'internal'" } : happy(call));
    expect((await performUpdate(deps, release)).ok).toBe(false);
  });
  it('does not call a partially skipped migration successful', async () => {
    const deps = fakeDeps(call => call.args[1] === 'internal' ? { stdout: JSON.stringify([{ name: 'global', root: '/w', status: 'migrated' }, { name: 'gone', root: '/missing', status: 'missing' }]) } : happy(call));
    expect((await performUpdate(deps, release)).ok).toBe(false);
  });
});

it('simulates 0.10.2 -> 2.0 with the NEW binary migrating real temporary global and project brains', async () => {
  const dir = await temp(); const home = join(dir, 'global'); const project = join(dir, 'project');
  for (const root of [home, join(project, '.edu')]) await openBrain([{ scope: 'project', root }]).init({ scope: 'project', root });
  await registerProject(home, project);
  const target = { ...release, version: '2.0.0', tag: 'v2.0.0' };
  const cli = '/opt/node/lib/node_modules/edu-agent/dist/cli.js';
  const deps = fakeDeps(call => call.args[1] === '--version' ? { stdout: '2.0.0\n' } : happy(call), { currentVersion: '0.10.2' });
  const original = deps.run;
  deps.run = async (command, args, opts) => {
    if (args[1] !== 'internal') return original(command, args, opts);
    expect(command).toBe(deps.execPath); expect(args[0]).toBe(cli);
    const rows = await migrateWorkspaces(home, new Date(), { version: '2.0.0' });
    return { code: rows.every(r => r.status === 'migrated') ? 0 : 1, stdout: JSON.stringify(rows), stderr: '' };
  };
  const outcome = await performUpdate(deps, target);
  expect(outcome.ok).toBe(true);
  expect(outcome.migrations?.map(m => m.name)).toEqual(['global', 'project']);
  expect(JSON.parse(await readFile(join(home, 'state/upgrade.json'), 'utf8')).version).toBe('2.0.0');
});
it('keeps Windows paths with spaces as separate arguments through install and new-binary migration', async () => {
  const prefix = 'C:\\Users\\Private User\\npm';
  const modules = `${prefix}\\node_modules`;
  const cli = `${modules}\\edu-agent\\dist\\cli.js`;
  const deps = fakeDeps(call => {
    if (call.args[0] === 'root') return { stdout: modules + '\r\n' };
    if (call.args[1] === '--version') return { stdout: '2.0.0\r\n' };
    if (call.args[1] === 'internal') return { stdout: JSON.stringify([{ name: 'global', root: 'C:\\Users\\Private User\\.edu', status: 'migrated' }]) };
    return {};
  }, { platform: 'win32', execPath: 'C:\\Program Files\\nodejs\\node.exe', packageRoot: `${modules}\\edu-agent`, currentVersion: '0.10.2', exists: async () => true });
  const result = await performUpdate(deps, { ...release, version: '2.0.0' });
  expect(result.ok).toBe(true);
  expect(deps.calls[0]?.command).toBe('C:\\Program Files\\nodejs\\npm.cmd');
  expect(deps.calls[0]?.args.slice(-2)).toEqual(['--prefix', prefix]);
  expect(deps.calls.find(c => c.args[1] === 'internal')?.args).toEqual([cli, 'internal', 'migrate-workspaces', '--json']);
});
it('stops before setup on a 2.0 migration failure and retains the partial report', async () => {
  const rows = [{ name: 'global', root: '/private', status: 'migrated' }, { name: 'work', root: '/work', status: 'missing' }];
  const deps = fakeDeps(call => {
    if (call.args[1] === '--version') return { stdout: '2.0.0' };
    if (call.args[1] === 'internal') return { code: 1, stdout: JSON.stringify(rows) };
    return happy(call);
  });
  const outcome = await performUpdate(deps, { ...release, version: '2.0.0' });
  expect(outcome.ok).toBe(false); expect(outcome.migrations).toEqual(rows);
  expect(deps.calls.some(c => c.args[1] === 'setup')).toBe(false);
});
it.each(['[]', '{}', '[{"name":"global","root":"/p","status":"invented"}]'])('rejects an invalid essential migration report: %s', async stdout => {
  const deps = fakeDeps(call => call.args[1] === 'internal' ? { stdout } : happy(call));
  expect((await performUpdate(deps, release)).ok).toBe(false);
});
