import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { captureContext, out, runCli } from '../testkit.js';

const missing = (path: string) => access(path).then(() => false, () => true);

describe('edu uninstall', () => {
  it('removes a global install, keeps the brain, and is a no-op the second time', async () => {
    const c = await captureContext();
    await runCli(c, ['init', '--global']);
    await runCli(c, ['install', '--scope', 'global', '--cli', 'codex', '--yes']);
    expect(await readFile(join(c.dirs.home, '.codex/AGENTS.md'), 'utf8')).toContain('edu:core');
    c.stdout.length = 0;
    await runCli(c, ['uninstall', '--yes']);
    expect(c.exitCode).toBeUndefined();
    expect(out(c)).toContain('Edu integration removed (global).');
    expect(out(c)).toContain('Brain kept');
    expect(out(c)).toContain('npm uninstall -g edu-agent');
    expect(await missing(join(c.dirs.home, '.codex/AGENTS.md'))).toBe(true);
    expect(await missing(join(c.dirs.eduHome, 'EDU.md'))).toBe(false);
    c.stdout.length = 0;
    await runCli(c, ['uninstall', '--yes']);
    expect(c.exitCode).toBeUndefined();
    expect(out(c)).toContain('Nothing to remove');
  });

  it('never purges the brain without confirmation', async () => {
    const c = await captureContext();
    await runCli(c, ['init', '--global']);
    await runCli(c, ['uninstall', '--purge-brain']);
    expect(c.exitCode).toBe(1);
    expect(c.stderr.join('\n')).toContain('--yes');
    expect(await missing(join(c.dirs.eduHome, 'EDU.md'))).toBe(false);
  });

  it('declined confirmation keeps the brain', async () => {
    const c = await captureContext({ isTTY: true });
    c.ctx.stdinIsTTY = true;
    await runCli(c, ['init', '--global']);
    await runCli(c, ['uninstall', '--purge-brain']);
    expect(out(c)).toContain('Keeping the brain.');
    expect(await missing(join(c.dirs.eduHome, 'EDU.md'))).toBe(false);
  });

  it('purges with --purge-brain --yes and rejects conflicting brain flags', async () => {
    const c = await captureContext();
    await runCli(c, ['init', '--global']);
    await runCli(c, ['uninstall', '--keep-brain', '--purge-brain', '--yes']);
    expect(c.exitCode).toBe(1);
    expect(await missing(join(c.dirs.eduHome, 'EDU.md'))).toBe(false);
    c.exitCode = undefined;
    await runCli(c, ['uninstall', '--purge-brain', '--yes']);
    expect(c.exitCode).toBeUndefined();
    expect(out(c)).toContain('Brain deleted');
    expect(await missing(c.dirs.eduHome)).toBe(true);
  });
});
