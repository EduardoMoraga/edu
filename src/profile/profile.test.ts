import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join, relative, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listLocation } from '../brain/store.js';
import {
  CHEIL_REMOTE, CHEIL_VAULT_DIR, PERSONAL_REMOTE, ProfileError, assertProfileRemote, assertProfileVault,
  defaultVaultDir, joinBinding, loadSessionProfile, parseProfile, parseProfileId, profileJson, type Profile,
} from './profile.js';

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
    const folded = thrown(() => parseProfile({ ...personal, brain: 'c:\\CHEIL\\notes' }, win32));
    expect(folded.code).toBe('cheil-root');
    const home = thrown(() => parseProfile({ ...personal, home: 'C:\\Cheil' }, win32));
    expect(home.code).toBe('cheil-root');
    expect(home.message).toContain('home');
  });

  it('allows a personal folder whose name only starts with Cheil', () => {
    expect(parseProfile({ ...personal, brain: 'C:\\Cheilish\\notes' }, win32).brain).toBe('C:\\Cheilish\\notes');
    expect(parseProfile({ ...personal, brain: 'C:\\Cheil\\..\\Users\\notes' }, win32).brain).toBe('C:\\Users\\notes');
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
    const error = thrown(() => parseProfile({ ...personal, remote: 'https://user:s3cret@github.com/EduardoMCheil/cheil-vault.git' }, win32));
    expect(error.code).toBe('remote-mismatch');
    expect(error.message).toContain(PERSONAL_REMOTE);
    expect(error.message).not.toContain('s3cret');
  });

  it('rejects a path that a junction resolves into C:\\Cheil', () => {
    const realpath = (file: string) => file === 'D:\\vault\\brain' ? 'C:\\Cheil\\_CONOCIMIENTO' : undefined;
    const personalError = thrown(() => parseProfile({ ...personal, brain: 'D:\\vault\\brain' }, { platform: 'win32', realpath }));
    expect(personalError.code).toBe('cheil-root');
    expect(personalError.message).toContain('C:\\Cheil');
    expect(parseProfile({
      id: 'cheil', home: 'D:\\edu-cheil', brain: 'D:\\vault\\brain', remote: CHEIL_REMOTE,
    }, { platform: 'win32', realpath }).brain).toBe('D:\\vault\\brain');
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
      id: 'personal', home: 'C:\\Users\\Eduardo\\.edu', brain: 'C:\\Users\\Eduardo\\.edu\\brain', remote: PERSONAL_REMOTE,
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
      platform: 'win32', env: { EDU_HOME: 'D:\\edu' }, realpath: noLink,
      readFile: () => Promise.resolve(JSON.stringify({ id: 'cheil', home: 'D:\\other', brain: 'C:\\Cheil\\_CONOCIMIENTO', remote: CHEIL_REMOTE })),
    })).rejects.toMatchObject({ code: 'home-mismatch' });
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
    process.env.EDU_CEILING_DIRECTORIES = [root, process.env.EDU_CEILING_DIRECTORIES].filter(Boolean).join(delimiter);
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

describe('join binding', () => {
  const cheil = () => joinBinding('cheil', 'D:\\edu-cheil', win32);
  const personalBinding = () => joinBinding('personal', personal.home, win32);

  it('parses only the two profile ids', () => {
    expect(parseProfileId(' personal ')).toBe('personal');
    expect(parseProfileId('cheil')).toBe('cheil');
    expect(thrown(() => parseProfileId('work')).message).toContain('personal or cheil');
  });

  it('binds the profile remote and refuses a personal home inside C:\\Cheil', () => {
    expect(personalBinding()).toEqual({ id: 'personal', home: personal.home, remote: PERSONAL_REMOTE });
    expect(cheil()).toEqual({ id: 'cheil', home: 'D:\\edu-cheil', remote: CHEIL_REMOTE });
    expect(thrown(() => joinBinding('personal', 'C:\\Cheil\\.edu', win32)).code).toBe('cheil-root');
  });

  it('refuses a cheil join of the personal vault without repeating a secret', () => {
    const binding = cheil();
    expect(() => assertProfileRemote(binding, `https://github.com/${CHEIL_REMOTE}.git`)).not.toThrow();
    expect(() => assertProfileRemote(binding, 'C:\\temp\\remote.git')).not.toThrow();
    const crossed = thrown(() => assertProfileRemote(binding, `https://user:s3cret@github.com/${PERSONAL_REMOTE}.git`));
    expect(crossed.code).toBe('remote-mismatch');
    expect(crossed.message).toContain(CHEIL_REMOTE);
    expect(crossed.message).not.toContain('s3cret');
    expect(thrown(() => assertProfileRemote(personalBinding(), CHEIL_REMOTE)).message).toContain(PERSONAL_REMOTE);
  });

  it('defaults the cheil vault to C:\\Cheil on Windows and refuses a vault outside it', () => {
    expect(defaultVaultDir(cheil(), 'win32')).toBe(CHEIL_VAULT_DIR);
    expect(defaultVaultDir(cheil(), 'linux')).toBeUndefined();
    expect(defaultVaultDir(personalBinding(), 'win32')).toBeUndefined();
    const outside = thrown(() => assertProfileVault(cheil(), 'D:\\EduVault', 'D:\\EduVault\\_CONOCIMIENTO', win32));
    expect(outside.code).toBe('vault-root');
    expect(outside.message).toContain(CHEIL_VAULT_DIR);
    expect(() => assertProfileVault(cheil(), CHEIL_VAULT_DIR, `${CHEIL_VAULT_DIR}\\_CONOCIMIENTO`, win32)).not.toThrow();
    expect(thrown(() => assertProfileVault(personalBinding(), `${CHEIL_VAULT_DIR}\\vault`, `${CHEIL_VAULT_DIR}\\vault\\01-CONOCIMIENTO`, win32)).code).toBe('cheil-root');
    expect(() => assertProfileVault(cheil(), '/tmp/cheil-vault', '/tmp/cheil-vault/_CONOCIMIENTO', { platform: 'linux', realpath: noLink })).not.toThrow();
  });

  it('writes a profile file the parser accepts', () => {
    const text = profileJson({ id: 'cheil', home: 'D:\\edu-cheil', brain: `${CHEIL_VAULT_DIR}\\_CONOCIMIENTO`, remote: CHEIL_REMOTE }, win32);
    expect(parseProfile(JSON.parse(text), win32)).toEqual({
      id: 'cheil', home: 'D:\\edu-cheil', brain: `${CHEIL_VAULT_DIR}\\_CONOCIMIENTO`, remote: CHEIL_REMOTE,
    });
  });
});

function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}
