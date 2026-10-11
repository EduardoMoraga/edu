import { lstat, mkdir, readFile, readlink, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openBrain } from '../brain/index.js';
import { readProjects } from '../vault/registry.js';
import { captureContext, out, runCli, type Captured } from './testkit.js';

async function initialized(): Promise<Captured> {
  const c = await captureContext({ detected: ['claude'] });
  await runCli(c, ['init']);
  c.stdout.length = 0;
  return c;
}

describe('edu brain', () => {
  it('remembers, recalls and reports status', async () => {
    const c = await initialized();
    await runCli(c, ['brain', 'remember', 'Use', 'atomic', 'writes', '--kind', 'decision', '--body', 'Temp file then rename.']);
    expect(out(c)).toMatch(/Remembered D-/);
    c.stdout.length = 0;

    await runCli(c, ['brain', 'recall', 'atomic', '--json']);
    const hits = JSON.parse(out(c));
    expect(hits[0]).toMatchObject({ title: 'Use atomic writes', tier: 'transitive' });
    c.stdout.length = 0;

    await runCli(c, ['brain', 'status', '--json']);
    const status = JSON.parse(out(c));
    expect(status.total).toBe(1);
    expect(status.byTier.transitive).toBe(1);
  });

  it('refuses to write without a brain and validates --kind', async () => {
    const c = await captureContext();
    await runCli(c, ['brain', 'remember', 'x']);
    expect(c.exitCode).toBe(1);
    expect(c.stderr.join('\n')).toContain('edu init');

    const d = await initialized();
    await runCli(d, ['brain', 'remember', 'x', '--kind', 'rumor']);
    expect(d.exitCode).toBe(1);
    expect(d.stderr.join('\n')).toContain('--kind must be one of');
  });

  it('runs maintenance', async () => {
    const c = await initialized();
    await runCli(c, ['brain', 'maintain', '--json']);
    expect(JSON.parse(out(c))).toMatchObject({ indexRebuilt: true });
  });

  it('links the brain into an Obsidian vault and refuses conflicts', async () => {
    const c = await initialized();
    const vault = join(c.dirs.home, 'vault');
    await mkdir(vault);
    await runCli(c, ['brain', 'link', vault]);
    expect(c.exitCode).toBeUndefined();
    const link = join(vault, 'Edu', 'project');
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await realpath(await readlink(link))).toBe(await realpath(join(c.dirs.cwd, '.edu', 'brain')));
    const config = JSON.parse(await readFile(join(c.dirs.cwd, '.edu', 'config.json'), 'utf8'));
    expect(config.brain.obsidianVault).toBe(vault);

    await runCli(c, ['brain', 'link', vault]);
    expect(out(c)).toContain('Already linked');

    const other = join(c.dirs.home, 'vault2');
    await mkdir(join(other, 'Edu', 'project'), { recursive: true });
    await runCli(c, ['brain', 'link', other]);
    expect(c.exitCode).toBe(1);
    expect(c.stderr.join('\n')).toContain('Refusing to replace');
  });
});

describe('edu context / proposals / doctor', () => {
  it('prints the context pack with a token table', async () => {
    const c = await initialized();
    await runCli(c, ['context', '--budget', '600']);
    const text = out(c);
    expect(text).toMatch(/Context pack: \d+ \/ 600 tokens/);
    expect(text).toContain('section');
    expect(text).toMatch(/total\s+\d+\s+of 600/);

    c.stdout.length = 0;
    await runCli(c, ['context', '--budget', '600', '--json']);
    const pack = JSON.parse(out(c));
    expect(pack.budgetTokens).toBe(600);
    expect(pack.tokens).toBeLessThanOrEqual(600);
  });

  it('lists no proposals on a fresh brain', async () => {
    const c = await initialized();
    await runCli(c, ['proposals', 'list']);
    expect(out(c)).toContain('No proposals waiting.');
  });

  it('diagnoses node, CLIs, brains and Obsidian', async () => {
    const c = await initialized();
    await runCli(c, ['doctor', '--json']);
    const report = JSON.parse(out(c));
    expect(report.clis).toHaveLength(5);
    expect(report.brains.find((b: { scope: string }) => b.scope === 'project')).toMatchObject({ ready: true });
    expect(report.vault.state).toBe('none');

    c.stdout.length = 0;
    await runCli(c, ['doctor']);
    expect(out(c)).toMatch(/✓ Node v\d+/);
    expect(out(c)).toContain('Obsidian: no project vault link found');
  });

  it('lists canonical proposals and approves, rejects or approves all', async () => {
    const c = await initialized();
    const brain = openBrain([{ scope: 'project', root: join(c.dirs.cwd, '.edu') }]);
    await brain.proposeCanonical({ tier: 'canonical', kind: 'domain', title: 'Retail margin', body: 'Margin is 30%.', band: 'inferred', source: 'manual.md' });
    await brain.proposeCanonical({ tier: 'canonical', kind: 'standard', title: 'Weekly cadence', body: 'Report on Mondays.', band: 'hypothesis', source: 'notes.md' });
    await brain.proposeCanonical({ tier: 'canonical', kind: 'standard', title: 'Wrong guess', body: 'Not true.', band: 'inferred', source: 'edu:reflect' });

    await runCli(c, ['brain', 'proposals']);
    expect(out(c)).toContain('3 proposed canonical note(s)');
    expect(out(c)).toMatch(/K-retail-margin {2}Retail margin\n\s+inferred · manual\.md · interpretation/);
    expect(out(c)).toContain('edu brain approve');
    c.stdout.length = 0;

    await runCli(c, ['brain', 'proposals', '--json']);
    expect(JSON.parse(out(c)).map((p: { id: string }) => p.id)).toEqual(['K-retail-margin', 'K-weekly-cadence', 'K-wrong-guess']);
    c.stdout.length = 0;

    await runCli(c, ['brain', 'approve', 'K-retail-margin', '--reject', 'K-wrong-guess', '--reason', 'made up']);
    expect(c.exitCode).toBeUndefined();
    expect(out(c)).toContain('Accepted K-retail-margin');
    expect(out(c)).toContain('Rejected K-wrong-guess');
    expect((await brain.read('K-retail-margin'))?.meta.status).toBe('accepted');
    expect(await brain.read('K-wrong-guess')).toBeUndefined();
    const record = (await brain.list({ tier: 'episodic' })).find(n => n.meta.source === 'edu:reject');
    expect(record?.meta).toMatchObject({ status: 'closed', links: ['K-wrong-guess'] });
    expect(record?.body).toContain('Reason: made up');
    c.stdout.length = 0;

    await runCli(c, ['brain', 'approve', '--all', '--json']);
    expect(JSON.parse(out(c))).toEqual({ accepted: ['K-weekly-cadence'], rejected: [], errors: [] });
    c.stdout.length = 0;

    await runCli(c, ['brain', 'proposals']);
    expect(out(c)).toContain('Nothing to approve');
  });

  it('reports unknown ids and refuses an empty approve', async () => {
    const c = await initialized();
    await runCli(c, ['brain', 'approve']);
    expect(c.exitCode).toBe(1);
    expect(c.stderr.join('\n')).toContain('edu brain approve <id...>');

    const d = await initialized();
    await runCli(d, ['brain', 'approve', 'K-missing']);
    expect(d.exitCode).toBe(1);
    expect(d.stderr.join('\n')).toContain('Canonical note not found: K-missing');
  });

  it('registers the workspace brain from its current brainDir after init', async () => {
    const c = await initialized();
    const cwd = await realpath(c.dirs.cwd);
    expect((await readProjects(c.dirs.eduHome)).projects[0]?.brain).toBe(join(cwd, '.edu', 'brain'));
    const config = JSON.parse(await readFile(join(cwd, '.edu', 'config.json'), 'utf8'));
    await writeFile(join(cwd, '.edu', 'config.json'), JSON.stringify({ ...config, brainDir: '01-CONOCIMIENTO' }));
    expect((await readProjects(c.dirs.eduHome)).projects[0]?.brain).toBe(join(cwd, '01-CONOCIMIENTO'));
  });

  it('imports an Albert vault given the _ALBERT folder itself, relative to the working directory', async () => {
    const c = await initialized();
    const file = join(c.dirs.cwd, 'vault', '_ALBERT', '3-TRANSITIVO', 'D-001_decision.md');
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, '---\ntipo: decision\ntitulo: Imported decision\n---\n\nBody.\n');
    await runCli(c, ['brain', 'import', 'albert', join('vault', '_ALBERT'), '--json']);
    expect(JSON.parse(out(c)).imported).toEqual(['D-001-imported-decision']);
    c.stdout.length = 0;
    await runCli(c, ['brain', 'import', 'albert', 'nowhere']);
    expect(c.exitCode).toBe(1);
    expect(c.stderr.join('\n')).toContain('_ALBERT');
  });

  it('warns about an Albert note whose frontmatter is invalid, listing the file', async () => {
    const c = await initialized();
    const file = join(c.dirs.cwd, 'vault', '_ALBERT', '3-TRANSITIVO', 'L-007_broken.md');
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, '---\ntitulo: a: b: c\n---\n\nKept body.\n');
    await runCli(c, ['brain', 'import', 'albert', 'vault']);
    expect(out(c)).toContain('warnings 1');
    expect(c.stderr.join('\n')).toMatch(/warning: .*L-007_broken\.md: invalid-frontmatter/);
  });
});
