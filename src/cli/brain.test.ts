import { lstat, mkdir, readFile, readlink, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
    expect(out(c)).toContain('Obsidian: no vault linked');
  });
});
