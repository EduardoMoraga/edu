import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { buildPlugins } from '../../scripts/build-plugins.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it('does not report generated plugin drift for CRLF checkout content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edu-crlf-'));
  roots.push(root);
  await mkdir(join(root, 'templates'));
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: '0.2.0' }));
  await writeFile(join(root, 'templates/EDU.md'), '# Edu\n');
  await buildPlugins(root);
  const path = join(root, 'plugins/codex/.mcp.json');
  await writeFile(path, (await readFile(path, 'utf8')).replace(/\n/g, '\r\n'));
  expect(await buildPlugins(root, { check: true })).toEqual({ changed: false, files: [] });
});

it('explains that manual plugin installation still requires Edu setup', async () => {
  const readme = await readFile(join(process.cwd(), 'README.md'), 'utf8');
  const spanish = await readFile(join(process.cwd(), 'docs/README.es.md'), 'utf8');
  expect(readme).toMatch(/manual plugin installation[^\n]*run `edu setup`/i);
  expect(spanish).toMatch(/instalaci[oó]n manual[^\n]*`edu setup`/i);
});

it('describes the synchronous review result without job polling', async () => {
  const skill = await readFile(join(process.cwd(), 'templates/skills/edu-review/SKILL.md'), 'utf8');
  expect(skill).toContain('returns findings directly');
  expect(skill).not.toMatch(/poll `edu_crew_status`/);
});
