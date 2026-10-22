import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { SetupOptions } from '../../setup/index.js';
import { captureContext, runCli } from '../testkit.js';

// Real setup and installer; replace host probing so this test invokes no host CLI.
vi.mock('../../setup/index.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../setup/index.js')>();
  return { ...actual, planSetup: (options: SetupOptions) => actual.planSetup({ ...options, runner: async () => ({ exitCode: 1 }) }) };
});
it('prints skipped custom skill notices in the registered normal setup command', async () => {
  const c = await captureContext({ detected: ['codex'] });
  const base = dirname(c.dirs.home);
  try {
    const external = join(base, 'preserved-skill'); await mkdir(external);
    await writeFile(join(external, 'SKILL.md'), 'PRIVATE custom skill');
    await mkdir(join(c.dirs.home, '.edu/skills'), { recursive: true });
    await symlink(external, join(c.dirs.home, '.edu/skills/edu-brief'), 'junction');
    await mkdir(join(c.dirs.home, '.edu/skills/my-local'));
    await writeFile(join(c.dirs.home, '.edu/skills/my-local/SKILL.md'), 'Remaining valid skill');
    await runCli(c, ['setup', '--yes']);
    expect(c.exitCode).toBeUndefined();
    expect(c.stdout.join('\n')).toMatch(/skip.*edu-brief.*symlink/i);
    await expect(readFile(join(c.dirs.home, '.agents/skills/edu-brief/SKILL.md'))).rejects.toThrow();
    expect(await readFile(join(c.dirs.home, '.agents/skills/my-local/SKILL.md'), 'utf8')).toBe('Remaining valid skill');
    expect(await readFile(join(external, 'SKILL.md'), 'utf8')).toBe('PRIVATE custom skill');
  } finally { await rm(base, { recursive: true, force: true }); }
});
it('prints unsupported custom encoding notices and installs remaining skills through normal setup', async () => {
  const c = await captureContext({ detected: ['codex'] }); const base = dirname(c.dirs.home);
  try {
    const custom = join(c.dirs.home, '.edu/skills'); await mkdir(join(custom, 'edu-brief'), { recursive: true });
    const bytes = Buffer.from([0x23, 0x20, 0xe9]); await writeFile(join(custom, 'edu-brief/SKILL.md'), bytes);
    await mkdir(join(custom, 'my-local')); await writeFile(join(custom, 'my-local/SKILL.md'), 'Remaining valid skill');
    await runCli(c, ['setup', '--yes']);
    expect(c.exitCode).toBeUndefined(); expect(c.stdout.join('\n')).toMatch(/skip.*edu-brief.*encoding/i);
    expect(await readFile(join(custom, 'edu-brief/SKILL.md'))).toEqual(bytes);
    expect(await readFile(join(c.dirs.home, '.agents/skills/my-local/SKILL.md'), 'utf8')).toBe('Remaining valid skill');
    await expect(readFile(join(c.dirs.home, '.agents/skills/edu-brief/SKILL.md'))).rejects.toThrow();
  } finally { await rm(base, { recursive: true, force: true }); }
});
