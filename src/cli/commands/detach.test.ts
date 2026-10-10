import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { captureContext, out, runCli, type Captured } from '../testkit.js';

const captures: Captured[] = [];
afterEach(async () => { for (const c of captures.splice(0)) await rm(join(c.dirs.cwd, '..'), { recursive: true, force: true }); });

it('exposes doctor context JSON and noninteractive dry-run/apply/undo', async () => {
  const c = await captureContext(); captures.push(c);
  await mkdir(join(c.dirs.home, '.codex'), { recursive: true });
  const file = join(c.dirs.home, '.codex/AGENTS.md');
  const original = 'mine\n<!-- gentle-ai:persona -->noise<!-- /gentle-ai:persona -->\n';
  await writeFile(file, original);
  await runCli(c, ['doctor', '--context', '--json']);
  expect(JSON.parse(out(c)).hosts[0].host).toBe('codex');
  c.stdout.length = 0;
  await runCli(c, ['detach', 'gentle-ai', '--host', 'codex']);
  expect(out(c)).toContain('Dry run');
  expect(await readFile(file, 'utf8')).toBe(original);
  c.stdout.length = 0;
  await runCli(c, ['detach', 'gentle-ai', '--host', 'codex', '--yes']);
  expect(await readFile(file, 'utf8')).not.toContain('noise');
  c.stdout.length = 0;
  await runCli(c, ['detach', '--undo']);
  expect(await readFile(file, 'utf8')).toBe(original);
});
