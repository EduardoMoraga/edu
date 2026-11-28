import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join, relative, sep, win32 as windows } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listLocation } from '../brain/store.js';
import { CHEIL_REMOTE, PERSONAL_REMOTE, ProfileError, loadSessionProfile, parseProfile, type Profile } from './profile.js';

const missing = () => Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' }));
const noLink = () => undefined;

function thrown(run: () => void): ProfileError {
  try { run(); }
  catch (error) {
    expect(error).toBeInstanceOf(ProfileError);
    return error as ProfileError;
  }
  expect.fail('expected ProfileError');
}

const personal = { id: 'personal' as const, home: 'D:\\edu', brain: 'D:\\notes', remote: PERSONAL_REMOTE };
const win32 = { platform: 'win32' as const, realpath: noLink };

describe('parseProfile', () => {
  it.each([
    PERSONAL_REMOTE,
    `${PERSONAL_REMOTE}.git`,
    `https://github.com/${PERSONAL_REMOTE}`,
    `https://github.com/${PERSONAL_REMOTE}.git`,
    `git@github.com:${PERSONAL_REMOTE}.git`,
    `ssh://git@github.com/${PERSONAL_REMOTE}.git`,
  ])('binds a personal profile to %s', remote => {
    expect(parseProfile({ ...personal, remote }, win32)).toEqual({ ...personal, remote: PERSONAL_REMOTE });
  });

  it('accepts the Cheil brain at C:\\Cheil\\_CONOCIMIENTO', () => {
    const profile = parseProfile({
      id: 'cheil', home: 'D:\\edu-cheil', brain: 'C:\\Cheil\\..\\Cheil\\_CONOCIMIENTO', remote: `https://github.com/${CHEIL_REMOTE}.git`,
    }, win32);
    expect(profile).toEqual({ id: 'cheil', home: 'D:\\edu-cheil', brain: 'C:\\Cheil\\_CONOCIMIENTO', remote: CHEIL_REMOTE });
  });

  it('rejects a personal brain or home inside C:\\Cheil, in any case', () => {
    const brain = thrown(() => parseProfile({ ...personal, brain: 'C:\\Cheil\\_CONOCIMIENTO' }, win32));
    expect(brain).toMatchObject({ code: 'cheil-root' });
    expect(brain.message).toContain('brain');
    expect(brain.message).toContain('C:\\Cheil');
    const folded = thrown(() => parseProfile({ ...personal, brain: 'c:\\cheil\\notes' }, win32));
    expect(folded.code).toBe('cheil-root');
    expect(folded.message).toContain('brain');
    expect(folded.message).toContain('C:\\Cheil');
    const home = thrown(() => parseProfile({ ...personal, home: 'C:\\Cheil' }, win32));
    expect(home.code).toBe('cheil-root');
    expect(home.message).toContain('home');
    expect(home.message).toContain('C:\\Cheil');
  });

  it('allows a personal folder whose name only starts with Cheil', () => {
    expect(parseProfile({ ...personal, brain: 'C:\\Cheilish\\notes' }, win32).brain).toBe('C:\\Cheilish\\notes');
    expect(parseProfile({ ...personal, brain: 'C:\\Cheil\\..\\Users\\notes' }, win32).brain).toBe('C:\\Users\\notes');
    expect(parseProfile({ ...personal, brain: '\\\\server\\share\\notes' }, win32).brain).toBe(windows.resolve('\\\\server\\share\\notes'));
  });

  it('rejects a remote that belongs to the other profile', () => {
    const cheil = thrown(() => parseProfile({
      id: 'cheil', home: 'D:\\edu-cheil', brain: 'C:\\Cheil\\_CONOCIMIENTO', remote: `git@github.com:${PERSONAL_REMOTE}.git`,
    }, win32));
    expect(cheil).toMatchObject({ code: 'remote-mismatch' });
    expect(cheil.message).toContain('cheil');
    expect(cheil.message).toContain(CHEIL_REMOTE);
    const crossed = thrown(() => parseProfile({ ...personal, remote: CHEIL_REMOTE }, win32));
    expect(crossed.code).toBe('remote-mismatch');
    expect(crossed.message).toContain(PERSONAL_REMOTE);
  });

  it('rejects a credentialed remote without repeating the secret', () => {
    const wrong = thrown(() => parseProfile({ ...personal, remote: 'https://user:s3cret@github.com/EduardoMCheil/cheil-vault.git' }, win32));
    expect(wrong.code).toBe('remote-mismatch');
    expect(wrong.message).toContain(PERSONAL_REMOTE);
    expect(wrong.message).not.toContain('s3cret');
    const same = thrown(() => parseProfile({ ...personal, remote: 'https://user:s3cret@github.com/EduardoMoraga/edu-vault.git' }, win32));
    expect(same.code).toBe('remote-mismatch');
    expect(same.message).toContain(PERSONAL_REMOTE);
    expect(same.message).not.toContain('s3cret');
    expect(same.message).not.toContain('user:');
    expect(thrown(() => parseProfile({ ...personal, remote: 'https://git@github.com/EduardoMoraga/edu-vault.git' }, win32)).code).toBe('remote-mismatch');
  });

  it('rejects a path that a junction resolves into C:\\Cheil', () => {
    const realpath = (file: string) => file === 'D:\\vault\\brain' ? 'C:\\Cheil\\_CONOCIMIENTO' : undefined;
    const personalError = thrown(() => parseProfile({ ...personal, brain: 'D:\\vault\\brain' }, { platform: 'win32', realpath }));
    expect(personalError.code).toBe('cheil-root');
    expect(personalError.message).toContain('brain');
    expect(personalError.message).toContain('C:\\Cheil');
    expect(parseProfile({
      id: 'cheil', home: 'D:\\edu-cheil', brain: 'D:\\vault\\brain', remote: CHEIL_REMOTE,
    }, { platform: 'win32', realpath }).brain).toBe('D:\\vault\\brain');
    const missingJunction = () => { throw new Error('missing junction'); };
    const stillCheil = thrown(() => parseProfile({ ...personal, home: 'C:\\Cheil' }, { platform: 'win32', realpath: missingJunction }));
    expect(stillCheil.code).toBe('cheil-root');
    expect(parseProfile({ ...personal, brain: 'D:\\vault\\brain' }, { platform: 'win32', realpath: missingJunction }).brain).toBe('D:\\vault\\brain');
  });

  it('rejects a profile that is not a complete absolute object', () => {
    expect(thrown(() => parseProfile(null)).code).toBe('invalid');
    expect(thrown(() => parseProfile(['personal'])).message).toContain('object');
    expect(thrown(() => parseProfile({ ...personal, id: 'work' }, win32)).message).toContain('id');
    expect(thrown(() => parseProfile({ id: 'personal', home: personal.home, remote: PERSONAL_REMOTE }, win32)).message).toContain('brain');
    expect(thrown(() => parseProfile({ ...personal, extra: true }, win32)).code).toBe('invalid');
    expect(thrown(() => parseProfile({ ...personal, brain: 'notes' }, win32)).message).toContain('brain');
    expect(thrown(() => parseProfile({ ...personal, remote: 'https://github.com/EduardoMoraga/edu-vault/tree/main' }, win32)).code).toBe('remote-mismatch');
  });
});

describe('loadSessionProfile', () => {
  const roots: string[] = [];
  const previousCeiling = process.env.EDU_CEILING_DIRECTORIES;

  afterEach(async () => {
    if (previousCeiling === undefined) delete process.env.EDU_CEILING_DIRECTORIES;
    else process.env.EDU_CEILING_DIRECTORIES = previousCeiling;
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  });

  async function sandbox(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'edu-profile-'));
    roots.push(root);
    process.env.EDU_CEILING_DIRECTORIES = root;
    return root;
  }

  it('uses the implicit personal profile when profile.json is absent', async () => {
    const home = await sandbox();
    const seen: string[] = [];
    const profile = await loadSessionProfile({
      env: { EDU_HOME: home, EDU_CEILING_DIRECTORIES: home },
      readFile: file => { seen.push(file); return missing(); },
    });
    expect(profile).toEqual({ id: 'personal', home, brain: join(home, 'brain'), remote: PERSONAL_REMOTE });
    expect(seen).toEqual([join(home, 'profile.json')]);
  });

  it('reads a real missing profile.json without a stand-in reader', async () => {
    const home = await sandbox();
    const profile = await loadSessionProfile({ env: { EDU_HOME: home } });
    expect(profile.brain).toBe(join(home, 'brain'));
    expect(profile.remote).toBe(PERSONAL_REMOTE);
  });

  it('resolves a Windows home from USERPROFILE when HOME and EDU_HOME are unset', async () => {
    const profile = await loadSessionProfile({
      platform: 'win32', env: { USERPROFILE: 'C:\\Users\\Eduardo' }, readFile: missing, realpath: noLink,
      homedir: () => { throw new Error('homedir must not be called'); },
    });
    expect(profile).toEqual({
      id: 'personal',
      home: windows.join('C:\\Users\\Eduardo', '.edu'),
      brain: windows.join(windows.join('C:\\Users\\Eduardo', '.edu'), 'brain'),
      remote: PERSONAL_REMOTE,
    });
  });

  it('prefers HOME over USERPROFILE and ignores an empty EDU_HOME', async () => {
    const profile = await loadSessionProfile({
      platform: 'win32',
      env: { EDU_HOME: '  ', HOME: 'C:\\Users\\FromHome', USERPROFILE: 'C:\\Users\\FromProfile' },
      readFile: missing, realpath: noLink,
    });
    expect(profile.home).toBe('C:\\Users\\FromHome\\.edu');
  });

  it('uses homedir only when no home variable is set', async () => {
    const root = await sandbox();
    const user = join(root, 'user');
    const profile = await loadSessionProfile({
      env: { EDU_HOME: '', HOME: '', USERPROFILE: '' },
      homedir: () => user,
      readFile: missing,
    });
    expect(profile.home).toBe(join(user, '.edu'));
  });

  it('rejects an implicit personal home inside C:\\Cheil', async () => {
    await expect(loadSessionProfile({
      platform: 'win32', env: { EDU_HOME: 'C:\\Cheil\\.edu' }, readFile: missing, realpath: noLink,
    })).rejects.toMatchObject({ code: 'cheil-root', message: expect.stringContaining('C:\\Cheil') as string });
  });

  it('rejects an unreadable profile file instead of inventing a personal profile', async () => {
    await expect(loadSessionProfile({
      platform: 'win32', env: { EDU_HOME: 'D:\\edu' }, realpath: noLink,
      readFile: () => Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' })),
    })).rejects.toMatchObject({ code: 'unreadable' });
  });

  it('rejects invalid JSON and a home that is not the session home', async () => {
    await expect(loadSessionProfile({
      platform: 'win32', env: { EDU_HOME: 'D:\\edu' }, realpath: noLink, readFile: () => Promise.resolve('not-json'),
    })).rejects.toMatchObject({ code: 'invalid' });
    await expect(loadSessionProfile({
      platform: 'win32', env: { EDU_HOME: 'D:\\edu' }, realpath: noLink, readFile: () => Promise.resolve('[]'),
    })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('object') as string });
    await expect(loadSessionProfile({
      platform: 'win32', env: { EDU_HOME: 'D:\\edu' }, realpath: noLink,
      readFile: () => Promise.resolve(JSON.stringify({ id: 'cheil', home: 'D:\\other', brain: 'C:\\Cheil\\_CONOCIMIENTO', remote: CHEIL_REMOTE })),
    })).rejects.toMatchObject({ code: 'home-mismatch', message: expect.stringContaining('home') as string });
  });

  it('matches a Windows home without regard to case and accepts a BOM', async () => {
    const text = `\uFEFF${JSON.stringify({ id: 'personal', home: 'c:\\users\\eduardo\\.edu', brain: 'D:\\notes', remote: PERSONAL_REMOTE })}`;
    const profile = await loadSessionProfile({
      platform: 'win32', env: { EDU_HOME: 'C:\\Users\\Eduardo\\.edu' }, realpath: noLink, readFile: () => Promise.resolve(text),
    });
    expect(profile).toMatchObject({ id: 'personal', home: 'c:\\users\\eduardo\\.edu', brain: 'D:\\notes', remote: PERSONAL_REMOTE });
  });
});

describe('two profiles on one machine', () => {
  it('reads each brain and does not open the other home', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-profile-pair-'));
    const previous = process.env.EDU_CEILING_DIRECTORIES;
    process.env.EDU_CEILING_DIRECTORIES = [root].join(delimiter);
    try {
      const personalHome = join(root, 'personal-home');
      const personalBrain = join(root, 'personal-brain');
      const cheilHome = join(root, 'cheil-home');
      const cheilBrain = join(root, 'cheil-brain');
      await mkdir(join(personalBrain, '3-transitive'), { recursive: true });
      await mkdir(join(cheilBrain, '3-transitive'), { recursive: true });
      await mkdir(personalHome);
      await mkdir(cheilHome);
      await writeFile(join(personalHome, 'profile.json'), JSON.stringify({
        id: 'personal', home: personalHome, brain: personalBrain, remote: PERSONAL_REMOTE,
      }));
      await writeFile(join(cheilHome, 'profile.json'), JSON.stringify({
        id: 'cheil', home: cheilHome, brain: cheilBrain, remote: CHEIL_REMOTE,
      }));
      await writeFile(join(personalBrain, '3-transitive', 'personal-only.md'), note('L-personal-only', 'Personal only', 'personal-only-sentence'));
      await writeFile(join(cheilBrain, '3-transitive', 'cheil-only.md'), note('L-cheil-only', 'Cheil only', 'cheil-only-sentence'));

      const seen: string[] = [];
      const personalProfile = await loadSessionProfile({
        env: { EDU_HOME: personalHome, EDU_CEILING_DIRECTORIES: root },
        readFile: async file => { seen.push(file); return readFile(file, 'utf8'); },
      });
      const cheilProfile = await loadSessionProfile({ env: { EDU_HOME: cheilHome, EDU_CEILING_DIRECTORIES: root } });
      expect(inside(cheilHome, seen[0] ?? '')).toBe(false);
      expect(seen).toEqual([join(personalHome, 'profile.json')]);

      const personalNotes = await notesOf(personalProfile);
      const cheilNotes = await notesOf(cheilProfile);
      expect(personalNotes).toEqual(['personal-only-sentence']);
      expect(cheilNotes).toEqual(['cheil-only-sentence']);
    } finally {
      if (previous === undefined) delete process.env.EDU_CEILING_DIRECTORIES;
      else process.env.EDU_CEILING_DIRECTORIES = previous;
      await rm(root, { recursive: true, force: true });
    }
  });
});

function note(id: string, title: string, body: string): string {
  return `---\nid: ${id}\ntier: transitive\nkind: lesson\ntitle: ${title}\ncreated: 2026-01-01T00:00:00.000Z\n---\n\n${body}\n`;
}

function notesOf(profile: Profile): Promise<string[]> {
  return listLocation({ scope: 'global', root: profile.home, brainDir: profile.brain }).then(notes => notes.map(item => item.body));
}

function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}
