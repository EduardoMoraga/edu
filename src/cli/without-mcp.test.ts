import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHEIL_REMOTE, loadSessionProfile, PERSONAL_REMOTE, profileJson, type Profile } from '../profile/profile.js';
import { captureContext, out, runCli, type Captured } from '../test-support/cli.js';

const ROOT = join(import.meta.dirname, '..', '..');
const norm = (value: string) => value.replace(/\r\n/g, '\n');

async function door(id: 'personal' | 'cheil'): Promise<{ source: string; generated: string }> {
  const source = await readFile(join(ROOT, 'templates/doors', id, 'AGENTS.md'), 'utf8');
  const generated = await readFile(join(ROOT, 'plugins/doors', id, 'AGENTS.md'), 'utf8');
  return { source: norm(source), generated: norm(generated) };
}

describe('CLI doors', () => {
  it('pins each host to one profile and keeps the other vault out of the instructions', async () => {
    const personal = await door('personal');
    const cheil = await door('cheil');
    expect(personal.generated).toBe(personal.source);
    expect(cheil.generated).toBe(cheil.source);

    for (const text of [personal.source, cheil.source]) {
      expect(text).toContain('edu brief');
      expect(text).toContain('edu recall');
      expect(text).toContain('edu join --cloud');
      expect(text).toContain('EDU_HOME');
      expect(text).toContain('edu sync --cloud');
      expect(text).toContain('edu brain read');
    }

    expect(personal.source).toContain('--profile personal');
    expect(personal.source).toContain('EduardoMoraga/edu-vault');
    expect(personal.source.toLowerCase()).not.toContain('cheil');
    expect(personal.source).not.toContain('C:\\Cheil');

    expect(cheil.source).toContain('--profile cheil');
    expect(cheil.source).toContain('Do not read or write the personal vault');
    expect(cheil.source).toContain('EduardoMCheil/cheil-vault');
    expect(cheil.source.toLowerCase()).not.toContain('edu-vault');
    expect(cheil.source).not.toMatch(/edu join[^\n]*personal/);

    const skill = norm(await readFile(join(ROOT, 'plugins/codex/skills/edu-cli/SKILL.md'), 'utf8'));
    expect(skill).toContain('name: edu-cli');
    expect(skill).toContain('edu brief');
    expect(skill).toContain('edu recall');
    expect(skill).toContain('edu join --cloud');
    expect(skill.toLowerCase()).not.toContain('edu-vault');
    expect(skill.toLowerCase()).not.toContain('cheil-vault');
    expect(skill).not.toContain('C:\\Cheil');
  });
});

function profileFor(id: Profile['id'], home: string): Profile {
  const brain = join(home, 'brain');
  if (id === 'personal') return { id, home, brain, remote: PERSONAL_REMOTE };
  return { id, home, brain, remote: CHEIL_REMOTE };
}

async function profileBrain(id: Profile['id'], title: string): Promise<Captured> {
  const c = await captureContext({ env: { LANG: 'C', LC_ALL: 'C' } });
  await mkdir(c.dirs.eduHome, { recursive: true });
  await writeFile(join(c.dirs.eduHome, 'profile.json'), profileJson(profileFor(id, c.dirs.eduHome)));
  await runCli(c, ['init', '--global']);
  expect(c.exitCode ?? 0, out(c)).toBe(0);
  expect((await loadSessionProfile({ env: c.ctx.env })).id).toBe(id);
  c.stdout.length = 0;
  await runCli(c, ['brain', 'remember', title, '--kind', 'lesson', '--body', title]);
  expect(c.exitCode ?? 0, out(c)).toBe(0);
  c.stdout.length = 0;
  return c;
}

describe('edu CLI without an MCP server', () => {
  it('runs brief and recall against one profile home and does not see the other profile', async () => {
    const personal = await profileBrain('personal', 'crimson-lantern');
    const cheil = await profileBrain('cheil', 'amber-harbor');

    await runCli(personal, ['brief']);
    expect(personal.exitCode ?? 0).toBe(0);
    expect(out(personal)).toContain('the contract');
    expect(out(personal)).not.toContain('amber-harbor');
    personal.stdout.length = 0;
    await runCli(personal, ['brain', 'recall', 'crimson-lantern']);
    expect(personal.exitCode ?? 0).toBe(0);
    expect(out(personal)).toContain('crimson-lantern');
    personal.stdout.length = 0;
    await runCli(personal, ['brain', 'recall', 'amber-harbor']);
    expect(out(personal)).toBe('No matching notes.');

    await runCli(cheil, ['brief']);
    expect(cheil.exitCode ?? 0).toBe(0);
    expect(out(cheil)).toContain('the contract');
    expect(out(cheil)).not.toContain('crimson-lantern');
    cheil.stdout.length = 0;
    await runCli(cheil, ['brain', 'recall', 'amber-harbor']);
    expect(cheil.exitCode ?? 0).toBe(0);
    expect(out(cheil)).toContain('amber-harbor');
    cheil.stdout.length = 0;
    await runCli(cheil, ['brain', 'recall', 'crimson-lantern']);
    expect(out(cheil)).toBe('No matching notes.');
  });
});
