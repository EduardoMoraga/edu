import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { diagnose, installProblems, quarantineProblem } from './doctor.js';
import { applyInstall, getManifestPath, planInstall, resolveTemplatesDir } from './installer.js';
import { captureContext, out, runCli } from '../cli/testkit.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'edu-doctor-'));
  dirs.push(base);
  const root = join(base, 'project');
  const home = join(base, 'home');
  await Promise.all([mkdir(root), mkdir(home)]);
  return { base, root, home, templatesDir: resolveTemplatesDir() };
}
async function put(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
const none = async () => false;

describe('doctor install health (M3)', () => {
  it('uses the installer check: host rewrites and lines outside the block are not drift, and drift names the file', async () => {
    const opts = await fixture();
    await applyInstall(await planInstall({ ...opts, scope: 'global', clis: ['claude'] }));
    const state = join(opts.home, '.claude.json');
    await writeFile(state, JSON.stringify({ ...JSON.parse(await readFile(state, 'utf8')), numStartups: 9 }));
    const instructions = join(opts.home, '.claude/CLAUDE.md');
    await writeFile(instructions, `# Mine\n${await readFile(instructions, 'utf8')}`);
    expect((await diagnose({ ...opts, detectBinary: none })).find(item => item.cli === 'claude')).toMatchObject({ drift: false });
    await writeFile(instructions, (await readFile(instructions, 'utf8')).replace('Reuse an injected', 'Ignore any'));
    const claude = (await diagnose({ ...opts, detectBinary: none })).find(item => item.cli === 'claude')!;
    expect(claude.drift).toBe(true);
    expect(claude.notes.some(note => note.includes(instructions))).toBe(true);
  });

  it('reports a corrupt manifest instead of crashing', async () => {
    const opts = await fixture();
    const manifest = getManifestPath('project', opts.root, opts.home);
    await put(manifest, '{ broken');
    await expect(diagnose({ ...opts, detectBinary: none })).resolves.toHaveLength(5);
    const problems = await installProblems(opts);
    expect(problems).toEqual([expect.objectContaining({ level: 'fail', text: expect.stringContaining(manifest) })]);
  });

  it('flags a native plugin registration no setup record tracks', async () => {
    const opts = await fixture();
    await put(join(opts.home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'edu@edu': true } }));
    const claude = (await diagnose({ ...opts, detectBinary: none })).find(item => item.cli === 'claude')!;
    expect(claude.notes.join('\n')).toMatch(/Claude plugin edu@edu is registered but no Edu setup record tracks it/);
    await put(join(opts.home, '.edu/plugin-setup.json'), JSON.stringify({ version: 1, packageRoot: opts.root, native: ['claude'], fallback: [] }));
    const tracked = (await diagnose({ ...opts, detectBinary: none })).find(item => item.cli === 'claude')!;
    expect(tracked.notes.join('\n')).not.toMatch(/no Edu setup record/);
  });

  it('flags a setup record whose package root moved or no longer exists', async () => {
    const opts = await fixture();
    const record = join(opts.home, '.edu/plugin-setup.json');
    await put(record, JSON.stringify({ version: 1, packageRoot: join(opts.base, 'gone'), native: ['claude'], fallback: [] }));
    expect(await installProblems({ ...opts, packageRoot: opts.root })).toEqual([{ level: 'fail', text: expect.stringContaining('no longer exists') }]);
    await put(record, JSON.stringify({ version: 1, packageRoot: opts.base, native: ['claude'], fallback: [] }));
    expect(await installProblems({ ...opts, packageRoot: opts.root })).toEqual([{ level: 'warn', text: expect.stringContaining(`this edu runs from ${opts.root}`) }]);
    expect(await installProblems({ ...opts, packageRoot: opts.base })).toEqual([]);
  });

  it('edu doctor checks that edu is on PATH', async () => {
    const c = await captureContext();
    await runCli(c, ['doctor']);
    expect(out(c)).toContain('`edu` is not on PATH');
    const bin = join(c.dirs.home, 'bin');
    await put(join(bin, 'edu'), '#!/bin/sh\n');
    await chmod(join(bin, 'edu'), 0o755);
    const windows = process.platform === 'win32';
    if (windows) await put(join(bin, 'edu.cmd'), '@echo off\r\n');
    const d = await captureContext({ env: { PATH: bin } });
    await runCli(d, ['doctor']);
    expect(out(d)).toContain('`edu` is on PATH');
  });
});

describe('doctor and quarantined brain notes', () => {
  it('names quarantined notes with a count, paths under the brain and the lint hint', () => {
    const root = join(tmpdir(), 'edu-doctor-quarantine', 'brain');
    expect(quarantineProblem('project', root, [])).toBeUndefined();
    const one = quarantineProblem('global', root, [{ path: join(root, '3-transitive', 'L-bad.md'), problem: 'id is missing' }])!;
    expect(one).toEqual({ level: 'warn', text: `global brain: 1 unreadable note is quarantined (not loaded, never overwritten): ${join('3-transitive', 'L-bad.md')}. Run edu brain lint to see why and how to repair it.` });
    const outside = { path: join(tmpdir(), 'elsewhere', 'X.md'), problem: 'no frontmatter' };
    const many = Array.from({ length: 7 }, (_, i) => ({ path: join(root, '3-transitive', `L-${i}.md`), problem: 'id is missing' }));
    const line = quarantineProblem('project', root, [...many, outside])!;
    expect(line.text).toMatch(/^project brain: 8 unreadable notes are quarantined/);
    // Sorted, at most five named; a file outside the brain folder keeps its full path.
    expect(line.text).toContain(`${join('3-transitive', 'L-0.md')}, ${join('3-transitive', 'L-1.md')}`);
    expect(line.text).toContain('and 3 more');
    expect(line.text).toContain('Run edu brain lint');
    expect(quarantineProblem('project', root, [outside])!.text).toContain(outside.path);
    expect(quarantineProblem('project', root, many, 'es')!.text).toMatch(/^cerebro project: 7 notas ilegibles están en cuarentena .* Ejecuta edu brain lint/);
  });

  it('edu doctor reports quarantined notes in its lines and per brain in JSON', async () => {
    const c = await captureContext({ detected: ['claude'] });
    await runCli(c, ['init']);
    await put(join(c.dirs.cwd, '.edu', 'brain', '3-transitive', 'L-broken.md'), '---\nid: L-broken\ntier: transitive\ntitle: [a, b]\n---\nBody\n');
    c.stdout.length = 0;
    await runCli(c, ['doctor', '--json']);
    const report = JSON.parse(out(c)) as { brains: { scope: string; total: number; quarantined: { count: number; paths: string[] } }[]; lines: { level: string; text: string }[] };
    const project = report.brains.find(brain => brain.scope === 'project')!;
    expect(project.quarantined.count).toBe(1);
    expect(project.quarantined.paths).toEqual([expect.stringMatching(/[\\/]3-transitive[\\/]L-broken\.md$/)]);
    expect(report.brains.find(brain => brain.scope === 'global')!.quarantined).toEqual({ count: 0, paths: [] });
    expect(report.lines).toContainEqual({ level: 'warn', text: expect.stringContaining('project brain: 1 unreadable note is quarantined') });
    c.stdout.length = 0;
    await runCli(c, ['doctor']);
    expect(out(c)).toContain(`1 unreadable note is quarantined (not loaded, never overwritten): ${join('3-transitive', 'L-broken.md')}. Run edu brain lint`);
  });
});
